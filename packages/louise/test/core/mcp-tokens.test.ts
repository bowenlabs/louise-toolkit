import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type EditorSession,
  editorForUser,
  type LouiseAuthEnv,
} from "../../src/core/auth/index.js";
import type { CollectionConfig } from "../../src/core/content/types.js";
import {
  AGENT_TOKEN_MAX_DAYS,
  AGENT_TOKEN_PREFIX,
  agentMay,
  agentTokensRoute,
  bearerToken,
  hashAgentToken,
  issueAgentToken,
  listAgentTokens,
  mcpRoute,
  parseAgentScope,
  resolveMcpSession,
  revokeAgentToken,
  verifyAgentToken,
} from "../../src/core/mcp/index.js";
import { composeWorker } from "../../src/core/worker/index.js";

// Agent tokens (ADR 0009 §5, #235): the first credential in the toolkit that
// isn't a session cookie. Against real SQLite, and end to end through
// `composeWorker`'s gate with the official MCP client sending the token.

const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
});
const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
});
const postsConfig: CollectionConfig = {
  slug: "posts",
  fields: { title: { type: "text", required: true } },
  versions: { drafts: true },
};
const notesConfig: CollectionConfig = {
  slug: "notes",
  fields: { body: { type: "text", required: true } },
};
const collections = [
  { table: posts, config: postsConfig },
  { table: notes, config: notesConfig },
];

const AGENT_TOKENS_DDL = `CREATE TABLE agent_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  hint TEXT NOT NULL,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX agent_tokens_token_hash ON agent_tokens (token_hash);`;

// The user table as Louise's auth schema generates it.
const USER_DDL = `CREATE TABLE "user" (
  "id" text primary key not null, "name" text not null, "email" text not null unique,
  "emailVerified" integer not null, "createdAt" date not null, "updatedAt" date not null,
  "role" text, "banned" integer, "banReason" text, "banExpires" date
);`;

/** A D1 double over in-memory SQLite: drizzle reads a select through `raw()`
 *  and everything else through `all()` or `run()`. */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(AGENT_TOKENS_DDL);
  sqlite.exec(USER_DDL);
  sqlite.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL)`);
  sqlite.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)`);
  sqlite.exec(`INSERT INTO posts (title) VALUES ('Opening hours'), ('Spring menu')`);
  sqlite.exec(`INSERT INTO notes (body) VALUES ('Order more flour')`);
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
  const addUser = (
    id: string,
    email: string,
    role: string,
    extra: { banned?: number; banExpires?: string | null } = {},
  ) =>
    sqlite
      .prepare(
        `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, banned, banExpires)
         VALUES (?, ?, ?, 1, '2026-01-01', '2026-01-01', ?, ?, ?)`,
      )
      .run(id, email.split("@")[0] ?? "", email, role, extra.banned ?? 0, extra.banExpires ?? null);
  return {
    sqlite,
    addUser,
    db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database,
  };
}

const ORIGIN = "https://site.example";
const alex: EditorSession = {
  userId: "u1",
  email: "alex@example.com",
  name: "Alex",
  role: "admin",
};
const kai: EditorSession = { userId: "u2", email: "kai@example.com", name: "Kai", role: "admin" };
const ctx = {} as ExecutionContext;

function authEnv(d1: D1Database): LouiseAuthEnv {
  return {
    DB: d1,
    OWNER_EMAIL: "alex@example.com",
    ENGINEER_EMAIL: "kai@example.com",
  } as unknown as LouiseAuthEnv;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("issuing and verifying agent tokens", () => {
  it("issues a prefixed token, stores only its hash, and verifies it", async () => {
    const d1 = sqliteD1();
    const { token, info } = await issueAgentToken(d1.db, {
      owner: alex,
      name: "  Claude Code  ",
      scope: { posts: "read" },
    });
    expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(AGENT_TOKEN_PREFIX.length + 40);
    expect(info).toMatchObject({
      name: "Claude Code",
      hint: token.slice(-4),
      scope: { posts: "read" },
    });
    expect(info.id).toMatch(/^tok_[0-9a-f]{16}$/);
    const days = (info.expiresAt.getTime() - info.createdAt.getTime()) / 86_400_000;
    expect(days).toBe(30);

    const stored = d1.sqlite.prepare("SELECT * FROM agent_tokens").all();
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored[0]).toMatchObject({ token_hash: await hashAgentToken(token) });

    expect(await verifyAgentToken(d1.db, token)).toEqual({
      id: info.id,
      name: "Claude Code",
      userId: "u1",
      scope: { posts: "read" },
    });
  });

  it("refuses a token that's malformed, unknown, revoked, or expired", async () => {
    const d1 = sqliteD1();
    const { token, info } = await issueAgentToken(d1.db, {
      owner: alex,
      name: "Agent",
      scope: { posts: "read" },
      expiresInDays: 1,
    });
    expect(await verifyAgentToken(d1.db, "not-a-token")).toBeNull();
    expect(await verifyAgentToken(d1.db, `${AGENT_TOKEN_PREFIX}unknown`)).toBeNull();
    expect(await verifyAgentToken(d1.db, `${token}x`)).toBeNull();

    vi.useFakeTimers({ now: Date.now() + 2 * 86_400_000, toFake: ["Date"] });
    expect(await verifyAgentToken(d1.db, token)).toBeNull();
    vi.useRealTimers();

    expect(await verifyAgentToken(d1.db, token)).not.toBeNull();
    expect(await revokeAgentToken(d1.db, { id: info.id, userId: "u1" })).toBe(true);
    expect(await verifyAgentToken(d1.db, token)).toBeNull();
    // Revoking twice finds no live token.
    expect(await revokeAgentToken(d1.db, { id: info.id, userId: "u1" })).toBe(false);
  });

  it("revokes only the owner's token", async () => {
    const d1 = sqliteD1();
    const { token, info } = await issueAgentToken(d1.db, {
      owner: alex,
      name: "Agent",
      scope: { posts: "read" },
    });
    expect(await revokeAgentToken(d1.db, { id: info.id, userId: kai.userId })).toBe(false);
    expect(await verifyAgentToken(d1.db, token)).not.toBeNull();
  });

  it("records use at most once an hour", async () => {
    const d1 = sqliteD1();
    const { token } = await issueAgentToken(d1.db, {
      owner: alex,
      name: "Agent",
      scope: { posts: "read" },
    });
    const lastUsed = () =>
      (d1.sqlite.prepare("SELECT last_used_at FROM agent_tokens").get() as { last_used_at: number })
        .last_used_at;
    await verifyAgentToken(d1.db, token);
    const first = lastUsed();
    expect(first).toBeGreaterThan(0);
    await verifyAgentToken(d1.db, token);
    expect(lastUsed()).toBe(first);
    vi.useFakeTimers({ now: Date.now() + 2 * 60 * 60 * 1000, toFake: ["Date"] });
    await verifyAgentToken(d1.db, token);
    expect(lastUsed()).toBeGreaterThan(first);
  });

  it("lists an editor's own tokens, newest first, with no secrets", async () => {
    const d1 = sqliteD1();
    vi.useFakeTimers({ now: Date.parse("2026-09-01T00:00:00Z"), toFake: ["Date"] });
    await issueAgentToken(d1.db, { owner: alex, name: "First", scope: { posts: "read" } });
    vi.setSystemTime(Date.parse("2026-09-02T00:00:00Z"));
    await issueAgentToken(d1.db, { owner: alex, name: "Second", scope: { notes: "draft" } });
    await issueAgentToken(d1.db, { owner: kai, name: "Kai's", scope: { posts: "read" } });
    const list = await listAgentTokens(d1.db, alex.userId);
    expect(list.map((t) => t.name)).toEqual(["Second", "First"]);
    expect(Object.keys(list[0] ?? {})).not.toContain("tokenHash");
  });

  it("refuses an agent, a blank name, an empty scope, and a lifetime out of range", async () => {
    const d1 = sqliteD1();
    const base = { owner: alex, name: "Agent", scope: { posts: "read" } } as const;
    const agent = { ...alex, agent: { tokenId: "tok_1", name: "Agent", scope: {} } };
    await expect(issueAgentToken(d1.db, { ...base, owner: agent })).rejects.toThrow(
      "can't issue another token",
    );
    await expect(issueAgentToken(d1.db, { ...base, name: "   " })).rejects.toThrow("name");
    await expect(issueAgentToken(d1.db, { ...base, scope: {} })).rejects.toThrow(
      "at least one collection",
    );
    for (const expiresInDays of [0, AGENT_TOKEN_MAX_DAYS + 1, 1.5]) {
      await expect(issueAgentToken(d1.db, { ...base, expiresInDays })).rejects.toThrow("days");
    }
  });
});

describe("agent scopes", () => {
  it("ranks read, draft and publish, and reaches no unlisted collection", () => {
    const scope = { posts: "draft", notes: "publish" } as const;
    expect(agentMay(scope, "posts", "read")).toBe(true);
    expect(agentMay(scope, "posts", "draft")).toBe(true);
    expect(agentMay(scope, "posts", "publish")).toBe(false);
    expect(agentMay(scope, "notes", "publish")).toBe(true);
    expect(agentMay(scope, "pages", "read")).toBe(false);
    expect(agentMay(scope, "toString", "read")).toBe(false);
  });

  it("parses a scope, and says what's wrong with a bad one", () => {
    expect(parseAgentScope({ posts: "read" })).toEqual({ posts: "read" });
    expect(parseAgentScope(["posts"])).toMatch("maps each collection");
    expect(parseAgentScope({ posts: "write" })).toMatch("read, draft, or publish");
    expect(parseAgentScope({ "no spaces": "read" })).toMatch("isn't a collection slug");
    expect(parseAgentScope({})).toMatch("at least one collection");
  });

  it("reads a bearer token from the Authorization header", () => {
    const req = (value?: string) =>
      new Request(ORIGIN, value ? { headers: { authorization: value } } : {});
    expect(bearerToken(req("Bearer abc"))).toBe("abc");
    expect(bearerToken(req("bearer   abc  "))).toBe("abc");
    expect(bearerToken(req("Basic abc"))).toBeNull();
    expect(bearerToken(req("Bearer a b"))).toBeNull();
    expect(bearerToken(req())).toBeNull();
  });
});

describe("editorForUser", () => {
  it("re-derives an editor who's still an admin on the allowlist", async () => {
    const d1 = sqliteD1();
    d1.addUser("u1", "Alex@Example.com", "admin");
    expect(await editorForUser(authEnv(d1.db), "u1")).toEqual({
      userId: "u1",
      email: "Alex@Example.com",
      name: "Alex",
      role: "admin",
    });
  });

  it("refuses a missing user, another role, a ban, and an email off the allowlist", async () => {
    const d1 = sqliteD1();
    d1.addUser("u2", "kai@example.com", "user");
    d1.addUser("u3", "alex@example.com", "admin", { banned: 1 });
    d1.addUser("u4", "quinn@example.com", "admin");
    d1.addUser("u5", "kai+ban@example.com", "admin", { banned: 1, banExpires: "not a date" });
    const env = authEnv(d1.db);
    for (const id of ["nobody", "u2", "u3", "u4"]) {
      expect(await editorForUser(env, id), id).toBeNull();
    }
    expect(
      await editorForUser(env, "u5", { resolveAdmins: () => ["kai+ban@example.com"] }),
    ).toBeNull();
  });

  it("lets a lapsed ban go, and takes a custom role and allowlist", async () => {
    const d1 = sqliteD1();
    d1.addUser("u1", "quinn@example.com", "editor", {
      banned: 1,
      banExpires: "2020-01-01T00:00:00.000Z",
    });
    const editor = await editorForUser(authEnv(d1.db), "u1", {
      editorRole: "editor",
      resolveAdmins: () => ["quinn@example.com"],
    });
    expect(editor?.role).toBe("editor");
  });

  it("refuses a table prefix that isn't an identifier", async () => {
    const d1 = sqliteD1();
    await expect(
      editorForUser(authEnv(d1.db), "u1", { tablePrefix: 'x"; DROP TABLE user; --' }),
    ).rejects.toThrow("Invalid auth table prefix");
  });
});

describe("resolveMcpSession", () => {
  async function setup() {
    const d1 = sqliteD1();
    d1.addUser("u1", "alex@example.com", "admin");
    const env = authEnv(d1.db);
    const { token, info } = await issueAgentToken(d1.db, {
      owner: alex,
      name: "Claude Code",
      scope: { posts: "read" },
    });
    const resolve = resolveMcpSession<LouiseAuthEnv>({
      resolveUser: (userId, e) => editorForUser(e, userId),
    });
    const req = (value: string) =>
      new Request(`${ORIGIN}/api/louise/mcp`, { headers: { authorization: `Bearer ${value}` } });
    return { d1, env, token, info, resolve, req };
  }

  it("resolves a token to its editor, with the agent attached", async () => {
    const { env, token, info, resolve, req } = await setup();
    expect(await resolve(req(token), env)).toEqual({
      userId: "u1",
      email: "alex@example.com",
      name: "alex",
      role: "admin",
      agent: { tokenId: info.id, name: "Claude Code", scope: { posts: "read" } },
    });
  });

  it("stops working when the editor loses access", async () => {
    const { d1, env, token, resolve, req } = await setup();
    d1.sqlite.prepare(`UPDATE "user" SET role = 'user' WHERE id = 'u1'`).run();
    expect(await resolve(req(token), env)).toBeNull();
  });

  it("refuses no token, a bad token, and a resolver that answers with someone else", async () => {
    const { env, token, resolve, req } = await setup();
    expect(await resolve(new Request(ORIGIN), env)).toBeNull();
    expect(await resolve(req(`${AGENT_TOKEN_PREFIX}nope`), env)).toBeNull();
    const confused = resolveMcpSession({ resolveUser: () => kai });
    expect(await confused(req(token), env)).toBeNull();
  });
});

describe("agentTokensRoute", () => {
  function setup(editor: EditorSession | null = alex) {
    const d1 = sqliteD1();
    const route = agentTokensRoute({ resolveEditor: () => editor, collections });
    const call = async (
      method: string,
      init: { body?: unknown; query?: string; origin?: string } = {},
    ) => {
      const headers = new Headers({ "content-type": "application/json" });
      headers.set("origin", init.origin ?? ORIGIN);
      const res = await route(
        new Request(`${ORIGIN}/api/louise/mcp/tokens${init.query ?? ""}`, {
          method,
          headers,
          ...(init.body === undefined
            ? {}
            : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
        }),
        { DB: d1.db },
        ctx,
      );
      return res as Response;
    };
    return { d1, route, call };
  }

  it("issues, lists and revokes the editor's own tokens", async () => {
    const { call } = setup();
    const issued = await call("POST", {
      body: { name: "Claude Code", scope: { posts: "draft" }, expiresInDays: 7 },
    });
    expect(issued.status).toBe(201);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    const { token, info } = (await issued.json()) as { token: string; info: { id: string } };
    expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);

    const listed = (await (await call("GET")).json()) as { tokens: Record<string, unknown>[] };
    expect(listed.tokens).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);

    expect((await call("DELETE", { query: `?id=${info.id}` })).status).toBe(204);
    expect((await call("DELETE", { query: `?id=${info.id}` })).status).toBe(404);
    expect((await call("DELETE", { query: "?id=nope" })).status).toBe(400);
  });

  it("refuses a scope naming a collection the site doesn't have, and bad bodies", async () => {
    const { call } = setup();
    const unknown = await call("POST", { body: { name: "A", scope: { pages: "read" } } });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "This site has no collection named pages." });
    expect((await call("POST", { body: { name: "A", scope: {} } })).status).toBe(400);
    expect((await call("POST", { body: { name: "", scope: { posts: "read" } } })).status).toBe(400);
    expect(
      (await call("POST", { body: { name: "A", scope: { posts: "read" }, expiresInDays: "7" } }))
        .status,
    ).toBe(400);
    expect((await call("POST", { body: "{" })).status).toBe(400);
    expect((await call("POST", { body: [] })).status).toBe(400);
  });

  it("is a cookie route: origin-checked, and closed to agents", async () => {
    expect((await setup().call("POST", { body: {}, origin: "https://evil.example" })).status).toBe(
      403,
    );
    expect((await setup(null).call("GET")).status).toBe(401);
    const agent = { ...alex, agent: { tokenId: "tok_1", name: "Agent", scope: {} } };
    expect((await setup(agent).call("GET")).status).toBe(403);
  });

  it("falls through on another path, and refuses other methods", async () => {
    const { route, call } = setup();
    expect(
      await route(new Request(`${ORIGIN}/api/louise/other`), { DB: sqliteD1().db }, ctx),
    ).toBeUndefined();
    expect((await call("PUT")).status).toBe(405);
  });
});

describe("mcpRoute with an agent token, behind composeWorker's gate", () => {
  async function setup(scope: Record<string, "read" | "draft" | "publish"> = { posts: "read" }) {
    const d1 = sqliteD1();
    d1.addUser("u1", "alex@example.com", "admin");
    const env = authEnv(d1.db);
    const { token, info } = await issueAgentToken(d1.db, {
      owner: alex,
      name: "Claude Code",
      scope,
    });
    const cookieEditor = vi.fn((): EditorSession | null => null);
    const worker = composeWorker<LouiseAuthEnv>({
      gate: { resolveEditor: cookieEditor },
      routes: [
        mcpRoute<LouiseAuthEnv>({
          collections,
          resolveEditor: cookieEditor,
          resolveAgent: resolveMcpSession({ resolveUser: (id, e) => editorForUser(e, id) }),
          server: { name: "site-example", version: "1.0.0" },
        }),
      ],
      fetch: async () => new Response("fallback", { status: 404 }),
    });
    // What a headless agent sends: no Origin, no cookie.
    const fetch = (url: string | URL, init?: RequestInit) =>
      worker.fetch!(new Request(url, init) as never, env, ctx) as Promise<Response>;
    const connect = async (bearer = token) => {
      const client = new Client({ name: "agent", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/louise/mcp`), {
          fetch,
          requestInit: { headers: { authorization: `Bearer ${bearer}` } },
        }),
      );
      return client;
    };
    return { d1, env, token, info, fetch, connect, cookieEditor };
  }

  const rpc = (id: number, method: string, params: Record<string, unknown> = {}) =>
    JSON.stringify({ jsonrpc: "2.0", id, method, params });

  it("serves the official client a token's in-scope tools, with no Origin", async () => {
    const { connect, cookieEditor } = await setup();
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_posts", "get_posts", "count_posts"]);
    const result = await client.callTool({ name: "count_posts", arguments: {} });
    expect(result.structuredContent).toEqual({ count: 2 });
    // The token authenticated the request; the cookie resolver was never the credential.
    expect(cookieEditor).not.toHaveBeenCalled();
  });

  it("refuses an out-of-scope tool as a result the model can read", async () => {
    const { connect } = await setup();
    const client = await connect();
    const result = await client.callTool({ name: "count_notes", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("doesn't cover count_notes");
  });

  it("answers a bad token with a 401 challenge", async () => {
    const { fetch } = await setup();
    const res = await fetch(`${ORIGIN}/api/louise/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AGENT_TOKEN_PREFIX}nope`,
        "content-type": "application/json",
      },
      body: rpc(1, "tools/list"),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("takes effect on the next request when the token is revoked", async () => {
    const { d1, connect, info } = await setup();
    const client = await connect();
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await revokeAgentToken(d1.db, { id: info.id, userId: "u1" });
    await expect(client.listTools()).rejects.toThrow();
  });

  it("gives a bearer token no way into any other route under the prefix", async () => {
    const { fetch, token } = await setup();
    const res = await fetch(`${ORIGIN}/api/louise/pages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("still serves a signed-in editor in a browser, under cookie rules", async () => {
    const { fetch, cookieEditor } = await setup();
    cookieEditor.mockReturnValue(kai);
    const headers = {
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    };
    const sameOrigin = await fetch(`${ORIGIN}/api/louise/mcp`, {
      method: "POST",
      headers: { ...headers, origin: ORIGIN },
      body: rpc(1, "tools/list"),
    });
    const { result } = (await sameOrigin.json()) as { result: { tools: { name: string }[] } };
    // No token, so no scope: the editor sees every collection their access allows.
    expect(result.tools.map((t) => t.name)).toContain("count_notes");
    const crossSite = await fetch(`${ORIGIN}/api/louise/mcp`, {
      method: "POST",
      headers: { ...headers, origin: "https://evil.example" },
      body: rpc(1, "tools/list"),
    });
    expect(crossSite.status).toBe(403);
  });

  it("takes no bearer token when the route wasn't given resolveAgent", async () => {
    const d1 = sqliteD1();
    const route = mcpRoute({
      collections,
      resolveEditor: () => alex,
      server: { name: "site-example", version: "1.0.0" },
    });
    const res = (await route(
      new Request(`${ORIGIN}/api/louise/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer anything", origin: ORIGIN },
        body: rpc(1, "tools/list"),
      }),
      { DB: d1.db },
      ctx,
    )) as Response;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "This server doesn't accept bearer tokens." });
  });

  it("refuses a resolveAgent that returns a session with no scope", async () => {
    const d1 = sqliteD1();
    const route = mcpRoute({
      collections,
      resolveEditor: () => null,
      resolveAgent: () => alex,
      server: { name: "site-example", version: "1.0.0" },
    });
    const res = (await route(
      new Request(`${ORIGIN}/api/louise/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer anything" },
        body: rpc(1, "tools/list"),
      }),
      { DB: d1.db },
      ctx,
    )) as Response;
    expect(res.status).toBe(401);
  });
});
