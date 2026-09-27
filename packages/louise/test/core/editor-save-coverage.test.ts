// core/editor/save—the inline field-save route and applyFieldSave, writing
// to in-memory SQLite (#695).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { applyFieldSave, saveRoute } from "../../src/core/editor/save.js";

const posts = sqliteTable("posts", {
  id: integer("id").primaryKey(),
  title: text("title"),
  body: text("body"),
});
// No primary key: a save can't find its row, so it's refused (#702).
const notes = sqliteTable("notes", { text: text("text") });

function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT)`);
  sqlite.exec(`CREATE TABLE notes (text TEXT)`);
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
  const all = (table: string) => sqlite.prepare(`SELECT * FROM ${table}`).all();
  return { d1, sqlite, all };
}

const collections = {
  posts: { table: posts, fields: ["title", "body"], richFields: ["body"] },
  notes: { table: notes, fields: ["text"] },
};
const clean = (html: string) => html.replace(/<script>.*?<\/script>/g, "");

describe("applyFieldSave", () => {
  it("writes a plain field to the row with that id", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO posts (id, title) VALUES (1, 'Old'), (2, 'Other')`);
    const out = await applyFieldSave({ DB: h.d1 }, collections, clean, {
      collection: "posts",
      key: "1",
      field: "title",
      value: "Hello, Alex",
    });
    expect(out).toEqual({ ok: true });
    expect(h.all("posts")).toEqual([
      { id: 1, title: "Hello, Alex", body: null },
      { id: 2, title: "Other", body: null },
    ]);
  });

  it("sanitizes a rich field before it's stored", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO posts (id) VALUES (3)`);
    await applyFieldSave({ DB: h.d1 }, collections, clean, {
      collection: "posts",
      key: "3",
      field: "body",
      value: "<p>Hi</p><script>alert(1)</script>",
    });
    expect(h.all("posts")).toEqual([{ id: 3, title: null, body: "<p>Hi</p>" }]);
  });

  it("returns 404 when no row has the id", async () => {
    const h = sqliteD1();
    const out = await applyFieldSave({ DB: h.d1 }, collections, clean, {
      collection: "posts",
      key: "9",
      field: "title",
      value: "x",
    });
    expect(out).toEqual({ ok: false, status: 404, error: "Not found" });
  });

  it("rejects an id that isn't an integer before touching the database", async () => {
    const h = sqliteD1();
    for (const key of ["abc", "1.5"]) {
      const out = await applyFieldSave({ DB: h.d1 }, collections, clean, {
        collection: "posts",
        key,
        field: "title",
        value: "x",
      });
      expect(out).toEqual({ ok: false, status: 400, error: "Bad id" });
    }
  });

  it("passes on the field check's status and message", async () => {
    const h = sqliteD1();
    const out = await applyFieldSave({ DB: h.d1 }, collections, clean, {
      collection: "posts",
      key: "1",
      field: "title",
      value: 42,
    });
    expect(out).toEqual({ ok: false, status: 400, error: "Value must be a non-empty string" });
  });

  it("refuses a table without a primary key, and leaves its rows alone (#702)", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO notes (text) VALUES ('a'), ('b')`);
    const out = await applyFieldSave({ DB: h.d1 }, collections, clean, {
      collection: "notes",
      key: "1",
      field: "text",
      value: "Kai",
    });
    expect(out).toEqual({
      ok: false,
      status: 500,
      error: `Collection "notes" has no primary key, so a field save can't find its row`,
    });
    expect(h.all("notes")).toEqual([{ text: "a" }, { text: "b" }]);
  });
});

describe("saveRoute", () => {
  // saveRoute refuses a collection with no primary key at construction (#702).
  const routed = { posts: collections.posts };
  const editor = {
    userId: "u1",
    email: "quinn@example.com",
    name: "Quinn",
    role: "admin" as const,
  };
  const ctx = {} as ExecutionContext;
  const post = (body: string, path = "/api/louise/save") =>
    new Request(`https://example.com${path}`, {
      method: "POST",
      headers: { origin: "https://example.com", "content-type": "application/json" },
      body,
    });

  it("answers 400 to a body that isn't JSON or lacks a routing key", async () => {
    const h = sqliteD1();
    const route = saveRoute({ collections: routed, resolveEditor: () => editor });
    for (const body of [
      "not json",
      JSON.stringify({ collection: "posts", key: "1", value: "x" }),
    ]) {
      const res = await route(post(body), { DB: h.d1 }, ctx);
      expect(res?.status).toBe(400);
      expect(await res?.json()).toEqual({ error: "Bad payload" });
    }
  });

  it("saves through the default sanitizer and answers ok", async () => {
    const h = sqliteD1();
    h.sqlite.exec(`INSERT INTO posts (id) VALUES (1)`);
    const route = saveRoute({ collections: routed, resolveEditor: () => editor });
    const res = await route(
      post(
        JSON.stringify({
          collection: "posts",
          key: "1",
          field: "body",
          value: '<p onclick="steal()">Hi</p><script>alert(1)</script>',
        }),
      ),
      { DB: h.d1 },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
    const [row] = h.all("posts") as { body: string }[];
    expect(row.body).toContain("Hi");
    expect(row.body).not.toContain("<script");
    expect(row.body).not.toContain("onclick");
  });

  it("uses a custom sanitizer and mount path, and reports a missing row", async () => {
    const h = sqliteD1();
    const route = saveRoute({
      collections: routed,
      resolveEditor: () => editor,
      sanitize: clean,
      path: "/api/edit",
    });
    const body = JSON.stringify({ collection: "posts", key: "5", field: "title", value: "x" });
    expect(await route(post(body), { DB: h.d1 }, ctx)).toBeUndefined();
    const res = await route(post(body, "/api/edit"), { DB: h.d1 }, ctx);
    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "Not found" });
  });
});
