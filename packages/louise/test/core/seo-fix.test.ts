// #106 Phase 2c—the one-click AI SEO backfill route
// (POST /api/louise/pages/generate-seo). Fake D1 + AI runner exercise the wiring
// without a real Workers AI binding (that's deploy-only).

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { collectionVersionsTable, defineCollection } from "../../src/core/content/index.js";
import { describe, expect, it } from "vitest";
import type { AiRunner, SeoSuggestion } from "../../src/core/ai/index.js";
import type { EditorSession } from "../../src/core/auth/index.js";
import { pages } from "../../src/core/db/index.js";
import { seoFixRoute } from "../../src/core/editor/index.js";

const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };
const ctx = {} as ExecutionContext;
const GEN_SEO = "https://site.example/api/louise/pages/generate-seo";

function makeD1(rows: (sql: string, binds: unknown[]) => unknown[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async all() {
              calls.push({ sql, binds });
              return { results: rows(sql, binds) };
            },
            async run() {
              calls.push({ sql, binds });
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

const seoRunner = (seo: SeoSuggestion): AiRunner => ({
  // suggestSeo reads a text-generation `{ response }`; return JSON it can parse.
  run: async () => ({
    response: JSON.stringify({ title: seo.title, description: seo.description }),
  }),
});
const env = (db: D1Database) => ({ DB: db });
const post = (body?: unknown) =>
  new Request(GEN_SEO, {
    method: "POST",
    headers: { origin: "https://site.example", "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
const cfg = (over: Record<string, unknown> = {}) => ({
  table: pages,
  resolveEditor: () => editor,
  ai: () => seoRunner({ title: "Great Page", description: "A concise summary of the page." }),
  ...over,
});
const updates = (calls: { sql: string; binds: unknown[] }[]) =>
  calls.filter((c) => c.sql.includes("UPDATE"));

describe("seoFixRoute — POST /generate-seo", () => {
  it("passes through a non-matching path", async () => {
    const { db } = makeD1(() => []);
    const res = await seoFixRoute(cfg())(new Request("https://site.example/other"), env(db), ctx);
    expect(res).toBeUndefined();
  });

  it("405s a non-POST", async () => {
    const { db } = makeD1(() => []);
    const res = await seoFixRoute(cfg())(
      new Request(GEN_SEO, { headers: { origin: "https://site.example" } }),
      env(db),
      ctx,
    );
    expect(res?.status).toBe(405);
  });

  it("401s an unauthenticated request", async () => {
    const { db, calls } = makeD1(() => []);
    const res = await seoFixRoute(cfg({ resolveEditor: () => null }))(post(), env(db), ctx);
    expect(res?.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("503s when no AI runner is wired", async () => {
    const { db } = makeD1(() => []);
    const res = await seoFixRoute(cfg({ ai: () => undefined }))(post(), env(db), ctx);
    expect(res?.status).toBe(503);
  });

  it("suggests SEO for published pages with gaps, and writes nothing (#549)", async () => {
    const { db, calls } = makeD1(() => [
      { id: 1, seo_title: null, seo_description: null, title: "Home", body: "<p>Welcome</p>" },
    ]);
    const res = await seoFixRoute(cfg())(post(), env(db), ctx);
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as {
      suggestions: { id: number; title: string; seoTitle: string; seoDescription: string }[];
    };
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toMatchObject({ id: 1, title: "Home" });
    // The SELECT filters published + SEO-gap rows, capped at the batch (8).
    expect(calls[0]?.sql).toContain("status");
    expect(calls[0]?.binds).toEqual([8]); // DEFAULT_SEO_FIX_BATCH
    // Both fields were blank, so both are suggested, and nothing is written.
    expect(body.suggestions[0]?.seoTitle).toBeTruthy();
    expect(body.suggestions[0]?.seoDescription).toBeTruthy();
    expect(updates(calls)).toHaveLength(0);
  });

  it("suggests only the missing field, never replacing an existing one", async () => {
    // seo_title already set → only seo_description is suggested.
    const { db } = makeD1(() => [
      { id: 2, seo_title: "Kept Title", seo_description: null, title: "T", body: "words" },
    ]);
    const res = await seoFixRoute(cfg())(post(), env(db), ctx);
    const body = (await res!.json()) as {
      suggestions: { seoTitle: string | null; seoDescription: string | null }[];
    };
    expect(body.suggestions[0]).toMatchObject({
      seoTitle: null,
      seoDescription: "A concise summary of the page.",
    });
  });

  it("targets a single page when `id` is supplied", async () => {
    const { db, calls } = makeD1(() => [
      { id: 5, seo_title: null, seo_description: null, title: "T", body: "b" },
    ]);
    await seoFixRoute(cfg())(post({ id: 5 }), env(db), ctx);
    expect(calls[0]?.binds).toEqual([5]); // bound the id, not the batch limit
  });

  it("skips a page with no content and one where the model returns nothing", async () => {
    const empty = makeD1(() => [
      { id: 3, seo_title: null, seo_description: null, title: "", body: "" },
    ]);
    expect(
      (await (await seoFixRoute(cfg())(post(), env(empty.db), ctx))!.json()) as {
        suggestions: unknown[];
      },
    ).toMatchObject({ suggestions: [] });
    expect(updates(empty.calls)).toHaveLength(0);

    const noModel = makeD1(() => [
      { id: 4, seo_title: null, seo_description: null, title: "T", body: "words" },
    ]);
    const res = await seoFixRoute(cfg({ ai: () => ({ run: async () => ({}) }) as AiRunner }))(
      post(),
      env(noModel.db),
      ctx,
    );
    expect((await res!.json()) as { suggestions: unknown[] }).toMatchObject({ suggestions: [] });
    expect(updates(noModel.calls)).toHaveLength(0);
  });
});

describe("seoFixRoute — applying what the owner accepted (#549)", () => {
  const apply = (body: unknown) =>
    new Request("https://site.example/api/louise/pages/generate-seo/apply", {
      method: "POST",
      headers: { origin: "https://site.example", "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("writes the accepted fields to the live row when there are no drafts", async () => {
    const { db, calls } = makeD1(() => []);
    const res = await seoFixRoute(cfg())(
      apply({ id: 7, seoTitle: "Fresh bread daily", seoDescription: "Baked each morning." }),
      env(db),
      ctx,
    );
    expect(await res!.json()).toEqual({ ok: true, draft: false });
    expect(updates(calls)[0]?.binds).toEqual(["Fresh bread daily", "Baked each morning.", 7]);
  });

  it("refuses a body with nothing to apply", async () => {
    const { db } = makeD1(() => []);
    expect((await seoFixRoute(cfg())(apply({ id: 7 }), env(db), ctx))?.status).toBe(400);
  });
});

describe("seoFixRoute — an accepted suggestion on a versioned collection", () => {
  it("saves it as a draft through applySaveDraft, not to the live row", async () => {
    const config = defineCollection({
      slug: "pages",
      fields: {
        title: { type: "text" },
        seoTitle: { type: "text" },
        seoDescription: { type: "text" },
      },
      versions: { drafts: true },
    });
    // The live row, positional as drizzle reads it.
    const live = getTableConfig(pages).columns.map((c) =>
      c.name === "id" ? 7 : c.name === "title" ? "Bakery" : c.name === "slug" ? "bakery" : null,
    );
    const writes: string[] = [];
    const db = {
      prepare: (sql: string) => {
        const stmt = {
          raw: async () => [live],
          all: async () => ({ results: [live] }),
          run: async () => {
            writes.push(sql);
            return { success: true, meta: { changes: 1 } };
          },
        };
        return { ...stmt, bind: () => stmt };
      },
    } as unknown as D1Database;
    const store = new Map<string, string>();
    const now = Date.now();
    store.set(
      "draft:v2:pages:7",
      JSON.stringify({ data: { title: "Bakery" }, updatedAt: now, flushedAt: now }),
    );
    const res = await seoFixRoute(
      cfg({
        drafts: {
          table: pages,
          versionsTable: collectionVersionsTable(config),
          config,
          bufferKv: () => ({
            get: async (key: string) => store.get(key) ?? null,
            put: async (key: string, value: string) => void store.set(key, value),
            delete: async (key: string) => void store.delete(key),
          }),
        },
      }),
    )(
      new Request("https://site.example/api/louise/pages/generate-seo/apply", {
        method: "POST",
        headers: { origin: "https://site.example", "content-type": "application/json" },
        body: JSON.stringify({ id: 7, seoTitle: "Fresh bread daily" }),
      }),
      env(db),
      ctx,
    );
    expect(await res!.json()).toEqual({ ok: true, draft: true });
    expect(writes.filter((sql) => sql.includes('update "pages"'))).toHaveLength(0);
    expect(JSON.parse(store.get("draft:v2:pages:7")!).data).toMatchObject({
      title: "Bakery",
      seoTitle: "Fresh bread daily",
    });
  });
});
