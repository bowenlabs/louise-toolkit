import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { editorsRoute } from "../../src/core/editor/index.js";

// Against real SQLite rather than a SQL-recording fake: the bug this guards is
// a missing WHERE clause, and only a table holding both editors and customers
// shows whether the query actually leaves the customers out.

/** The slice of D1 the editors route uses, over an in-memory SQLite table. */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE "user" (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER, createdAt TEXT, updatedAt TEXT, role TEXT,
    firstName TEXT, lastName TEXT)`);
  const statement = (sql: string, binds: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    all: async () => ({ results: sqlite.prepare(sql).all(...binds) }),
    first: async () => sqlite.prepare(sql).get(...binds) ?? null,
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...binds).changes) } }),
  });
  const seed = (id: string, email: string, role: string, createdAt: string) =>
    sqlite
      .prepare(`INSERT INTO "user" (id, name, email, role, createdAt) VALUES (?, ?, ?, ?, ?)`)
      .run(id, email.split("@")[0] ?? id, email, role, createdAt);
  const ids = () =>
    (sqlite.prepare(`SELECT id FROM "user" ORDER BY id`).all() as { id: string }[]).map(
      (r) => r.id,
    );
  return { db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database, seed, ids };
}

const editor: EditorSession = { userId: "e1", email: "owner@x.com", name: "Owner", role: "admin" };
const ctx = {} as ExecutionContext;
const BASE = "https://site.example/api/louise/editors";
const req = (method: string, url = BASE) =>
  new Request(url, { method, headers: { origin: "https://site.example" } });

/** Two editors and two customers sharing Better Auth's `user` table. */
function mixedTable() {
  const d1 = sqliteD1();
  d1.seed("e1", "owner@x.com", "admin", "2026-01-01");
  d1.seed("c1", "shopper@y.com", "user", "2026-01-02");
  d1.seed("e2", "second@x.com", "admin", "2026-01-03");
  d1.seed("c2", "buyer@z.com", "user", "2026-01-04");
  return d1;
}

describe("editorsRoute", () => {
  const route = editorsRoute({ resolveEditor: () => editor });

  it("lists editors only — never the customers sharing the table", async () => {
    const { db } = mixedTable();
    const res = await route(req("GET"), { DB: db }, ctx);
    expect(res?.status).toBe(200);
    const { editors } = (await res?.json()) as { editors: { email: string }[] };
    expect(editors.map((e) => e.email)).toEqual(["owner@x.com", "second@x.com"]);
  });

  it("removes an editor by id", async () => {
    const { db, ids } = mixedTable();
    const res = await route(req("DELETE", `${BASE}?id=e2`), { DB: db }, ctx);
    expect(res?.status).toBe(200);
    expect(ids()).toEqual(["c1", "c2", "e1"]);
  });

  it("refuses to delete a customer's account by id", async () => {
    const { db, ids } = mixedTable();
    const res = await route(req("DELETE", `${BASE}?id=c1`), { DB: db }, ctx);
    expect(res?.status).toBe(404);
    expect(ids()).toEqual(["c1", "c2", "e1", "e2"]);
  });

  it("still refuses to remove the last editor, however many customers there are", async () => {
    const d1 = sqliteD1();
    d1.seed("e1", "owner@x.com", "admin", "2026-01-01");
    d1.seed("c1", "shopper@y.com", "user", "2026-01-02");
    const res = await route(req("DELETE", `${BASE}?id=e1`), { DB: d1.db }, ctx);
    expect(res?.status).toBe(400);
    expect(d1.ids()).toEqual(["c1", "e1"]);
  });

  it("401s without an editor session, before any query", async () => {
    const { db, ids } = mixedTable();
    const guarded = editorsRoute({ resolveEditor: () => null });
    expect((await guarded(req("GET"), { DB: db }, ctx))?.status).toBe(401);
    expect((await guarded(req("DELETE", `${BASE}?id=c1`), { DB: db }, ctx))?.status).toBe(401);
    expect(ids()).toHaveLength(4);
  });
});
