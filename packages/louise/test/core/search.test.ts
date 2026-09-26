import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  collectionSearchTableSQL,
  createLocalApi,
  defineCollection,
  extractSearchText,
  reindexDoc,
} from "../../src/core/content/index.js";
import { db as drizzleD1, pages } from "../../src/core/db/index.js";
import { type PagesWrite, pagesRoute, searchRoute } from "../../src/core/editor/index.js";
import { fuseRankings } from "../../src/core/ai/index.js";
import { parseSearchLimit, SEARCH_LIMIT_MAX } from "../../src/core/editor/search.js";

const config = defineCollection({
  slug: "pages",
  fields: {
    title: { type: "text" },
    body: { type: "richText" },
    sections: { type: "json" },
  },
  // `json` is now allowed in search.fields—defineCollection would throw otherwise.
  search: { fields: ["title", "body", "sections"] },
});

describe("search config + indexing", () => {
  it("allows a json field in search.fields (flattened for FTS)", () => {
    // constructing `config` above already exercises the validator; assert the
    // generated FTS DDL carries all three columns.
    const sql = collectionSearchTableSQL(config);
    expect(sql).toContain("fts5");
    expect(sql).toContain('"title"');
    expect(sql).toContain('"body"');
    expect(sql).toContain('"sections"');
  });

  it("flattens a json field's string leaves into search text", () => {
    const [title, body, sections] = extractSearchText(config, {
      title: "Louise Toolkit",
      body: { type: "doc", content: [{ type: "text", text: "edit on the page" }] },
      sections: [
        { _type: "hero", heading: "Big Heading", tagline: "a tagline" },
        { _type: "featureGrid", items: [{ title: "Fast", body: "at the edge" }] },
      ],
    });
    expect(title).toBe("Louise Toolkit");
    expect(body).toContain("edit on the page"); // richText flattened
    expect(sections).toContain("Big Heading");
    expect(sections).toContain("a tagline");
    expect(sections).toContain("Fast");
    expect(sections).toContain("at the edge");
  });

  it("indexes a missing/non-string field as empty", () => {
    const noSections = defineCollection({
      slug: "pages",
      fields: { title: { type: "text" } },
      search: { fields: ["title"] },
    });
    expect(extractSearchText(noSections, {})).toEqual([""]);
  });
});

// --- A D1 over real SQLite, for the index tests (#573) --------------------

const pagesSearch = defineCollection({
  slug: "pages",
  fields: { title: { type: "text" }, body: { type: "text" } },
  search: { fields: ["title", "body"] },
});

/**
 * A D1 binding over in-memory SQLite, FTS5 included, for the tests that need
 * real transactions. `batch` runs its statements between BEGIN and COMMIT and
 * rolls back on a throw, the way D1 commits a batch as one transaction.
 * Before every top-level call (a lone statement or a whole batch), it records
 * which rows the index holds: those are the only moments another reader can
 * look. `failWhen` makes a matching statement throw.
 */
function sqliteD1(options: { failWhen?: (sql: string) => boolean } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'draft',
    seo_title TEXT, seo_description TEXT, og_image TEXT,
    noindex INTEGER NOT NULL DEFAULT 0, sort_order REAL DEFAULT 0,
    created_at INTEGER, updated_at INTEGER)`);
  sqlite.exec(collectionSearchTableSQL(pagesSearch));

  const indexed = () =>
    (sqlite.prepare(`SELECT rowid FROM pages_fts ORDER BY rowid`).all() as { rowid: number }[]).map(
      (row) => row.rowid,
    );
  const snapshots: number[][] = [];
  const batches: string[][] = [];
  const lone: string[] = [];

  const execute = (sql: string, binds: SQLInputValue[]) => {
    if (options.failWhen?.(sql)) throw new Error("Injected failure");
    return sqlite.prepare(sql).all(...binds);
  };
  const statement = (sql: string, binds: SQLInputValue[] = []) => {
    const top = () => {
      snapshots.push(indexed());
      lone.push(sql);
      return execute(sql, binds);
    };
    return {
      sql,
      binds,
      bind: (...next: SQLInputValue[]) => statement(sql, next),
      all: async () => ({ success: true, results: top(), meta: {} }),
      run: async () => ({ success: true, results: top(), meta: {} }),
      raw: async () => top().map((row) => Object.values(row)),
      first: async () => top()[0] ?? null,
    };
  };
  const d1 = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) => {
      snapshots.push(indexed());
      batches.push(list.map((s) => s.sql));
      sqlite.exec("BEGIN");
      try {
        const results = list.map((s) => ({
          success: true,
          results: execute(s.sql, s.binds),
          meta: {},
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;

  const addEntry = (id: number, title: string) =>
    sqlite
      .prepare(`INSERT INTO pages_fts (rowid, title, body) VALUES (?, ?, ?)`)
      .run(id, title, "");
  const seed = (id: number, title: string, { index = true } = {}) => {
    sqlite
      .prepare(`INSERT INTO pages (id, slug, title, body) VALUES (?, ?, ?, ?)`)
      .run(id, `page-${id}`, title, `Body of ${title}`);
    if (index) addEntry(id, title);
  };
  const entryTitle = (id: number) =>
    (
      sqlite.prepare(`SELECT title FROM pages_fts WHERE rowid = ?`).get(id) as
        | { title: string }
        | undefined
    )?.title;
  const reset = () => {
    snapshots.length = 0;
    batches.length = 0;
    lone.length = 0;
  };
  return { d1, sqlite, seed, addEntry, entryTitle, indexed, snapshots, batches, lone, reset };
}

/** Whether a statement writes to the index, as opposed to searching it. */
const writesIndex = (sql: string) => /^(delete from|insert into) "pages_fts"/i.test(sql);

// --- reindexDoc (deferred FTS sync—#77) ----------------------------------

describe("reindexDoc", () => {
  it("replaces the FTS entry when the row still exists", async () => {
    const h = sqliteD1();
    h.seed(1, "Hello");
    h.sqlite.prepare(`UPDATE pages SET title = 'Hello again' WHERE id = 1`).run();
    await reindexDoc(drizzleD1(h.d1), pages, pagesSearch, 1);
    expect(h.indexed()).toEqual([1]);
    expect(h.entryTitle(1)).toBe("Hello again");
  });

  it("removes the FTS entry when the row is gone (deleted)", async () => {
    const h = sqliteD1();
    h.addEntry(1, "Deleted page"); // entry without a row → treat as removal
    await reindexDoc(drizzleD1(h.d1), pages, pagesSearch, 1);
    expect(h.indexed()).toEqual([]);
  });

  it("is a no-op for a collection with no search config (never touches the DB)", async () => {
    const noSearch = defineCollection({ slug: "pages", fields: { title: { type: "text" } } });
    const h = sqliteD1();
    await reindexDoc(drizzleD1(h.d1), pages, noSearch, 1);
    expect(h.lone).toEqual([]); // early return before any read
    expect(h.batches).toEqual([]);
  });
});

// The route short-circuits (fall-through / auth / method) before any DB access;
// the happy path (real FTS query) runs against a local D1 in the astro-preview E2E.
const noopD1 = {
  prepare: () => ({
    bind: () => ({ all: async () => ({ results: [] }), run: async () => ({ success: true }) }),
  }),
} as unknown as D1Database;
const editor = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" as const };
const ctx = {} as ExecutionContext;
const route = (resolve: () => typeof editor | null) =>
  searchRoute({ table: pages, config, resolveEditor: resolve });
const req = (method: string, path: string) =>
  new Request(`https://site.example${path}`, {
    method,
    headers: { origin: "https://site.example" },
  });

describe("searchRoute — routing", () => {
  it("falls through on a path it doesn't own", async () => {
    const r = route(() => editor);
    expect(await r(req("GET", "/api/louise/pages"), { DB: noopD1 }, ctx)).toBeUndefined();
    expect(await r(req("GET", "/api/louise/pages/5"), { DB: noopD1 }, ctx)).toBeUndefined();
  });

  it("returns empty results for a blank query", async () => {
    const res = await route(() => editor)(
      req("GET", "/api/louise/pages/search"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ results: [] });
  });

  it("denies an unauthenticated search", async () => {
    const res = await route(() => null)(
      req("GET", "/api/louise/pages/search?q=x"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBeGreaterThanOrEqual(401);
    expect(res?.status).toBeLessThan(404);
  });

  it("405s a wrong method on reindex", async () => {
    const res = await route(() => editor)(
      req("GET", "/api/louise/pages/reindex"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBe(405);
  });

  it("degrades to FTS-only when the vector bindings are absent (no throw)", async () => {
    // A route configured with a semantic layer whose accessors return undefined
    // (index/AI not provisioned) must behave exactly like FTS-only search.
    const hybrid = searchRoute({
      table: pages,
      config,
      resolveEditor: () => editor,
      vector: { index: () => undefined, ai: () => undefined },
    });
    const res = await hybrid(req("GET", "/api/louise/pages/search?q=hello"), { DB: noopD1 }, ctx);
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ results: [] }); // noopD1 → no FTS rows
  });
});

// --- fuseRankings (RRF hybrid merge—#86) ---------------------------------

describe("fuseRankings", () => {
  it("preserves keyword order when there's no semantic signal", () => {
    expect(fuseRankings([{ ids: [3, 1, 2] }, { ids: [] }])).toEqual([3, 1, 2]);
  });

  it("returns semantic order when there's no keyword signal", () => {
    expect(fuseRankings([{ ids: [] }, { ids: [9, 4] }])).toEqual([9, 4]);
  });

  it("boosts an id ranked in BOTH lists above one ranked in only one", () => {
    // 2 appears top of both lists → highest fused score; 1 and 3 each appear once.
    const fused = fuseRankings([{ ids: [1, 2] }, { ids: [2, 3] }]);
    expect(fused[0]).toBe(2);
    expect(fused).toContain(1);
    expect(fused).toContain(3);
  });

  it("surfaces a strong semantic-only hit ahead of a weak keyword-only one", () => {
    // id 5 is rank 1 semantically; id 1 is rank 3 (last) on keyword only.
    const fused = fuseRankings([{ ids: [7, 8, 1] }, { ids: [5, 6] }]);
    expect(fused.indexOf(5)).toBeLessThan(fused.indexOf(1));
  });

  it("orders equal-score ids deterministically (by id) — no dupes", () => {
    // Disjoint lists, same rank position → equal RRF score; tiebreak ascending id.
    const fused = fuseRankings([{ ids: [10] }, { ids: [4] }]);
    expect(fused).toEqual([4, 10]);
    // every id appears exactly once
    expect(new Set(fused).size).toBe(fused.length);
  });
});

describe("parseSearchLimit", () => {
  it("caps an oversized limit at the ceiling", () => {
    expect(parseSearchLimit("99999")).toBe(SEARCH_LIMIT_MAX);
    expect(parseSearchLimit(String(SEARCH_LIMIT_MAX + 1))).toBe(SEARCH_LIMIT_MAX);
  });

  it("passes through a valid in-range limit (floored to an integer)", () => {
    expect(parseSearchLimit("10")).toBe(10);
    expect(parseSearchLimit("10.9")).toBe(10);
    expect(parseSearchLimit(String(SEARCH_LIMIT_MAX))).toBe(SEARCH_LIMIT_MAX);
  });

  it("falls back to the default for missing / non-numeric / non-positive input", () => {
    expect(parseSearchLimit(null)).toBe(20);
    expect(parseSearchLimit("")).toBe(20);
    expect(parseSearchLimit("abc")).toBe(20);
    expect(parseSearchLimit("0")).toBe(20);
    expect(parseSearchLimit("-5")).toBe(20);
  });
});

// --- Index updates that readers never see half-done (#573) ----------------

describe("search index sync", () => {
  it("sends a row's DELETE and INSERT as one batch", async () => {
    const h = sqliteD1();
    h.seed(1, "Old title");
    h.sqlite.prepare(`UPDATE pages SET title = 'New title' WHERE id = 1`).run();
    h.reset();

    await reindexDoc(drizzleD1(h.d1), pages, pagesSearch, 1);

    expect(h.batches).toHaveLength(1);
    expect(h.batches[0]).toHaveLength(2);
    expect(h.batches[0]?.[0]).toMatch(/^delete from "pages_fts"/i);
    expect(h.batches[0]?.[1]).toMatch(/^insert into "pages_fts"/i);
    expect(h.lone.filter(writesIndex)).toEqual([]);
    expect(h.entryTitle(1)).toBe("New title");
  });

  it("keeps the old entry when the INSERT fails, because the batch rolls back", async () => {
    const h = sqliteD1({ failWhen: (sql) => /^insert into "pages_fts"/i.test(sql) });
    h.seed(1, "Old title");
    h.sqlite.prepare(`UPDATE pages SET title = 'New title' WHERE id = 1`).run();

    await expect(reindexDoc(drizzleD1(h.d1), pages, pagesSearch, 1)).rejects.toThrow();

    // As two separate statements, the DELETE would have committed alone and
    // dropped the page from search.
    expect(h.entryTitle(1)).toBe("Old title");
  });
});

describe("reindexSearch", () => {
  it("never empties the index mid-run, keeps live rows, and removes stale ones", async () => {
    const h = sqliteD1();
    h.seed(1, "Alpha");
    h.seed(2, "Bravo");
    h.seed(3, "Charlie");
    h.addEntry(7, "Deleted page"); // an entry whose row is gone
    h.sqlite.prepare(`UPDATE pages SET title = 'Bravo renamed' WHERE id = 2`).run();
    h.reset();
    const api = createLocalApi(drizzleD1(h.d1), pages, pagesSearch);

    expect(await api.reindexSearch({})).toBe(3);

    // At every moment a reader could look, every live row is searchable.
    expect(h.snapshots.length).toBeGreaterThan(0);
    for (const snapshot of h.snapshots) expect(snapshot).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(h.lone.filter(writesIndex)).toEqual([
      expect.stringMatching(/^DELETE FROM "pages_fts" WHERE rowid NOT IN \(SELECT/),
    ]);
    expect(h.indexed()).toEqual([1, 2, 3]);
    expect(h.entryTitle(2)).toBe("Bravo renamed");
    const found = await api.search({}, "renamed");
    expect(found.map((row) => row.id)).toEqual([2]);
  });

  it("commits a large rebuild in batches of at most 100 statements", async () => {
    const h = sqliteD1();
    for (let id = 1; id <= 120; id++) h.seed(id, `Page ${id}`, { index: false });
    h.reset();

    const api = createLocalApi(drizzleD1(h.d1), pages, pagesSearch);
    expect(await api.reindexSearch({})).toBe(120);

    expect(h.batches.map((batch) => batch.length)).toEqual([100, 100, 40]);
    expect(h.indexed()).toHaveLength(120);
  });

  it("removes every stale entry when the table has no rows", async () => {
    const h = sqliteD1();
    h.addEntry(5, "Orphan");
    const api = createLocalApi(drizzleD1(h.d1), pages, pagesSearch);

    expect(await api.reindexSearch({})).toBe(0);
    expect(h.indexed()).toEqual([]);
  });
});

describe("pagesRoute afterWrite", () => {
  const origin = "https://site.example";
  const base = `${origin}/api/louise/pages`;
  const send = (method: string, url: string, body?: unknown) =>
    new Request(url, {
      method,
      headers: { origin, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("receives the written row's ID, so reindexDoc can sync only that row", async () => {
    const h = sqliteD1();
    const writes: PagesWrite[] = [];
    const route = pagesRoute({
      table: pages,
      resolveEditor: () => editor,
      afterWrite: async (_editor, write) => {
        writes.push(write);
        await reindexDoc(drizzleD1(h.d1), pages, pagesSearch, write.id);
      },
    });
    const env = { DB: h.d1 };
    const api = createLocalApi(drizzleD1(h.d1), pages, pagesSearch);

    const created = await route(send("POST", base, { slug: "about", title: "About us" }), env, ctx);
    expect(created?.status).toBe(201);
    const { page } = (await created?.json()) as { page: { id: number } };
    expect(writes).toEqual([{ operation: "create", id: page.id }]);
    expect(h.entryTitle(page.id)).toBe("About us");

    const updated = await route(
      send("PATCH", `${base}/${page.id}`, { title: "About the team" }),
      env,
      ctx,
    );
    expect(updated?.status).toBe(200);
    expect(writes[1]).toEqual({ operation: "update", id: page.id });
    expect((await api.search({}, "team")).map((row) => row.id)).toEqual([page.id]);

    const deleted = await route(send("DELETE", `${base}/${page.id}`), env, ctx);
    expect(deleted?.status).toBe(200);
    expect(writes[2]).toEqual({ operation: "delete", id: page.id });
    expect(h.indexed()).toEqual([]);

    // One row's sync each time, never a whole-table rebuild.
    expect(h.batches.every((batch) => batch.length === 2)).toBe(true);
    expect(h.lone.filter(writesIndex).some((sql) => sql.includes("NOT IN"))).toBe(false);
  });

  it("still calls a hook that takes only the editor", async () => {
    const h = sqliteD1();
    const seen: unknown[] = [];
    const route = pagesRoute({
      table: pages,
      resolveEditor: () => editor,
      afterWrite: (who) => {
        seen.push(who);
      },
    });
    const res = await route(send("POST", base, { slug: "home", title: "Home" }), { DB: h.d1 }, ctx);
    expect(res?.status).toBe(201);
    expect(seen).toEqual([editor]);
  });
});
