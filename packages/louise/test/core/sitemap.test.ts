import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import {
  collectionVersionsTable,
  createVersionedLocalApi,
  defineCollection,
} from "../../src/core/content/index.js";
import { toPageId, toVersionId } from "../../src/core/content/ids.js";
import { pages, pagesColumns, siteSettings } from "../../src/core/db/index.js";
import { sitemapRoute } from "../../src/core/editor/index.js";
import { robotsTxt, sitemapXml } from "../../src/core/seo/index.js";

// #583: sitemap.xml and robots.txt from the published pages, per request.

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

function site() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      body TEXT, status TEXT NOT NULL DEFAULT 'draft', seo_title TEXT, seo_description TEXT,
      og_image TEXT, noindex INTEGER NOT NULL DEFAULT 0, sort_order REAL DEFAULT 0,
      created_at INTEGER, updated_at INTEGER);
    CREATE TABLE site_settings (id INTEGER PRIMARY KEY DEFAULT 1, disable_indexing INTEGER NOT NULL DEFAULT 0);
    INSERT INTO site_settings (id) VALUES (1);
    INSERT INTO pages (slug, title, status, noindex, updated_at) VALUES
      ('home', 'Home', 'published', 0, 1767225600),
      ('about', 'About & us', 'published', 0, NULL),
      ('draft-page', 'Draft', 'draft', 0, NULL),
      ('legal', 'Legal', 'published', 1, NULL),
      ('footer', 'Footer', 'published', 0, NULL);
  `);
  return { sqlite, env: { DB: sqliteD1(sqlite) } };
}

const ctx = {} as ExecutionContext;
const get = (path: string, method = "GET") =>
  new Request(`https://preview.example.com${path}`, { method });

describe("sitemapXml", () => {
  it("escapes each URL, and lists lastmod only when it's a date", () => {
    const xml = sitemapXml([
      { loc: "https://example.com/?a=1&b=<2>", lastmod: new Date("2026-01-01T00:00:00Z") },
      { loc: "https://example.com/about", lastmod: "not a date" },
    ]);
    expect(xml).toContain(
      "<url><loc>https://example.com/?a=1&amp;b=&lt;2&gt;</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod></url>",
    );
    expect(xml).toContain("<url><loc>https://example.com/about</loc></url>");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
});

describe("robotsTxt", () => {
  it("allows everything by default and points at the sitemap", () => {
    expect(robotsTxt({ sitemapUrl: "https://example.com/sitemap.xml" })).toBe(
      "User-agent: *\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n",
    );
  });

  it("lists each disallowed path, and can't be split by a line break", () => {
    expect(robotsTxt({ disallow: ["/api/", "/x\nAllow: /"] })).toBe(
      "User-agent: *\nDisallow: /api/\nDisallow: /xAllow: /\n",
    );
  });
});

describe("sitemapRoute", () => {
  const route = () =>
    sitemapRoute({
      table: pages,
      settingsTable: siteSettings,
      origin: "https://example.com/",
      homeSlug: "home",
      exclude: ["footer"],
      extra: ["/examples"],
      disallow: ["/api/"],
    });

  it("lists published, indexable pages from the table, home first, with the extras", async () => {
    const { env } = site();
    const res = await route()(get("/sitemap.xml"), env, ctx);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("application/xml");
    expect(res?.headers.get("cache-control")).toBe("public, max-age=60");
    const locs = [...(await res!.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/examples",
    ]);
  });

  it("reads the table per request, so a publish shows up at once", async () => {
    const { sqlite, env } = site();
    sqlite.exec("UPDATE pages SET status = 'published' WHERE slug = 'draft-page'");
    const body = await (await route()(get("/sitemap.xml"), env, ctx))!.text();
    expect(body).toContain("<loc>https://example.com/draft-page</loc>");
  });

  it("lists nothing while the site is hidden from search engines", async () => {
    const { sqlite, env } = site();
    sqlite.exec("UPDATE site_settings SET disable_indexing = 1");
    const body = await (await route()(get("/sitemap.xml"), env, ctx))!.text();
    expect(body).not.toContain("<url>");
  });

  it("serves robots.txt with the sitemap on the configured origin", async () => {
    const { env } = site();
    const res = await route()(get("/robots.txt"), env, ctx);
    expect(res?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res!.text()).toBe(
      "User-agent: *\nDisallow: /api/\n\nSitemap: https://example.com/sitemap.xml\n",
    );
  });

  it("answers HEAD without a body, refuses other methods, and ignores other paths", async () => {
    const { env } = site();
    const head = await route()(get("/sitemap.xml", "HEAD"), env, ctx);
    expect(head?.status).toBe(200);
    expect(await head!.text()).toBe("");
    expect((await route()(get("/robots.txt", "POST"), env, ctx))?.status).toBe(405);
    expect(await route()(get("/about"), env, ctx)).toBeUndefined();
  });

  it("answers 503, not an empty sitemap, when the table can't be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sqlite, env } = site();
    sqlite.exec("DROP TABLE pages");
    const res = await route()(get("/sitemap.xml"), env, ctx);
    expect(res?.status).toBe(503);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("publish and the sitemap's lastmod", () => {
  it("moves a page's updatedAt when a version is published", async () => {
    const { sqlite, env } = site();
    const config = defineCollection({
      slug: "pages",
      fields: { title: { type: "text" } },
      versions: { drafts: true },
    });
    sqlite.exec(`ALTER TABLE pages ADD COLUMN published_version_id INTEGER;
      CREATE TABLE pages_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL,
        version_data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER,
        scheduled_at INTEGER);`);
    const table = sqliteTable("pages", {
      ...pagesColumns,
      publishedVersionId: integer("published_version_id"),
    });
    const api = createVersionedLocalApi(
      drizzle(env.DB),
      table,
      collectionVersionsTable(config),
      config,
    );
    const draft = await api.saveDraft({}, toPageId(2), { title: "About us" });
    const before = Date.now();
    await api.publish({}, toVersionId(draft.id as number));
    const row = sqlite.prepare("SELECT updated_at FROM pages WHERE id = 2").get() as {
      updated_at: number;
    };
    expect(row.updated_at * 1000).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
  });
});
