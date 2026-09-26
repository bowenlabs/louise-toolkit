import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { collectionSearchTableSQL } from "../../src/core/content/index.js";
import type { CollectionConfig } from "../../src/core/content/types.js";
import { mcpRoute, type McpRouteConfig } from "../../src/core/mcp/index.js";

// End to end against real SQLite and the official MCP client: the route is
// hand-rolled (ADR 0009), so the proof that it speaks the protocol is a client
// that nobody here wrote connecting to it, in both of the protocol's eras.

const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body"),
});

const postsConfig: CollectionConfig = {
  slug: "posts",
  fields: { title: { type: "text", required: true }, body: { type: "text" } },
  versions: { drafts: true },
  search: { fields: ["title", "body"] },
  // Anyone signed in reads posts, except a role the site shut out.
  access: { read: (ctx) => (ctx as { session: EditorSession }).session.role !== "viewer" },
};

const auditConfig: CollectionConfig = {
  slug: "audit",
  fields: { entry: { type: "text" } },
  admin: { hidden: true },
};

/** Drizzle's D1 driver over an in-memory SQLite database. Drizzle reads a
 *  select through `raw()` (rows as arrays) and everything else through `all()`. */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    `CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT)`,
  );
  sqlite.exec(collectionSearchTableSQL(postsConfig));
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
  const seed = (title: string, body: string) => {
    const { lastInsertRowid } = sqlite
      .prepare(`INSERT INTO posts (title, body) VALUES (?, ?)`)
      .run(title, body);
    sqlite
      .prepare(`INSERT INTO posts_fts (rowid, title, body) VALUES (?, ?, ?)`)
      .run(lastInsertRowid, title, body);
  };
  return { db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database, seed };
}

const ORIGIN = "https://site.example";
const URL_MCP = `${ORIGIN}/api/louise/mcp`;
const admin: EditorSession = {
  userId: "e1",
  email: "alex@example.com",
  name: "Alex",
  role: "admin",
};
const viewer: EditorSession = { ...admin, userId: "e2", role: "viewer" };
const ctx = {} as ExecutionContext;

function setup(editor: EditorSession | null = admin, extra: Partial<McpRouteConfig> = {}) {
  const d1 = sqliteD1();
  d1.seed("Opening hours", "We open at nine on weekdays.");
  d1.seed("Spring menu", "Asparagus, peas and new potatoes.");
  d1.seed("Holiday closure", "Closed for the week of the holidays.");
  const route = mcpRoute({
    collections: [
      { table: posts, config: postsConfig },
      { table: posts, config: auditConfig },
    ],
    resolveEditor: () => editor,
    server: { name: "site-example", version: "1.2.3" },
    instructions: "Posts are the site's news items.",
    ...extra,
  });
  const env = { DB: d1.db };
  // What a browser sends on a same-origin call; slice 2 accepts nothing else.
  const fetch = async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", ORIGIN);
    const res = await route(new Request(url, { ...init, headers }), env, ctx);
    return res ?? new Response("Not found", { status: 404 });
  };
  return { route, env, fetch };
}

async function connect(mode: "legacy" | "auto", editor: EditorSession = admin) {
  const { fetch } = setup(editor);
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { versionNegotiation: { mode } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_MCP), { fetch }));
  return client;
}

const structured = (result: unknown) =>
  (result as { structuredContent: Record<string, unknown> }).structuredContent;
const titles = (docs: unknown) => (docs as { title: string }[]).map((d) => d.title);

describe.each(["legacy", "auto"] as const)("mcpRoute with the SDK client (%s)", (mode) => {
  it("negotiates the era the client asked for", async () => {
    const client = await connect(mode);
    expect(client.getNegotiatedProtocolVersion()).toBe(
      mode === "auto" ? "2026-07-28" : "2025-11-25",
    );
    expect(client.getServerVersion()).toMatchObject({ name: "site-example", version: "1.2.3" });
    expect(client.getInstructions()).toBe("Posts are the site's news items.");
  });

  it("lists the read tools, and no write tools until slice 4", async () => {
    const client = await connect(mode);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "list_posts",
      "get_posts",
      "count_posts",
      "search_posts",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("lists newest first and pages with nextOffset", async () => {
    const client = await connect(mode);
    const first = structured(
      await client.callTool({ name: "list_posts", arguments: { limit: 2 } }),
    );
    expect(titles(first.docs)).toEqual(["Holiday closure", "Spring menu"]);
    expect(first.nextOffset).toBe(2);
    const last = structured(
      await client.callTool({ name: "list_posts", arguments: { limit: 2, offset: 2 } }),
    );
    expect(titles(last.docs)).toEqual(["Opening hours"]);
    expect(last.nextOffset).toBeUndefined();
  });

  it("gets, counts and searches through the Local API", async () => {
    const client = await connect(mode);
    const got = structured(await client.callTool({ name: "get_posts", arguments: { id: 2 } }));
    expect(got.doc).toMatchObject({ id: 2, title: "Spring menu" });
    const counted = structured(await client.callTool({ name: "count_posts", arguments: {} }));
    expect(counted.count).toBe(3);
    const found = structured(
      await client.callTool({ name: "search_posts", arguments: { query: "aspar" } }),
    );
    expect(titles(found.docs)).toEqual(["Spring menu"]);
  });

  it("reports a tool error as a result the model can read", async () => {
    const client = await connect(mode);
    const missing = await client.callTool({ name: "get_posts", arguments: { id: 99 } });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain('No \\"posts\\" document found with id 99');
  });
});

// ─── The wire, by hand ──────────────────────────────────────────────────────

const MODERN = "2026-07-28";

function rpc(
  body: unknown,
  {
    headers = {},
    method = "POST",
    url = URL_MCP,
  }: { headers?: Record<string, string>; method?: string; url?: string } = {},
) {
  return new Request(url, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

/** A modern request, with the headers the transport requires. */
function modern(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return rpc(
    {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN,
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    {
      headers: {
        "mcp-protocol-version": MODERN,
        "mcp-method": method,
        ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}),
        ...headers,
      },
    },
  );
}

async function send(request: Request, editor: EditorSession | null = admin) {
  const { route, env } = setup(editor);
  const res = await route(request, env, ctx);
  if (!res) throw new Error("the route fell through");
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
}

describe("mcpRoute — transport", () => {
  it("falls through on a path it doesn't own", async () => {
    const { route, env } = setup();
    expect(await route(rpc({}, { url: `${ORIGIN}/api/louise/pages` }), env, ctx)).toBeUndefined();
  });

  it("refuses GET and DELETE: there's no stream and no session", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await send(rpc(undefined, { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("needs a signed-in editor, same-origin", async () => {
    expect((await send(modern(1, "tools/list"), null)).status).toBe(401);
    const crossSite = modern(1, "tools/list", {}, { origin: "https://attacker.example" });
    expect((await send(crossSite)).status).toBe(403);
  });

  it("answers malformed JSON with a parse error", async () => {
    const res = await send(rpc("{not json"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32700);
    expect(res.body).not.toHaveProperty("id");
  });

  it("rejects a batch and a message that isn't JSON-RPC", async () => {
    expect((await send(rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }]))).body.error.code).toBe(
      -32600,
    );
    const noVersion = await send(rpc({ id: 7, method: "ping" }));
    expect(noVersion.body).toMatchObject({ id: 7, error: { code: -32600 } });
  });

  it("accepts a notification with 202 and no body", async () => {
    const res = await send(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
    expect(res.body).toBeUndefined();
  });
});

describe("mcpRoute — the 2026-07-28 revision", () => {
  it("serves server/discover, with every version it speaks", async () => {
    const { body } = await send(modern(1, "server/discover"));
    expect(body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"],
      capabilities: { tools: {} },
      instructions: "Posts are the site's news items.",
      cacheScope: "public",
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "site-example", version: "1.2.3" } },
    });
    expect(body.result.ttlMs).toBeGreaterThan(0);
  });

  it("marks tools/list private, since it depends on who asks", async () => {
    const { body } = await send(modern(1, "tools/list"));
    expect(body.result).toMatchObject({ resultType: "complete", cacheScope: "private" });
    expect(body.result.tools[0]).toEqual({
      name: "list_posts",
      description: expect.any(String),
      inputSchema: expect.objectContaining({ type: "object" }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    });
  });

  it("rejects an unsupported version, listing the supported ones", async () => {
    const req = rpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" } },
      },
      { headers: { "mcp-protocol-version": "2099-01-01", "mcp-method": "tools/list" } },
    );
    const res = await send(req);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: -32022,
      data: { requested: "2099-01-01", supported: expect.arrayContaining(["2026-07-28"]) },
    });
  });

  it("rejects headers that disagree with the body", async () => {
    const wrongVersion = await send(
      modern(1, "tools/list", {}, { "mcp-protocol-version": "2025-11-25" }),
    );
    expect(wrongVersion.status).toBe(400);
    expect(wrongVersion.body.error.code).toBe(-32020);

    const wrongMethod = await send(modern(1, "tools/list", {}, { "mcp-method": "tools/call" }));
    expect(wrongMethod.body.error.code).toBe(-32020);

    const wrongName = await send(
      modern(1, "tools/call", { name: "count_posts", arguments: {} }, { "mcp-name": "list_posts" }),
    );
    expect(wrongName.status).toBe(400);
    expect(wrongName.body.error.code).toBe(-32020);

    // A modern version in the header with no `_meta` in the body.
    const noMeta = await send(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { headers: { "mcp-protocol-version": MODERN } },
      ),
    );
    expect(noMeta.body.error.code).toBe(-32020);
  });

  it("decodes a Base64 Mcp-Name before comparing it", async () => {
    const encoded = `=?base64?${btoa("count_posts")}?=`;
    const res = await send(
      modern(1, "tools/call", { name: "count_posts", arguments: {} }, { "mcp-name": encoded }),
    );
    expect(res.status).toBe(200);
    expect(res.body.result.structuredContent).toEqual({ count: 3 });
  });

  it("answers an unknown method, and initialize, with a 404", async () => {
    for (const method of ["resources/list", "initialize", "ping"]) {
      const res = await send(modern(1, method));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(-32601);
    }
  });
});

describe("mcpRoute — the initialize handshake", () => {
  const initialize = (protocolVersion: string) =>
    rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion, capabilities: {}, clientInfo: { name: "c", version: "1" } },
    });

  it("echoes a version it speaks, and offers its newest otherwise", async () => {
    expect((await send(initialize("2025-06-18"))).body.result.protocolVersion).toBe("2025-06-18");
    expect((await send(initialize("2024-11-05"))).body.result.protocolVersion).toBe("2025-11-25");
  });

  it("carries no modern fields on a legacy result", async () => {
    const { body } = await send(initialize("2025-11-25"));
    expect(body.result).toEqual({
      protocolVersion: "2025-11-25",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "site-example", version: "1.2.3" },
      instructions: "Posts are the site's news items.",
    });
  });

  it("assumes 2025-03-26 without a version header, and rejects one it doesn't speak", async () => {
    const plain = await send(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(plain.body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    const unknown = await send(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { headers: { "mcp-protocol-version": "2024-11-05" } },
      ),
    );
    expect(unknown.status).toBe(400);
  });

  it("answers an unknown method with a JSON-RPC error on a 200", async () => {
    const res = await send(rpc({ jsonrpc: "2.0", id: 3, method: "resources/list" }));
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32601);
  });
});

describe("mcpRoute — tool calls", () => {
  const call = (name: string, args?: unknown) =>
    send(rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }));

  it("answers an unknown tool, or a hidden collection's, as invalid params", async () => {
    for (const name of ["delete_everything", "list_audit", "create_posts"]) {
      const res = await call(name, {});
      expect(res.body.error.code).toBe(-32602);
    }
  });

  it("checks arguments against the schema and says what's wrong", async () => {
    const cases: [string, unknown, string][] = [
      ["list_posts", { limit: 500 }, "`limit` must be a whole number from 1 to 100."],
      ["list_posts", { offset: -1 }, "`offset` must be a whole number, 0 or more."],
      ["list_posts", { where: "1=1" }, "Unknown argument: where. list_posts takes limit, offset."],
      ["get_posts", { id: "abc" }, "`id` must be a document id: a whole number."],
      ["search_posts", { query: "  " }, "`query` must be the words to search for."],
      ["count_posts", [], "`arguments` must be an object."],
    ];
    for (const [name, args, text] of cases) {
      const { result } = (await call(name, args)).body;
      expect(result).toEqual({ content: [{ type: "text", text }], isError: true });
    }
  });

  it("takes a numeric string id", async () => {
    const { result } = (await call("get_posts", { id: "3" })).body;
    expect(result.structuredContent.doc.title).toBe("Holiday closure");
  });

  it("escapes search syntax instead of failing on it", async () => {
    const { result } = (await call("search_posts", { query: 'menu" OR "' })).body;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.docs).toEqual([]);
  });
});

describe("mcpRoute — access", () => {
  it("hides tools the editor's role can't use", async () => {
    const { body } = await send(modern(1, "tools/list"), viewer);
    expect(body.result.tools).toEqual([]);
  });

  it("still refuses the call through the Local API's read check", async () => {
    const res = await send(modern(1, "tools/call", { name: "list_posts", arguments: {} }), viewer);
    expect(res.body.result).toEqual({
      content: [{ type: "text", text: "You don't have access to read posts." }],
      isError: true,
      resultType: "complete",
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "site-example", version: "1.2.3" } },
    });
  });

  it("refuses two collections that generate the same tool name", () => {
    expect(() =>
      mcpRoute({
        collections: [
          { table: posts, config: postsConfig },
          { table: posts, config: postsConfig },
        ],
        resolveEditor: () => admin,
        server: { name: "site-example", version: "1.0.0" },
      }),
    ).toThrow(/list_posts/);
  });
});
