// core/editor/search—the semantic layer: a stubbed Vectorize index and AI
// runner fused with real FTS5 results over in-memory SQLite (#695).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiRunner, VectorIndex, VectorQueryOptions } from "../../src/core/ai/index.js";
import { collectionSearchTableSQL, defineCollection } from "../../src/core/content/index.js";
import { pages } from "../../src/core/db/index.js";
import {
  parseSearchLimit,
  SEARCH_LIMIT_DEFAULT,
  searchRoute,
  type SearchVectorConfig,
  toFtsQuery,
} from "../../src/core/editor/search.js";

const pagesSearch = defineCollection({
  slug: "pages",
  fields: { title: { type: "text" }, body: { type: "text" } },
  search: { fields: ["title", "body"] },
});

/** A D1 binding over in-memory SQLite with FTS5, copied from search.test.ts
 *  and trimmed to what a search reads. */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'draft',
    seo_title TEXT, seo_description TEXT, og_image TEXT,
    noindex INTEGER NOT NULL DEFAULT 0, sort_order REAL DEFAULT 0,
    created_at INTEGER, updated_at INTEGER)`);
  sqlite.exec(collectionSearchTableSQL(pagesSearch));
  const statement = (sql: string, binds: SQLInputValue[] = []) => {
    const run = () => sqlite.prepare(sql).all(...binds);
    return {
      sql,
      binds,
      bind: (...next: SQLInputValue[]) => statement(sql, next),
      all: async () => ({ success: true, results: run(), meta: {} }),
      run: async () => ({ success: true, results: run(), meta: {} }),
      raw: async () => run().map((row) => Object.values(row)),
      first: async () => run()[0] ?? null,
    };
  };
  const d1 = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) =>
      list.map((s) => ({
        success: true,
        results: sqlite.prepare(s.sql).all(...s.binds),
        meta: {},
      })),
  } as unknown as D1Database;
  /** A row in the table; `index: false` leaves it out of the FTS index, so
   *  only a semantic match can find it. */
  const seed = (id: number, title: string, { index = true } = {}) => {
    sqlite
      .prepare(`INSERT INTO pages (id, slug, title, body) VALUES (?, ?, ?, ?)`)
      .run(id, `page-${id}`, title, "");
    if (index)
      sqlite.prepare(`INSERT INTO pages_fts (rowid, title, body) VALUES (?, ?, '')`).run(id, title);
  };
  return { d1, seed };
}

/** A Vectorize index that answers every query with `matches`. */
function stubIndex(matches: { id: string; score: number }[] | Error) {
  const queries: { vector: number[]; options?: VectorQueryOptions }[] = [];
  const index: VectorIndex = {
    upsert: async () => undefined,
    deleteByIds: async () => undefined,
    query: async (vector, options) => {
      queries.push({ vector, options });
      if (matches instanceof Error) throw matches;
      return { matches };
    },
  };
  return { index, queries };
}

/** An AI runner whose embedding is a fixed vector. */
function stubRunner(out: unknown = { data: [[0.1, 0.2, 0.3]] }) {
  const calls: { model: string; inputs: Record<string, unknown>; options?: unknown }[] = [];
  const runner: AiRunner = {
    run: async (model, inputs, options) => {
      calls.push({ model, inputs, options });
      return out;
    },
  };
  return { runner, calls };
}

const editor = { userId: "u1", email: "alex@example.com", name: "Alex", role: "admin" as const };
const ctx = {} as ExecutionContext;
const req = (method: string, path: string) =>
  new Request(`https://example.com${path}`, { method, headers: { origin: "https://example.com" } });

type Env = { DB: D1Database };
const hybrid = (vector: SearchVectorConfig<Env>, path?: string) =>
  searchRoute<Env>({
    table: pages,
    config: pagesSearch,
    resolveEditor: () => editor,
    vector,
    path,
  });

async function search(route: ReturnType<typeof hybrid>, env: Env, query: string) {
  const res = await route(req("GET", `/api/louise/pages/search?${query}`), env, ctx);
  expect(res?.status).toBe(200);
  return ((await res?.json()) as { results: { id: number; title: string }[] }).results;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchRoute with a semantic layer", () => {
  it("fuses keyword and semantic hits, hydrating a semantic-only row", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee beans");
    h.seed(2, "Tea leaves");
    h.seed(3, "Espresso guide", { index: false });
    const { index, queries } = stubIndex([
      { id: "pages:3", score: 0.9 },
      { id: "pages:1", score: 0.8 },
    ]);
    const { runner, calls } = stubRunner();
    const route = hybrid({
      index: () => index,
      ai: () => runner,
      model: "@cf/example/embed",
      topK: 7,
      gateway: () => ({ id: "example-gateway" }),
    });
    const results = await search(route, { DB: h.d1 }, "q=coffee");
    // Id 1 ranks in both lists, so it leads; id 3 exists only semantically.
    expect(results.map((r) => r.id)).toEqual([1, 3]);
    expect(results[1].title).toBe("Espresso guide");
    expect(calls[0]).toEqual({
      model: "@cf/example/embed",
      inputs: { text: "coffee" },
      options: { gateway: { id: "example-gateway" } },
    });
    expect(queries[0]).toEqual({
      vector: [0.1, 0.2, 0.3],
      options: { topK: 7, namespace: "pages" },
    });
  });

  it("drops a semantic id whose row is gone", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee beans");
    const { index } = stubIndex([
      { id: "pages:99", score: 0.95 },
      { id: "pages:1", score: 0.5 },
    ]);
    const route = hybrid({ index: () => index, ai: () => stubRunner().runner });
    const results = await search(route, { DB: h.d1 }, "q=coffee");
    expect(results.map((r) => r.id)).toEqual([1]);
  });

  it("returns semantic-only matches when the keyword side finds nothing", async () => {
    const h = sqliteD1();
    h.seed(4, "Morning brew", { index: false });
    h.seed(5, "Evening tea", { index: false });
    const { index } = stubIndex([
      { id: "pages:5", score: 0.7 },
      { id: "pages:4", score: 0.6 },
    ]);
    const route = hybrid({ index: () => index, ai: () => stubRunner().runner });
    const results = await search(route, { DB: h.d1 }, "q=caffeine");
    expect(results.map((r) => r.id)).toEqual([5, 4]);
  });

  it("applies minScore before fusing, so weak matches add nothing", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee beans");
    h.seed(2, "Unrelated", { index: false });
    const { index } = stubIndex([{ id: "pages:2", score: 0.2 }]);
    const route = hybrid({ index: () => index, ai: () => stubRunner().runner, minScore: 0.5 });
    const results = await search(route, { DB: h.d1 }, "q=coffee");
    expect(results.map((r) => r.id)).toEqual([1]);
  });

  it("keeps keyword order when the index has no matches", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee");
    h.seed(2, "Coffee coffee coffee");
    const { index, queries } = stubIndex([]);
    const route = hybrid({ index: () => index, ai: () => stubRunner().runner });
    const results = await search(route, { DB: h.d1 }, "q=coffee");
    expect(results.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2]);
    // The default topK is the default search limit.
    expect(queries[0].options?.topK).toBe(SEARCH_LIMIT_DEFAULT);
  });

  it("falls back to keyword results when the index query throws", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee beans");
    const { index } = stubIndex(new Error("Vectorize unavailable"));
    const route = hybrid({ index: () => index, ai: () => stubRunner().runner });
    expect((await search(route, { DB: h.d1 }, "q=coffee")).map((r) => r.id)).toEqual([1]);
  });

  it("falls back to keyword results when the embedding is malformed", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee beans");
    const { index, queries } = stubIndex([{ id: "pages:1", score: 1 }]);
    const route = hybrid({ index: () => index, ai: () => stubRunner({ nope: true }).runner });
    expect((await search(route, { DB: h.d1 }, "q=coffee")).map((r) => r.id)).toEqual([1]);
    expect(queries).toHaveLength(0);
  });

  it("runs keyword-only when the runner is missing but the index is present", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee beans");
    const { index, queries } = stubIndex([{ id: "pages:1", score: 1 }]);
    const route = hybrid({ index: () => index, ai: () => undefined });
    expect((await search(route, { DB: h.d1 }, "q=coffee")).map((r) => r.id)).toEqual([1]);
    expect(queries).toHaveLength(0);
  });

  it("caps the fused list at the requested limit", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee one");
    h.seed(2, "Coffee two");
    h.seed(3, "Other", { index: false });
    const { index } = stubIndex([
      { id: "pages:3", score: 0.9 },
      { id: "pages:2", score: 0.8 },
    ]);
    const route = hybrid({ index: () => index, ai: () => stubRunner().runner });
    const results = await search(route, { DB: h.d1 }, "q=coffee&limit=2");
    expect(results).toHaveLength(2);
  });

  it("mounts at a custom path and falls through elsewhere", async () => {
    const h = sqliteD1();
    h.seed(1, "Coffee beans");
    const route = hybrid({ index: () => undefined, ai: () => undefined }, "/api/louise/posts");
    const res = await route(req("GET", "/api/louise/posts/search?q=coffee"), { DB: h.d1 }, ctx);
    const body = (await res?.json()) as { results: { id: number }[] };
    expect(body.results.map((r) => r.id)).toEqual([1]);
    expect(await route(req("GET", "/api/louise/pages/search?q=coffee"), { DB: h.d1 }, ctx)).toBe(
      undefined,
    );
  });

  it("answers 405 to a POST on the search path", async () => {
    const h = sqliteD1();
    const route = hybrid({ index: () => undefined, ai: () => undefined });
    const res = await route(req("POST", "/api/louise/pages/search?q=coffee"), { DB: h.d1 }, ctx);
    expect(res?.status).toBe(405);
  });
});

describe("toFtsQuery", () => {
  it("quotes and prefix-matches each term, escaping embedded quotes", () => {
    expect(toFtsQuery('  alex "kai"  NEAR ')).toBe('"alex"* """kai"""* "NEAR"*');
  });

  it("returns an empty string for blank input", () => {
    expect(toFtsQuery("   ")).toBe("");
  });
});

describe("parseSearchLimit", () => {
  it("falls back to the default for a missing, zero, or non-numeric value", () => {
    expect(parseSearchLimit(null)).toBe(SEARCH_LIMIT_DEFAULT);
    expect(parseSearchLimit("0")).toBe(SEARCH_LIMIT_DEFAULT);
    expect(parseSearchLimit("abc")).toBe(SEARCH_LIMIT_DEFAULT);
    expect(parseSearchLimit("7.9")).toBe(7);
  });
});
