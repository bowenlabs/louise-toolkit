// core/mcp—the write tools (#236, ADR 0009 slice 4), end to end against real
// SQLite: an agent's edit lands as a draft version that names its token, the
// live row doesn't move until a publish-scoped call, and the edit meets the
// same hooks, validation, and access functions a person's does.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import type { AgentAccess, EditorSession } from "../../src/core/auth/index.js";
import {
  collectionVersionsTable,
  type SectionCatalog,
  versionProvenance,
} from "../../src/core/content/index.js";
import type { CollectionConfig, JsonValue } from "../../src/core/content/types.js";
import { type DraftBufferKV, draftBufferKey } from "../../src/core/editor/draft-buffer.js";
import { applySaveDraft } from "../../src/core/editor/versions.js";
import { mcpRoute, type McpRouteConfig } from "../../src/core/mcp/index.js";

const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body"),
  sections: text("sections", { mode: "json" }).$type<JsonValue>(),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  publishedVersionId: integer("published_version_id"),
});

const inquiries = sqliteTable("inquiries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

const postsConfig: CollectionConfig = {
  slug: "posts",
  fields: {
    id: { type: "number", autoIncrement: true },
    title: { type: "text", required: true },
    body: { type: "text" },
    sections: { type: "json" },
  },
  versions: { drafts: true, provenance: true },
  hooks: {
    // A site's write hook: an agent's edit must pass through it like a person's.
    beforeChange: [
      ({ data }) => (typeof data.title === "string" ? { ...data, title: data.title.trim() } : data),
    ],
  },
  access: {
    update: (ctx) => (ctx as { session: EditorSession }).session.role !== "viewer",
    publish: (ctx) => (ctx as { session: EditorSession }).session.role === "admin",
  },
};

const inquiriesConfig: CollectionConfig = {
  slug: "inquiries",
  fields: { id: { type: "number", autoIncrement: true }, name: { type: "text", required: true } },
};

const postsVersions = collectionVersionsTable(postsConfig);

const sections: SectionCatalog = {
  hero: {
    label: "Hero",
    fields: { heading: { type: "text" }, intro: { type: "richText" } },
  },
};

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, sections TEXT,
    status TEXT NOT NULL DEFAULT 'draft', published_version_id INTEGER)`);
  sqlite.exec(`CREATE TABLE posts_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL, version_data TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER, scheduled_at INTEGER, author TEXT, source TEXT)`);
  sqlite.exec(`CREATE TABLE inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
  const statement = (sql: string, binds: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    all: async () => ({ results: sqlite.prepare(sql).all(...binds), success: true, meta: {} }),
    raw: async () => {
      const prepared = sqlite.prepare(sql);
      prepared.setReturnArrays(true);
      return prepared.all(...binds);
    },
    first: async () => sqlite.prepare(sql).get(...binds) ?? null,
    run: async () => ({
      success: true,
      meta: { changes: Number(sqlite.prepare(sql).run(...binds).changes) },
    }),
  });
  sqlite
    .prepare(`INSERT INTO posts (title, body, sections, status) VALUES (?, ?, ?, 'published')`)
    .run("Opening hours", "We open at nine.", JSON.stringify([{ _type: "hero", heading: "Hi" }]));
  // A publish batches its two writes, as D1 does: one transaction.
  const batch = async (statements: ReturnType<typeof statement>[]) => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const s of statements) results.push(await s.all());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };
  return {
    sqlite,
    db: { prepare: (sql: string) => statement(sql), batch } as unknown as D1Database,
  };
}

function memoryKv(): DraftBufferKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
  };
}

const ORIGIN = "https://site.example";
const URL_MCP = `${ORIGIN}/api/louise/mcp`;
const admin: EditorSession = {
  userId: "e1",
  email: "alex@example.com",
  name: "Alex",
  role: "admin",
};
const ctx = {} as ExecutionContext;

const agentOf = (scope: Record<string, AgentAccess>, editor = admin): EditorSession => ({
  ...editor,
  agent: { tokenId: "tok_agent1", name: "Claude Code on Kai's laptop", scope },
});

function setup(
  options: {
    agent?: EditorSession;
    browser?: EditorSession;
    kv?: DraftBufferKV;
    extra?: Partial<McpRouteConfig>;
  } = {},
) {
  const d1 = sqliteD1();
  const route = mcpRoute({
    collections: [
      {
        table: posts,
        config: postsConfig,
        drafts: {
          versionsTable: postsVersions,
          ...(options.kv ? { bufferKv: () => options.kv } : {}),
        },
      },
      { table: inquiries, config: inquiriesConfig },
    ],
    resolveEditor: () => options.browser ?? null,
    resolveAgent: () => options.agent ?? null,
    sections,
    server: { name: "site-example", version: "1.0.0" },
    ...options.extra,
  });
  const env = { DB: d1.db };
  let id = 0;
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.agent)
      headers.authorization = "Bearer placeholder"; // resolveAgent above ignores it
    else headers.origin = ORIGIN;
    const res = await route(
      new Request(URL_MCP, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }),
      env,
      ctx,
    );
    return (await (res as Response).json()) as { result: Record<string, unknown> };
  };
  const call = async (name: string, args: Record<string, unknown>) =>
    (await send("tools/call", { name, arguments: args })).result as {
      structuredContent?: Record<string, unknown>;
      content: { text: string }[];
      isError?: boolean;
    };
  const listed = async () =>
    ((await send("tools/list")).result.tools as { name: string }[]).map((t) => t.name);
  const row = (id: number) => d1.sqlite.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
  const versions = () =>
    d1.sqlite.prepare(`SELECT * FROM posts_versions ORDER BY id`).all() as Record<
      string,
      unknown
    >[];
  return { call, listed, row, versions, sqlite: d1.sqlite };
}

const draftOf = (version: Record<string, unknown>) =>
  JSON.parse(version.version_data as string) as Record<string, unknown>;

describe("tools/list", () => {
  it("offers draft edits to a draft-scoped token, and nothing that goes live", async () => {
    const { listed } = setup({ agent: agentOf({ posts: "draft", inquiries: "draft" }) });
    const names = await listed();
    expect(names).toEqual(
      expect.arrayContaining(["create_posts", "update_posts_field", "add_posts_section"]),
    );
    // Publishing, and a create that's live at once, both take publish scope.
    expect(names).not.toContain("publish_posts");
    expect(names).not.toContain("create_inquiries");
  });

  it("offers publish, and a live create, to a publish-scoped token", async () => {
    const { listed } = setup({ agent: agentOf({ posts: "publish", inquiries: "publish" }) });
    expect(await listed()).toEqual(expect.arrayContaining(["publish_posts", "create_inquiries"]));
  });

  it("hides a write tool the collection's access function refuses", async () => {
    const editorOnly = { ...admin, role: "editor" };
    const { listed } = setup({ agent: agentOf({ posts: "publish" }, editorOnly) });
    const names = await listed();
    expect(names).toContain("update_posts_field");
    expect(names).not.toContain("publish_posts");
  });

  it("offers no writes on a collection with drafts but no draft store", async () => {
    const { listed } = setup({
      agent: agentOf({ posts: "publish" }),
      extra: { collections: [{ table: posts, config: postsConfig }] },
    });
    expect(await listed()).toEqual(["list_posts", "get_posts", "count_posts"]);
  });
});

describe("update_posts_field", () => {
  it("saves a draft version that names the token, and leaves the live row alone", async () => {
    const { call, row, versions } = setup({ agent: agentOf({ posts: "draft" }) });
    const result = await call("update_posts_field", {
      id: 1,
      field: "title",
      value: "  Summer hours  ",
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ id: 1, versionId: 1 });
    expect(row(1)).toMatchObject({ title: "Opening hours", status: "published" });
    const [version] = versions();
    expect(version).toMatchObject({
      status: "draft",
      author: "tok_agent1",
      source: "agent",
    });
    // The site's hook ran on it, exactly as for a person's save.
    expect(draftOf(version as Record<string, unknown>).title).toBe("Summer hours");
  });

  it("records a person's edit as the editor, through the same tool", async () => {
    const { call, versions } = setup({ browser: admin });
    await call("update_posts_field", { id: "1", field: "body", value: "Nine to five." });
    expect(versions()[0]).toMatchObject({ author: "e1", source: "editor" });
  });

  it("builds on buffered work and leaves the buffer holding the agent's edit", async () => {
    const kv = memoryKv();
    const human = { title: "Opening hours", body: "Typed but not flushed.", sections: [] };
    kv.store.set(
      draftBufferKey("posts", 1),
      JSON.stringify({ data: human, updatedAt: Date.now(), flushedAt: Date.now() }),
    );
    const { call, versions } = setup({ agent: agentOf({ posts: "draft" }), kv });
    await call("update_posts_field", { id: 1, field: "title", value: "Summer hours" });
    // Written to D1 at once, so the version names the agent, over the person's work.
    const [version] = versions();
    expect(version?.source).toBe("agent");
    expect(draftOf(version as Record<string, unknown>)).toMatchObject({
      title: "Summer hours",
      body: "Typed but not flushed.",
    });
    const buffered = JSON.parse(kv.store.get(draftBufferKey("posts", 1)) as string);
    expect(buffered.data).toMatchObject({ title: "Summer hours", body: "Typed but not flushed." });
  });

  it("checks whole sections against the catalog", async () => {
    const { call, versions } = setup({ agent: agentOf({ posts: "draft" }) });
    const result = await call("update_posts_field", {
      id: 1,
      field: "sections",
      value: [{ _type: "carousel" }],
    });
    expect(result.content[0]?.text).toContain("Those sections aren't valid.");
    expect(versions()).toEqual([]);
  });

  it("refuses a field it doesn't offer, including visibility", async () => {
    const { call, versions } = setup({ agent: agentOf({ posts: "draft" }) });
    for (const field of ["status", "publishedVersionId", "nope"]) {
      const result = await call("update_posts_field", { id: 1, field, value: "published" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("`field` must be one of: title, body, sections.");
    }
    expect(versions()).toEqual([]);
  });

  it("says so when the document doesn't exist, or the id isn't one", async () => {
    const { call } = setup({ agent: agentOf({ posts: "draft" }) });
    expect(
      (await call("update_posts_field", { id: 99, field: "title", value: "x" })).content[0]?.text,
    ).toBe("There's no posts document with id 99.");
    expect(
      (await call("update_posts_field", { id: "1.5", field: "title", value: "x" })).content[0]
        ?.text,
    ).toBe("`id` must be a document id: a whole number.");
  });

  it("refuses an editor the update access function shuts out", async () => {
    const viewer = { ...admin, role: "viewer" };
    const { call, versions } = setup({ browser: viewer });
    const result = await call("update_posts_field", { id: 1, field: "title", value: "x" });
    expect(result.content[0]?.text).toBe("You don't have access to edit posts.");
    expect(versions()).toEqual([]);
  });
});

describe("add_posts_section", () => {
  it("appends a section, holding its rich text to model HTML", async () => {
    const { call, versions } = setup({ agent: agentOf({ posts: "draft" }) });
    const result = await call("add_posts_section", {
      id: 1,
      section: "hero",
      values: {
        heading: "Summer",
        intro: '<p style="color:red" onclick="x()">Longer <b>days</b><script>x()</script></p>',
      },
    });
    expect(result.isError).toBeUndefined();
    const draft = draftOf(versions()[0] as Record<string, unknown>);
    expect(draft.sections).toEqual([
      { _type: "hero", heading: "Hi" },
      { _type: "hero", heading: "Summer", intro: "<p>Longer <b>days</b></p>" },
    ]);
  });

  it("appends to the pending draft, not the live row", async () => {
    const { call, versions } = setup({ agent: agentOf({ posts: "draft" }) });
    await call("add_posts_section", { id: 1, section: "hero", values: { heading: "One" } });
    await call("add_posts_section", { id: 1, section: "hero", values: { heading: "Two" } });
    const headings = (
      draftOf(versions()[1] as Record<string, unknown>).sections as { heading: string }[]
    ).map((s) => s.heading);
    expect(headings).toEqual(["Hi", "One", "Two"]);
  });

  it("refuses a section outside the catalog, a bad prop, and a reserved key", async () => {
    const { call, versions } = setup({ agent: agentOf({ posts: "draft" }) });
    expect((await call("add_posts_section", { id: 1, section: "carousel" })).content[0]?.text).toBe(
      "`section` must be one of: hero.",
    );
    const bad = await call("add_posts_section", { id: 1, section: "hero", values: { heading: 7 } });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toContain("That hero section isn't valid.");
    const reserved = await call("add_posts_section", {
      id: 1,
      section: "hero",
      values: { _type: "other", blocks: [] },
    });
    expect(reserved.content[0]?.text).toBe("`values` can't set _type, blocks.");
    expect(versions()).toEqual([]);
  });
});

describe("publish_posts", () => {
  it("is refused to a draft-only token", async () => {
    const { call, row } = setup({ agent: agentOf({ posts: "draft" }) });
    await call("update_posts_field", { id: 1, field: "title", value: "Summer hours" });
    const result = await call("publish_posts", { id: 1 });
    expect(result.content[0]?.text).toBe(
      "This token doesn't cover publish_posts. Ask the person who issued it for one whose scope includes posts.",
    );
    expect(row(1)).toMatchObject({ title: "Opening hours" });
  });

  it("puts the pending draft live for a publish-scoped token", async () => {
    const { call, row } = setup({ agent: agentOf({ posts: "publish" }) });
    await call("update_posts_field", { id: 1, field: "title", value: "Summer hours" });
    const result = await call("publish_posts", { id: 1 });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ doc: { title: "Summer hours" } });
    expect(row(1)).toMatchObject({
      title: "Summer hours",
      status: "published",
      published_version_id: 1,
    });
  });

  it("says there's nothing to publish when a live page has no draft", async () => {
    const { call } = setup({ agent: agentOf({ posts: "publish" }) });
    expect((await call("publish_posts", { id: 1 })).content[0]?.text).toBe("No draft to publish");
  });
});

describe("create", () => {
  it("creates an unpublished document on a collection with drafts, with its first draft", async () => {
    const { call, row, versions } = setup({ agent: agentOf({ posts: "draft" }) });
    const result = await call("create_posts", { title: "Fall menu", body: "Squash." });
    expect(result.structuredContent).toMatchObject({ id: 2, versionId: 1 });
    expect(row(2)).toMatchObject({
      title: "Fall menu",
      status: "draft",
      published_version_id: null,
    });
    expect(versions()[0]).toMatchObject({ parent_id: 2, source: "agent" });
  });

  it("reports the site's validate refusing a new document, and writes nothing", async () => {
    const { call, row } = setup({
      agent: agentOf({ posts: "draft" }),
      extra: {
        collections: [
          {
            table: posts,
            config: postsConfig,
            drafts: {
              versionsTable: postsVersions,
              validate: () => {
                throw new Error("Every post needs a hero section.");
              },
            },
          },
        ],
      },
    });
    const result = await call("create_posts", { title: "Fall menu" });
    expect(result.content[0]?.text).toBe("Every post needs a hero section.");
    expect(row(2)).toBeUndefined();
  });

  it("refuses visibility on a create", async () => {
    const { call, row } = setup({ agent: agentOf({ posts: "draft" }) });
    const result = await call("create_posts", { title: "Fall menu", status: "published" });
    expect(result.content[0]?.text).toBe(
      "status can't be set here. A new document starts unpublished, and `publish_posts` makes it live.",
    );
    expect(row(2)).toBeUndefined();
  });

  it("writes a live row on a collection without drafts, for a publish-scoped token", async () => {
    const { call, sqlite } = setup({ agent: agentOf({ inquiries: "publish" }) });
    const result = await call("create_inquiries", { name: "Quinn" });
    expect(result.structuredContent).toMatchObject({ doc: { name: "Quinn" } });
    expect(sqlite.prepare(`SELECT name FROM inquiries`).all()).toEqual([{ name: "Quinn" }]);
  });

  it("refuses that live create to a draft-scoped token", async () => {
    const { call, sqlite } = setup({ agent: agentOf({ inquiries: "draft" }) });
    expect((await call("create_inquiries", { name: "Quinn" })).isError).toBe(true);
    expect(sqlite.prepare(`SELECT name FROM inquiries`).all()).toEqual([]);
  });
});

describe("mcpRoute setup", () => {
  it("refuses a draft store that can't record who wrote a version", () => {
    const bare = collectionVersionsTable({ ...postsConfig, versions: { drafts: true } });
    expect(() =>
      mcpRoute({
        collections: [{ table: posts, config: postsConfig, drafts: { versionsTable: bare } }],
        resolveEditor: () => null,
        server: { name: "site-example", version: "1.0.0" },
      }),
    ).toThrow(/Set versions.provenance on the collection/);
  });
});

describe("applySaveDraft", () => {
  it("records a realtime session's save as realtime", async () => {
    const d1 = sqliteD1();
    const deps = { table: posts, versionsTable: postsVersions, config: postsConfig };
    const saved = await applySaveDraft(
      { DB: d1.db },
      deps,
      admin,
      1 as never,
      { body: "x" },
      {
        source: "realtime",
      },
    );
    expect(saved.ok).toBe(true);
    expect(d1.sqlite.prepare(`SELECT author, source FROM posts_versions`).get()).toEqual({
      author: "e1",
      source: "realtime",
    });
  });
});

describe("versionProvenance", () => {
  it("names the token for an agent, whatever source the caller claims", () => {
    expect(versionProvenance({ session: agentOf({}), source: "realtime" })).toEqual({
      author: "tok_agent1",
      source: "agent",
    });
  });

  it("names the editor, and the realtime surface when the session says so", () => {
    expect(versionProvenance({ session: admin })).toEqual({ author: "e1", source: "editor" });
    expect(versionProvenance({ session: admin, source: "realtime" })).toEqual({
      author: "e1",
      source: "realtime",
    });
  });

  it("records nothing without a session", () => {
    expect(versionProvenance(undefined)).toBeUndefined();
    expect(versionProvenance({})).toBeUndefined();
  });
});
