import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import {
  db,
  pageRedirects,
  pages,
  resolvePageRedirect,
  slugPath,
} from "../../src/core/db/index.js";
import { collectionVersionsTable, defineCollection } from "../../src/core/content/index.js";
import { pagesRoute, versionsRoute } from "../../src/core/editor/index.js";

// A renamed page keeps its old URL working (#574). Against real SQLite, because
// what's under test is the SQL: the upsert, the chain flattening, and the
// cleanup that stops a redirect shadowing a live page.

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

function fresh() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      body TEXT, status TEXT NOT NULL DEFAULT 'draft', seo_title TEXT, seo_description TEXT,
      og_image TEXT, noindex INTEGER NOT NULL DEFAULT 0, sort_order REAL DEFAULT 0,
      created_at INTEGER, updated_at INTEGER);
    CREATE TABLE page_redirects (
      from_path TEXT PRIMARY KEY, to_path TEXT NOT NULL, code INTEGER NOT NULL DEFAULT 301,
      created_at INTEGER);
    INSERT INTO pages (slug, title) VALUES ('about-us', 'About');
  `);
  const DB = sqliteD1(sqlite);
  const redirects = () =>
    sqlite.prepare("SELECT from_path, to_path FROM page_redirects ORDER BY from_path").all() as {
      from_path: string;
      to_path: string;
    }[];
  return {
    DB,
    redirects,
    resolve: (path: string) => resolvePageRedirect(db(DB), pageRedirects, path),
  };
}

const editor: EditorSession = { userId: "u1", email: "e@example.com", name: "Alex", role: "admin" };
const ctx = {} as ExecutionContext;
const route = pagesRoute({ table: pages, resolveEditor: () => editor, redirects: pageRedirects });
const request = (method: string, path: string, body: unknown) =>
  new Request(`https://site.example/api/louise/pages${path}`, {
    method,
    headers: { origin: "https://site.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const rename = (DB: D1Database, slug: string) =>
  route(request("PATCH", "/1", { slug }), { DB }, ctx);

describe("pagesRoute—a rename remembers the old URL", () => {
  it("records the old path, and the resolver sends it to the new one", async () => {
    const { DB, redirects, resolve } = fresh();
    expect((await rename(DB, "about"))?.status).toBe(200);
    expect(redirects()).toEqual([{ from_path: "/about-us", to_path: "/about" }]);
    expect(await resolve("/about-us")).toEqual({ location: "/about", status: 301 });
    expect(await resolve("/about-us/")).toEqual({ location: "/about", status: 301 });
  });

  it("keeps a chain of renames to one hop", async () => {
    const { DB, redirects, resolve } = fresh();
    await rename(DB, "about");
    await rename(DB, "who-we-are");
    expect(redirects()).toEqual([
      { from_path: "/about", to_path: "/who-we-are" },
      { from_path: "/about-us", to_path: "/who-we-are" },
    ]);
    expect(await resolve("/about-us")).toEqual({ location: "/who-we-are", status: 301 });
  });

  it("drops the redirect from a path that's a live page again", async () => {
    const { DB, redirects, resolve } = fresh();
    await rename(DB, "about");
    await rename(DB, "about-us");
    expect(redirects()).toEqual([{ from_path: "/about", to_path: "/about-us" }]);
    expect(await resolve("/about-us")).toBeNull();
  });

  it("clears a redirect when a new page takes the old path", async () => {
    const { DB, redirects } = fresh();
    await rename(DB, "about");
    const res = await route(
      request("POST", "", { slug: "about-us", title: "About us" }),
      { DB },
      ctx,
    );
    expect(res?.status).toBe(201);
    expect(redirects()).toEqual([]);
  });

  it("writes nothing when the slug doesn't change, or redirects aren't on", async () => {
    const { DB, redirects } = fresh();
    await rename(DB, "about-us");
    await route(request("PATCH", "/1", { title: "About" }), { DB }, ctx);
    expect(redirects()).toEqual([]);
    const plain = pagesRoute({ table: pages, resolveEditor: () => editor });
    await plain(request("PATCH", "/1", { slug: "about" }), { DB }, ctx);
    expect(redirects()).toEqual([]);
  });

  it("answers a path that never moved with nothing", async () => {
    const { resolve } = fresh();
    expect(await resolve("/contact")).toBeNull();
  });
});

describe("slugPath", () => {
  it("is the path a visitor requests", () => {
    expect(slugPath("about")).toBe("/about");
    expect(slugPath("/about")).toBe("/about");
  });
});

describe("versionsRoute—a publish that changes the slug", () => {
  const docs = sqliteTable("docs", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    publishedVersionId: integer("published_version_id"),
  });
  const config = defineCollection({
    slug: "docs",
    fields: { slug: { type: "text" }, title: { type: "text" } },
    versions: { drafts: true },
  });

  it("remembers the old URL once the new slug goes live", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, title TEXT NOT NULL,
        published_version_id INTEGER);
      CREATE TABLE docs_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL,
        version_data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER,
        scheduled_at INTEGER);
      CREATE TABLE page_redirects (
        from_path TEXT PRIMARY KEY, to_path TEXT NOT NULL, code INTEGER NOT NULL DEFAULT 301,
        created_at INTEGER);
      INSERT INTO docs (slug, title) VALUES ('old-name', 'Doc');
    `);
    const DB = sqliteD1(sqlite);
    const versions = versionsRoute({
      table: docs,
      versionsTable: collectionVersionsTable(config),
      config,
      resolveEditor: () => editor,
      redirects: pageRedirects,
    });
    const post = (path: string, body: unknown) =>
      versions(
        new Request(`https://site.example/api/louise/pages/1/${path}`, {
          method: "POST",
          headers: { origin: "https://site.example", "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { DB },
        ctx,
      );

    expect((await post("versions", { slug: "new-name" }))?.status).toBe(201);
    // A draft isn't live, so nothing moves yet.
    expect(await resolvePageRedirect(db(DB), pageRedirects, "/old-name")).toBeNull();
    expect((await post("publish", {}))?.status).toBe(200);
    expect(await resolvePageRedirect(db(DB), pageRedirects, "/old-name")).toEqual({
      location: "/new-name",
      status: 301,
    });
  });
});
