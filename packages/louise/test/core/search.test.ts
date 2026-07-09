import { describe, expect, it } from "vitest";
import {
  collectionSearchTableSQL,
  defineCollection,
  extractSearchText,
} from "../../src/core/cms/index.js";
import { pages } from "../../src/core/db/index.js";
import { searchRoute } from "../../src/core/editor/index.js";
import { parseSearchLimit, SEARCH_LIMIT_MAX } from "../../src/core/editor/search.js";

const config = defineCollection({
  slug: "pages",
  fields: {
    title: { type: "text" },
    body: { type: "richText" },
    sections: { type: "json" },
  },
  // `json` is now allowed in search.fields — defineCollection would throw otherwise.
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
      title: "Louise CMS",
      body: { type: "doc", content: [{ type: "text", text: "edit on the page" }] },
      sections: [
        { _type: "hero", heading: "Big Heading", tagline: "a tagline" },
        { _type: "featureGrid", items: [{ title: "Fast", body: "at the edge" }] },
      ],
    });
    expect(title).toBe("Louise CMS");
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
