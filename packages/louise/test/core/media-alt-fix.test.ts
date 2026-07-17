// #106 Phase 2b — the one-click AI alt backfill action on the media route
// (POST /api/louise/media/generate-alt). Uses fake D1 / R2 / AI runner so the
// wiring is exercised without a real Workers AI binding (that's deploy-only).

import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import type { AiRunner } from "../../src/core/ai/index.js";
import { media } from "../../src/core/db/index.js";
import { mediaRoute } from "../../src/core/editor/index.js";

const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };
const ctx = {} as ExecutionContext;
const GEN_ALT = "https://site.example/api/louise/media/generate-alt";

/** Fake D1: `.all()` returns `rows(sql, binds)`; `.run()` reports one change.
 *  Both record the compiled SQL + binds for assertions. */
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

/** Fake R2: `.get(key)` yields an object with `.arrayBuffer()` for known keys. */
function makeBucket(objects: Record<string, number[]>) {
  const gets: string[] = [];
  const bucket = {
    async get(key: string) {
      gets.push(key);
      const bytes = objects[key];
      return bytes ? { arrayBuffer: async () => new Uint8Array(bytes).buffer } : null;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, gets };
}

const fakeRunner = (out: unknown): AiRunner => ({ run: async () => out });
const env = (db: D1Database, bucket: R2Bucket) => ({
  DB: db,
  MEDIA: bucket,
  MEDIA_URL: "https://m",
});
const post = (body?: unknown) =>
  new Request(GEN_ALT, {
    method: "POST",
    headers: { origin: "https://site.example", "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });

const cfg = (over: Record<string, unknown> = {}) => ({
  table: media,
  resolveEditor: () => editor,
  altText: () => fakeRunner({ description: "A wooden door" }),
  ...over,
});
const updates = (calls: { sql: string; binds: unknown[] }[]) =>
  calls.filter((c) => c.sql.includes("UPDATE") && c.sql.includes('"alt"'));

describe("mediaRoute — POST /generate-alt (AI alt backfill)", () => {
  it("405s a non-POST", async () => {
    const { db } = makeD1(() => []);
    const { bucket } = makeBucket({});
    const res = await mediaRoute(cfg())(
      new Request(GEN_ALT, { headers: { origin: "https://site.example" } }),
      env(db, bucket),
      ctx,
    );
    expect(res?.status).toBe(405);
  });

  it("401s an unauthenticated request", async () => {
    const { db, calls } = makeD1(() => []);
    const { bucket } = makeBucket({});
    const res = await mediaRoute(cfg({ resolveEditor: () => null }))(post(), env(db, bucket), ctx);
    expect(res?.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("503s when no AI runner is wired", async () => {
    const { db } = makeD1(() => []);
    const { bucket } = makeBucket({});
    const res = await mediaRoute(cfg({ altText: () => undefined }))(post(), env(db, bucket), ctx);
    expect(res?.status).toBe(503);
  });

  it("backfills every image missing alt and returns what it fixed", async () => {
    const { db, calls } = makeD1(() => [
      { key: "web/a.png", content_type: "image/png" },
      { key: "web/b.jpg", content_type: "image/jpeg" },
    ]);
    const { bucket, gets } = makeBucket({ "web/a.png": [1], "web/b.jpg": [2] });
    const res = await mediaRoute(cfg())(post(), env(db, bucket), ctx);
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { fixed: number; results: { key: string; alt: string }[] };
    expect(body.fixed).toBe(2);
    expect(body.results.map((r) => r.key)).toEqual(["web/a.png", "web/b.jpg"]);
    expect(body.results[0]?.alt).toBe("A wooden door");
    expect(gets).toEqual(["web/a.png", "web/b.jpg"]);
    // The SELECT filters on missing alt + caps the batch; each fix UPDATEs its row.
    expect(calls[0]?.sql).toMatch(/alt.*IS NULL/s);
    expect(calls[0]?.binds).toEqual([12]); // DEFAULT_ALT_FIX_BATCH
    expect(updates(calls)).toHaveLength(2);
    expect(updates(calls)[0]?.binds).toEqual(["A wooden door", "web/a.png"]);
  });

  it("fixes a single asset when `key` is supplied", async () => {
    const { db, calls } = makeD1(() => [{ key: "web/a.png", content_type: "image/png" }]);
    const { bucket } = makeBucket({ "web/a.png": [1] });
    const res = await mediaRoute(cfg())(post({ key: "web/a.png" }), env(db, bucket), ctx);
    expect((await res!.json()) as { fixed: number }).toMatchObject({ fixed: 1 });
    expect(calls[0]?.binds).toEqual(["web/a.png"]); // bound the key, not the batch limit
  });

  it("skips non-images, missing objects, and empty model output", async () => {
    const { db, calls } = makeD1(() => [
      { key: "web/doc.pdf", content_type: "application/pdf" }, // not an image
      { key: "web/gone.png", content_type: "image/png" }, // no R2 object
      { key: "web/blank.png", content_type: "image/png" }, // model yields nothing
    ]);
    const { bucket, gets } = makeBucket({ "web/blank.png": [3] });
    const res = await mediaRoute(cfg({ altText: () => fakeRunner({}) }))(
      post(),
      env(db, bucket),
      ctx,
    );
    const body = (await res!.json()) as { fixed: number };
    expect(body.fixed).toBe(0);
    expect(gets).not.toContain("web/doc.pdf"); // never fetched
    expect(updates(calls)).toHaveLength(0); // nothing written
  });

  it("still passes through a non-matching path", async () => {
    const { db } = makeD1(() => []);
    const { bucket } = makeBucket({});
    const res = await mediaRoute(cfg())(
      new Request("https://site.example/other"),
      env(db, bucket),
      ctx,
    );
    expect(res).toBeUndefined();
  });
});
