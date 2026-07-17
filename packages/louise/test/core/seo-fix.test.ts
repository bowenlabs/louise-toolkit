// #106 Phase 2c — the one-click AI SEO backfill route
// (POST /api/louise/pages/generate-seo). Fake D1 + AI runner exercise the wiring
// without a real Workers AI binding (that's deploy-only).

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

  it("backfills SEO for published pages with gaps and returns what it fixed", async () => {
    const { db, calls } = makeD1(() => [
      { id: 1, seo_title: null, seo_description: null, title: "Home", body: "<p>Welcome</p>" },
    ]);
    const res = await seoFixRoute(cfg())(post(), env(db), ctx);
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { fixed: number; results: { id: number }[] };
    expect(body.fixed).toBe(1);
    expect(body.results[0]?.id).toBe(1);
    // The SELECT filters published + SEO-gap rows, capped at the batch (8).
    expect(calls[0]?.sql).toContain("status");
    expect(calls[0]?.binds).toEqual([8]); // DEFAULT_SEO_FIX_BATCH
    // Both fields were blank → both written.
    expect(updates(calls)[0]?.sql).toContain('"seo_title"');
    expect(updates(calls)[0]?.sql).toContain('"seo_description"');
  });

  it("fills only the missing field, never overwriting an existing one", async () => {
    // seo_title already set → only seo_description should be written.
    const { db, calls } = makeD1(() => [
      { id: 2, seo_title: "Kept Title", seo_description: null, title: "T", body: "words" },
    ]);
    await seoFixRoute(cfg())(post(), env(db), ctx);
    const upd = updates(calls)[0];
    expect(upd?.sql).toContain('"seo_description"');
    expect(upd?.sql).not.toContain('"seo_title"');
    // Bound: [description, id] — the kept title is untouched.
    expect(upd?.binds).toEqual(["A concise summary of the page.", 2]);
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
      (await (await seoFixRoute(cfg())(post(), env(empty.db), ctx))!.json()) as { fixed: number },
    ).toMatchObject({ fixed: 0 });
    expect(updates(empty.calls)).toHaveLength(0);

    const noModel = makeD1(() => [
      { id: 4, seo_title: null, seo_description: null, title: "T", body: "words" },
    ]);
    const res = await seoFixRoute(cfg({ ai: () => ({ run: async () => ({}) }) as AiRunner }))(
      post(),
      env(noModel.db),
      ctx,
    );
    expect((await res!.json()) as { fixed: number }).toMatchObject({ fixed: 0 });
    expect(updates(noModel.calls)).toHaveLength(0);
  });
});
