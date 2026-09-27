// core/editor/settings-blob—the blob-mode settings route over in-memory
// SQLite, and its allowlist merge (#695).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { blobSettingsRoute, mergeBlobPatch } from "../../src/core/editor/settings-blob.js";

const withUpdatedAt = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  data: text("data", { mode: "json" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// No primary key and no updatedAt: the update applies to the only row.
const bare = sqliteTable("blob_only", {
  data: text("data", { mode: "json" }),
});

/** A D1 binding over in-memory SQLite. */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE site_settings (id INTEGER PRIMARY KEY, data TEXT, updated_at INTEGER)`);
  sqlite.exec(`CREATE TABLE blob_only (data TEXT)`);
  const statement = (sql: string, binds: SQLInputValue[] = []) => {
    const run = () => sqlite.prepare(sql).all(...binds);
    return {
      bind: (...next: SQLInputValue[]) => statement(sql, next),
      all: async () => ({ success: true, results: run(), meta: {} }),
      run: async () => ({ success: true, results: run(), meta: {} }),
      raw: async () => run().map((row) => Object.values(row)),
      first: async () => run()[0] ?? null,
    };
  };
  const d1 = { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
  const row = (table = "site_settings") =>
    sqlite.prepare(`SELECT * FROM ${table}`).get() as Record<string, unknown> | undefined;
  return { d1, sqlite, row };
}

const editor = { userId: "u1", email: "alex@example.com", name: "Alex", role: "admin" as const };
const ctx = {} as ExecutionContext;
const req = (method: string, path = "/api/louise/settings", body?: string, origin = true) =>
  new Request(`https://example.com${path}`, {
    method,
    headers: origin ? { origin: "https://example.com" } : {},
    body,
  });

const allow = {
  siteName: (v: unknown) => String(v).trim().slice(0, 20),
  itemsPerPage: (v: unknown) => Math.min(50, Math.max(1, Number(v) || 10)),
};

describe("mergeBlobPatch", () => {
  it("sanitizes allowlisted keys, ignores the rest, and leaves the input alone", () => {
    const blob = { siteName: "Old", theme: "light" };
    const out = mergeBlobPatch(
      blob,
      { siteName: "  New  ", itemsPerPage: 500, admin: true },
      allow,
    );
    expect(out).toEqual({
      blob: { siteName: "New", theme: "light", itemsPerPage: 50 },
      ignored: ["admin"],
      changed: 2,
    });
    expect(blob).toEqual({ siteName: "Old", theme: "light" });
  });

  it("reports zero changes for a patch of only unknown keys", () => {
    expect(mergeBlobPatch({}, { x: 1 }, allow)).toEqual({ blob: {}, ignored: ["x"], changed: 0 });
  });
});

describe("blobSettingsRoute", () => {
  const route = blobSettingsRoute({
    table: withUpdatedAt,
    column: "data",
    resolveEditor: () => editor,
    allow,
  });

  it("falls through on another path", async () => {
    const h = sqliteD1();
    expect(await route(req("GET", "/api/louise/pages"), { DB: h.d1 }, ctx)).toBeUndefined();
  });

  it("answers 405 to an unsupported method", async () => {
    const h = sqliteD1();
    const res = await route(req("DELETE"), { DB: h.d1 }, ctx);
    expect(res?.status).toBe(405);
  });

  it("denies a request without an editor session", async () => {
    const h = sqliteD1();
    const denied = blobSettingsRoute({
      table: withUpdatedAt,
      column: "data",
      resolveEditor: () => null,
      allow,
    });
    const res = await denied(req("GET"), { DB: h.d1 }, ctx);
    expect(res?.status).toBeGreaterThanOrEqual(401);
    expect(res?.status).toBeLessThan(404);
  });

  it("rejects a cross-origin write", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO site_settings (id, data) VALUES (1, '{}')`);
    const res = await route(req("POST", undefined, '{"siteName":"x"}', false), { DB: h.d1 }, ctx);
    expect(res?.status).toBe(403);
    expect(h.row()?.data).toBe("{}");
  });

  it("reads an empty blob when there's no row", async () => {
    const h = sqliteD1();
    const res = await route(req("GET"), { DB: h.d1 }, ctx);
    expect(await res?.json()).toEqual({ settings: {} });
  });

  it("reads an empty blob when the column is null", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO site_settings (id, data) VALUES (1, NULL)`);
    const res = await route(req("GET"), { DB: h.d1 }, ctx);
    expect(await res?.json()).toEqual({ settings: {} });
  });

  it("passes the stored blob through the read transform", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO site_settings (id, data) VALUES (1, '{"siteName":"Example"}')`);
    const seeded = blobSettingsRoute({
      table: withUpdatedAt,
      column: "data",
      resolveEditor: () => editor,
      allow,
      read: (blob) => ({ itemsPerPage: 10, ...blob }),
    });
    const res = await seeded(req("GET"), { DB: h.d1 }, ctx);
    expect(await res?.json()).toEqual({ settings: { itemsPerPage: 10, siteName: "Example" } });
  });

  it("answers 404 to a write when there's no settings row", async () => {
    const h = sqliteD1();
    const res = await route(req("POST", undefined, '{"siteName":"x"}'), { DB: h.d1 }, ctx);
    expect(res?.status).toBe(404);
  });

  it("answers 400 to a body that isn't a JSON object", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO site_settings (id, data) VALUES (1, '{}')`);
    for (const body of ["not json", "[1,2]"]) {
      const res = await route(req("POST", undefined, body), { DB: h.d1 }, ctx);
      expect(res?.status).toBe(400);
      expect(await res?.json()).toEqual({ error: "Invalid JSON" });
    }
  });

  it("answers 400 and names the ignored keys when nothing is allowlisted", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO site_settings (id, data) VALUES (1, '{"siteName":"Keep"}')`);
    const res = await route(req("PATCH", undefined, '{"role":"owner"}'), { DB: h.d1 }, ctx);
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "Nothing to update", ignored: ["role"] });
    expect(JSON.parse(String(h.row()?.data))).toEqual({ siteName: "Keep" });
  });

  it("merges sanitized keys into the stored blob and stamps updatedAt", async () => {
    const h = sqliteD1();
    h.sqlite.exec(
      `INSERT INTO site_settings (id, data, updated_at) VALUES (1, '{"theme":"dark"}', 0)`,
    );
    const res = await route(
      req("POST", undefined, JSON.stringify({ siteName: " Kai's shop ", itemsPerPage: 0, x: 1 })),
      { DB: h.d1 },
      ctx,
    );
    expect(await res?.json()).toEqual({ ok: true, ignored: ["x"] });
    const row = h.row();
    expect(JSON.parse(String(row?.data))).toEqual({
      theme: "dark",
      siteName: "Kai's shop",
      itemsPerPage: 10,
    });
    expect(Number(row?.updated_at)).toBeGreaterThan(0);
  });

  it("writes into a null blob and targets a custom row id at a custom path", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO site_settings (id, data) VALUES (7, NULL)`);
    const custom = blobSettingsRoute({
      table: withUpdatedAt,
      column: "data",
      resolveEditor: () => editor,
      allow,
      path: "/api/site-config",
      id: 7,
    });
    const res = await custom(
      req("PATCH", "/api/site-config", '{"siteName":"Quinn"}'),
      { DB: h.d1 },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect(JSON.parse(String(h.row()?.data))).toEqual({ siteName: "Quinn" });
  });

  it("updates a table without a primary key or updatedAt column", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO blob_only (data) VALUES ('{}')`);
    const r = blobSettingsRoute({
      table: bare,
      column: "data",
      resolveEditor: () => editor,
      allow,
    });
    const res = await r(req("POST", undefined, '{"itemsPerPage":"25"}'), { DB: h.d1 }, ctx);
    expect(res?.status).toBe(200);
    expect(JSON.parse(String(h.row("blob_only")?.data))).toEqual({ itemsPerPage: 25 });
  });
});
