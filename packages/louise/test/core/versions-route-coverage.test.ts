import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import {
  collectionVersionsTable,
  defineCollection,
  toPageId,
} from "../../src/core/content/index.js";
import { pageRedirects } from "../../src/core/db/index.js";
import {
  type DraftBufferKV,
  draftBufferKey,
  readDraftBuffer,
  versionsRoute,
  writeDraftBuffer,
} from "../../src/core/editor/index.js";
import { hasPendingDraft } from "../../src/core/editor/versions.js";
import { LouiseValidationError } from "../../src/core/errors.js";

// The branches of `versionsRoute` the lifecycle and routing suites don't reach
// (#508): a save or publish for a missing page, a body that isn't a JSON
// object, a `beforeChange` hook that rejects a direct save, a buffer flush, or
// a never-published page's first version, a publish or republish the access
// rules refuse, the KV buffer's first flush and its clear on publish and
// discard, the discard checks, a publish with redirects on that keeps its slug
// or can't write the redirect, and `hasPendingDraft` for a missing row. Against
// real SQLite, so each case checks the rows the route left behind.

/** A D1 binding over `node:sqlite`, enough of one for drizzle's D1 driver. */
function sqliteD1(sqlite: DatabaseSync): D1Database {
  const bind = (sql: string, params: SQLInputValue[]) => ({
    all: async () => ({ results: sqlite.prepare(sql).all(...params), success: true, meta: {} }),
    raw: async () => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      return statement.all(...params);
    },
    run: async () => {
      const { changes } = sqlite.prepare(sql).run(...params);
      return { results: [], success: true, meta: { changes: Number(changes) } };
    },
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
  });
  return {
    prepare: (sql: string) => ({
      ...bind(sql, []),
      bind: (...params: SQLInputValue[]) => bind(sql, params),
    }),
    batch: async (statements: ReturnType<typeof bind>[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

function memoryKv(): DraftBufferKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

const editor: EditorSession = {
  userId: "u1",
  email: "alex@example.com",
  name: "Alex",
  role: "admin",
};
const ctx = {} as ExecutionContext;

/** The title the collection's `beforeChange` hook refuses. */
const REJECTED = "Rejected";
const violations = [{ path: "title", message: "Pick another title", severity: "error" as const }];

const docs = sqliteTable("docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  publishedVersionId: integer("published_version_id"),
});

interface Harness {
  /** Turn on the KV draft buffer. */
  kv?: boolean;
  /** Turn on redirects; `table: false` leaves the `page_redirects` table out. */
  redirects?: { table: boolean };
}

function fresh(opts: Harness = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', published_version_id INTEGER);
    CREATE TABLE docs_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL,
      version_data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER,
      scheduled_at INTEGER);
    INSERT INTO docs (slug, title) VALUES ('about', 'About');
  `);
  if (opts.redirects?.table) {
    sqlite.exec(`
      CREATE TABLE page_redirects (
        from_path TEXT PRIMARY KEY, to_path TEXT NOT NULL, code INTEGER NOT NULL DEFAULT 301,
        created_at INTEGER);
    `);
  }
  // The publish gate, swapped per test: allow, deny, or fail outright.
  const access: { publish: () => boolean | Promise<boolean> } = { publish: () => true };
  const config = defineCollection({
    slug: "docs",
    fields: { slug: { type: "text" }, title: { type: "text" } },
    versions: { drafts: true },
    access: { publish: () => access.publish() },
    hooks: {
      beforeChange: [
        ({ data }) => {
          if (data.title === REJECTED) {
            throw new LouiseValidationError("That title isn't allowed", violations);
          }
          return data;
        },
      ],
    },
  });
  const versionsTable = collectionVersionsTable(config);
  const kv = opts.kv ? memoryKv() : undefined;
  const DB = sqliteD1(sqlite);
  const route = versionsRoute({
    table: docs,
    versionsTable,
    config,
    resolveEditor: () => editor,
    ...(kv ? { bufferKv: () => kv } : {}),
    ...(opts.redirects ? { redirects: pageRedirects } : {}),
  });
  /** POST (or `method`) `/api/louise/pages/<path>`; `raw` sends the body as is. */
  const call = async (
    path: string,
    init: { method?: string; body?: unknown; raw?: string } = {},
  ) => {
    const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
    const res = await route(
      new Request(`https://site.example/api/louise/pages/${path}`, {
        method: init.method ?? "POST",
        headers: { origin: "https://site.example", "content-type": "application/json" },
        ...(body === undefined ? {} : { body }),
      }),
      { DB },
      ctx,
    );
    if (!res) throw new Error(`no response for ${path}`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const row = (id = 1) =>
    sqlite.prepare("SELECT * FROM docs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
  const versionRows = () =>
    sqlite.prepare("SELECT id, parent_id, status FROM docs_versions ORDER BY id").all() as {
      id: number;
      parent_id: number;
      status: string;
    }[];
  const bufferKey = draftBufferKey("docs", 1);
  const buffer = () => (kv ? readDraftBuffer(kv, bufferKey) : Promise.resolve(null));
  return {
    sqlite,
    DB,
    kv,
    bufferKey,
    buffer,
    access,
    config,
    versionsTable,
    call,
    row,
    versionRows,
  };
}

describe("versionsRoute—a draft save that can't go ahead", () => {
  it("answers 404 for a page that doesn't exist, and writes nothing", async () => {
    const { call, versionRows } = fresh();
    const res = await call("99/versions", { body: { title: "Ghost" } });
    expect(res).toEqual({ status: 404, body: { error: "Not found" } });
    expect(versionRows()).toEqual([]);
  });

  it("answers 400 for a body that isn't JSON", async () => {
    const { call, versionRows } = fresh();
    const res = await call("1/versions", { raw: "{not json" });
    expect(res).toEqual({ status: 400, body: { error: "Invalid JSON" } });
    expect(versionRows()).toEqual([]);
  });

  it("answers 400 for JSON that isn't an object", async () => {
    const { call, versionRows } = fresh();
    expect(await call("1/versions", { body: ["About us"] })).toEqual({
      status: 400,
      body: { error: "Invalid JSON" },
    });
    expect(await call("1/versions", { body: "About us" })).toEqual({
      status: 400,
      body: { error: "Invalid JSON" },
    });
    expect(versionRows()).toEqual([]);
  });

  it("answers 422 with the violations when the hook rejects a direct save", async () => {
    const { call, versionRows } = fresh();
    const res = await call("1/versions", { body: { title: REJECTED } });
    expect(res).toEqual({
      status: 422,
      body: { error: "That title isn't allowed", violations },
    });
    expect(versionRows()).toEqual([]);
  });
});

describe("versionsRoute—the KV buffer", () => {
  it("flushes the first save to D1 and buffers what D1 stored", async () => {
    const { call, buffer, versionRows } = fresh({ kv: true });
    const res = await call("1/versions", { body: { title: "About us" } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      buffered: false,
      version: { id: 1, parentId: 1, status: "draft" },
    });
    expect(Object.keys(res.body.revs as object)).toEqual(["title"]);
    expect(versionRows()).toEqual([{ id: 1, parent_id: 1, status: "draft" }]);

    const held = await buffer();
    expect(held?.data).toEqual({ slug: "about", title: "About us" });
    // A fresh flush: the buffer's flush time is its write time.
    expect(held?.flushedAt).toBe(held?.updatedAt);

    // The next save lands inside the flush window, so only KV takes it.
    const next = await call("1/versions", { body: { title: "About the team" } });
    expect(next).toMatchObject({ status: 200, body: { buffered: true } });
    expect(versionRows()).toHaveLength(1);
    expect((await buffer())?.data).toEqual({ slug: "about", title: "About the team" });
  });

  it("clears the buffer once publishing the latest draft makes it live", async () => {
    const { call, buffer, row } = fresh({ kv: true });
    await call("1/versions", { body: { title: "About us" } });
    await call("1/versions", { body: { title: "About the team" } });
    expect(await buffer()).not.toBeNull();

    const res = await call("1/publish", { body: {} });
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ status: "published", title: "About the team" });
    expect(await buffer()).toBeNull();
  });

  it("keeps the buffer when publishing an explicit version", async () => {
    const { call, buffer, row } = fresh({ kv: true });
    await call("1/versions", { body: { title: "About us" } });

    const res = await call("1/publish", { body: { versionId: 1 } });
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ status: "published", published_version_id: 1 });
    expect((await buffer())?.data).toEqual({ slug: "about", title: "About us" });
  });

  it("answers 422 when the hook rejects the buffered work a publish flushes", async () => {
    const { call, kv, bufferKey, buffer, row, versionRows } = fresh({ kv: true });
    const now = Date.now();
    await writeDraftBuffer(kv as DraftBufferKV, bufferKey, {
      data: { slug: "about", title: REJECTED },
      updatedAt: now,
      flushedAt: now,
    });

    const res = await call("1/publish", { body: {} });
    expect(res).toEqual({
      status: 422,
      body: { error: "That title isn't allowed", violations },
    });
    // Nothing went live, no version was written, and the buffer stays put.
    expect(row()).toMatchObject({ status: "draft", published_version_id: null, title: "About" });
    expect(versionRows()).toEqual([]);
    expect((await buffer())?.data).toEqual({ slug: "about", title: REJECTED });
  });
});

describe("versionsRoute—a publish that can't go ahead", () => {
  it("answers 404 for a page that doesn't exist", async () => {
    const { call } = fresh();
    expect(await call("99/publish", { body: {} })).toEqual({
      status: 404,
      body: { error: "Not found" },
    });
  });

  it("answers 422 when the hook rejects a never-published page's first version", async () => {
    const { call, sqlite, row, versionRows } = fresh();
    sqlite.exec(`UPDATE docs SET title = '${REJECTED}' WHERE id = 1`);
    const res = await call("1/publish", { body: {} });
    expect(res).toEqual({
      status: 422,
      body: { error: "That title isn't allowed", violations },
    });
    expect(row()).toMatchObject({ status: "draft", published_version_id: null });
    expect(versionRows()).toEqual([]);
  });

  it("answers 422 when access refuses the publish, leaving the draft pending", async () => {
    const { call, access, row, versionRows } = fresh();
    await call("1/versions", { body: { title: "About us" } });
    access.publish = () => false;

    const res = await call("1/publish", { body: {} });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'Access denied for "publish" on collection "docs"' });
    expect(row()).toMatchObject({ status: "draft", published_version_id: null, title: "About" });
    expect(versionRows()).toEqual([{ id: 1, parent_id: 1, status: "draft" }]);
  });

  it("answers 422 when access refuses showing a hidden page again", async () => {
    const { call, access, row } = fresh();
    await call("1/publish", { body: {} });
    await call("1/unpublish");
    expect(row()).toMatchObject({ status: "draft", published_version_id: 1 });
    access.publish = () => false;

    const res = await call("1/publish", { body: {} });
    expect(res).toEqual({
      status: 422,
      body: { error: 'Access denied for "publish" on collection "docs"' },
    });
    expect(row()).toMatchObject({ status: "draft", published_version_id: 1 });
  });

  it("lets a failure that isn't a content error escape the republish", async () => {
    const { call, access } = fresh();
    await call("1/publish", { body: {} });
    await call("1/unpublish");
    access.publish = () => {
      throw new Error("session store unreachable");
    };
    await expect(call("1/publish", { body: {} })).rejects.toThrow("session store unreachable");
  });
});

describe("versionsRoute—unpublish", () => {
  it("lets a failure that isn't a content error escape", async () => {
    const { call, access, row } = fresh();
    await call("1/publish", { body: {} });
    access.publish = () => {
      throw new Error("session store unreachable");
    };
    await expect(call("1/unpublish")).rejects.toThrow("session store unreachable");
    expect(row()).toMatchObject({ status: "published" });
  });
});

describe("versionsRoute—discard", () => {
  it("deletes a pending draft and leaves the others", async () => {
    const { call, versionRows } = fresh();
    await call("1/versions", { body: { title: "About us" } });
    await call("1/versions", { body: { title: "About the team" } });

    const res = await call("1/discard", { body: { versionId: 2 } });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(versionRows()).toEqual([{ id: 1, parent_id: 1, status: "draft" }]);
  });

  it("answers 404 for a version that doesn't exist", async () => {
    const { call, versionRows } = fresh();
    await call("1/versions", { body: { title: "About us" } });
    expect(await call("1/discard", { body: { versionId: 42 } })).toEqual({
      status: 404,
      body: { error: "Version not found" },
    });
    expect(versionRows()).toHaveLength(1);
  });

  it("answers 404 for another page's version, and leaves it", async () => {
    const { call, sqlite, versionRows } = fresh();
    sqlite.exec("INSERT INTO docs (slug, title) VALUES ('team', 'Team')");
    await call("2/versions", { body: { title: "Our team" } });

    expect(await call("1/discard", { body: { versionId: 1 } })).toEqual({
      status: 404,
      body: { error: "Version not found" },
    });
    expect(versionRows()).toEqual([{ id: 1, parent_id: 2, status: "draft" }]);
  });

  it("answers 400 for a version that has been published", async () => {
    const { call, versionRows } = fresh();
    await call("1/versions", { body: { title: "About us" } });
    await call("1/publish", { body: {} });

    expect(await call("1/discard", { body: { versionId: 1 } })).toEqual({
      status: 400,
      body: { error: "Only draft versions can be discarded" },
    });
    expect(versionRows()).toEqual([{ id: 1, parent_id: 1, status: "published" }]);
  });

  it("drops the buffer too, so resume can't bring the work back", async () => {
    const { call, buffer, versionRows } = fresh({ kv: true });
    await call("1/versions", { body: { title: "About us" } });
    expect(await buffer()).not.toBeNull();

    expect(await call("1/discard", { body: { versionId: 1 } })).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(versionRows()).toEqual([]);
    expect(await buffer()).toBeNull();
  });
});

describe("versionsRoute—a publish with redirects on", () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
  });

  it("writes no redirect when the slug doesn't change", async () => {
    const { call, sqlite, row } = fresh({ redirects: { table: true } });
    await call("1/versions", { body: { title: "About us" } });

    expect((await call("1/publish", { body: {} })).status).toBe(200);
    expect(row()).toMatchObject({ status: "published", slug: "about", title: "About us" });
    expect(sqlite.prepare("SELECT * FROM page_redirects").all()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps the publish and reports it when the redirect can't be written", async () => {
    const { call, row } = fresh({ redirects: { table: false } });
    await call("1/versions", { body: { slug: "about-us" } });

    const res = await call("1/publish", { body: {} });
    expect(res.status).toBe(200);
    expect(res.body.page).toMatchObject({ slug: "about-us", status: "published" });
    expect(row()).toMatchObject({ status: "published", slug: "about-us" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("degraded editor.redirects");
  });
});

describe("hasPendingDraft", () => {
  it("is false for a row that doesn't exist", async () => {
    const { DB, config, versionsTable } = fresh();
    const deps = { table: docs, versionsTable, config };
    expect(await hasPendingDraft({ DB }, deps, editor, toPageId(99))).toBe(false);
  });
});
