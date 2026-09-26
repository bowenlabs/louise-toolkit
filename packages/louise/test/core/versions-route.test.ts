import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { collectionVersionsTable, defineCollection } from "../../src/core/content/index.js";
import { pages } from "../../src/core/db/index.js";
import {
  type DraftBufferKV,
  draftBufferKey,
  latestPendingDraft,
  readDraftBuffer,
  versionsRoute,
  writeDraftBuffer,
} from "../../src/core/editor/index.js";

// The route short-circuits (fall-through / auth / bad-id) before ever touching
// the DB, so these contract tests need only a no-op D1. The draft-merge /
// publish happy path runs against a real local D1 in the astro-preview E2E
// (there is no async in-memory SQLite harness in this repo).
//
// `applySaveDraft` converts a `LouiseValidationError` thrown by the collection's
// `beforeChange` hook (for example, an unknown section `_type`) into a 422, with or
// without an open KV buffer. That needs a D1 stand-in that answers the live-row
// SELECT (this no-op one returns 404 first), so it's in
// `buffered-save-draft.test.ts`, and served in CI's scaffold live-smoke leg
// ("versionsRoute answers 422 for a bad section").
const noopD1 = {
  prepare: () => ({
    bind: () => ({ all: async () => ({ results: [] }), run: async () => ({ success: true }) }),
  }),
} as unknown as D1Database;

const config = defineCollection({
  slug: "pages",
  fields: { slug: { type: "text" }, title: { type: "text" }, sections: { type: "json" } },
  versions: { drafts: true },
});
const pagesVersions = collectionVersionsTable(config);
const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };
const ctx = {} as ExecutionContext;

const route = (resolveEditor: () => EditorSession | null) =>
  versionsRoute({ table: pages, versionsTable: pagesVersions, config, resolveEditor });

const req = (method: string, path: string, origin = "https://site.example") =>
  new Request(`https://site.example${path}`, { method, headers: { origin } });

describe("versionsRoute — routing", () => {
  it("falls through (undefined) on a path it doesn't own", async () => {
    const r = route(() => editor);
    expect(await r(req("GET", "/other"), { DB: noopD1 }, ctx)).toBeUndefined();
    // base with no /:id/action
    expect(await r(req("GET", "/api/louise/pages"), { DB: noopD1 }, ctx)).toBeUndefined();
    // an id with no action (that's the pages CRUD route's territory)
    expect(await r(req("GET", "/api/louise/pages/5"), { DB: noopD1 }, ctx)).toBeUndefined();
    // an unknown action
    expect(await r(req("GET", "/api/louise/pages/5/foo"), { DB: noopD1 }, ctx)).toBeUndefined();
  });

  it("400s a non-integer id before any DB access", async () => {
    const res = await route(() => editor)(
      req("POST", "/api/louise/pages/abc/versions"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBe(400);
  });

  it("denies an unauthenticated request", async () => {
    const res = await route(() => null)(
      req("GET", "/api/louise/pages/5/versions"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBeGreaterThanOrEqual(401);
    expect(res?.status).toBeLessThan(404);
  });

  it("405s an unsupported method on a matched action", async () => {
    const res = await route(() => editor)(
      req("DELETE", "/api/louise/pages/5/publish"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBe(405);
  });

  it("owns the discard action (doesn't fall through)", async () => {
    // GET on discard is unsupported → 405, but it must not fall through (undefined).
    const res = await route(() => editor)(
      req("GET", "/api/louise/pages/5/discard"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBe(405);
  });

  it("discard 400s a missing versionId before any DB access", async () => {
    // No request body → versionId undefined → 400, short-circuiting the delete.
    const res = await route(() => editor)(
      req("POST", "/api/louise/pages/5/discard"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBe(400);
  });

  it("discard denies an unauthenticated request", async () => {
    const res = await route(() => null)(
      req("POST", "/api/louise/pages/5/discard"),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBeGreaterThanOrEqual(401);
    expect(res?.status).toBeLessThan(404);
  });
});

describe("latestPendingDraft — merge base / publish target", () => {
  // findVersions returns rows newest-first, so these fixtures are id-descending.
  const draft = (id: number, versionData: Record<string, unknown> = {}) => ({
    id,
    status: "draft",
    versionData,
  });
  const published = (id: number) => ({ id, status: "published", versionData: {} });

  it("returns undefined when there are no versions", () => {
    expect(latestPendingDraft([], null)).toBeUndefined();
  });

  it("returns the newest draft when nothing is published yet", () => {
    const versions = [draft(3), draft(2), published(1)];
    // published(1) here is a stray status, but no live pointer → drafts are pending.
    expect(latestPendingDraft(versions, null)?.id).toBe(3);
  });

  it("returns the newest draft above the published pointer", () => {
    // Live pointer is 2; draft 4 is pending, drafts 1 are superseded.
    const versions = [draft(4), published(2), draft(1)];
    expect(latestPendingDraft(versions, 2)?.id).toBe(4);
  });

  it("ignores drafts at or below the published pointer (superseded)", () => {
    // Only a stale draft (id 1) remains under a live pointer of 3 → nothing pending.
    const versions = [published(3), draft(1)];
    expect(latestPendingDraft(versions, 3)).toBeUndefined();
  });

  it("treats a draft equal to the published id as superseded", () => {
    expect(latestPendingDraft([draft(2)], 2)).toBeUndefined();
    expect(latestPendingDraft([draft(3)], 2)?.id).toBe(3);
  });

  it("carries the snapshot so a partial save can layer over it", () => {
    const base = latestPendingDraft([draft(5, { body: "wip", sections: [] })], 1);
    expect(base?.versionData).toEqual({ body: "wip", sections: [] });
  });
});

// Publishing an explicit `versionId` (#535). `api.publish` finds the page
// through the version row's `parentId`, so the route has to check that the
// version belongs to the page in the path, and check it before the draft buffer
// flush, or a rejected publish still writes the URL page's buffered work to D1.

function memoryKv(): DraftBufferKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/**
 * A D1 stand-in that records every statement. A lookup in `pages_versions`
 * answers with one version whose `parent_id` is `versionParentId` (none when
 * it's `null`), and any other read answers with page 1. An `insert` throws, so
 * a test can tell whether the route reached the draft flush.
 */
function publishD1(versionParentId: number | null) {
  const statements: string[] = [];
  const d1 = {
    prepare: (sql: string) => {
      statements.push(sql);
      if (/^insert/i.test(sql)) throw new Error("reached the draft flush");
      const rows = sql.includes('"pages_versions"')
        ? versionParentId === null
          ? []
          : [[versionParentId]]
        : [[1]];
      const stmt = {
        raw: async () => rows,
        all: async () => ({ results: rows }),
        run: async () => ({ success: true }),
      };
      return { ...stmt, bind: () => stmt };
    },
  } as unknown as D1Database;
  return { d1, statements };
}

const BUFFERED = { title: "Unpublished work on page 1" };

async function bufferedRoute() {
  const kv = memoryKv();
  const now = Date.now();
  await writeDraftBuffer(kv, draftBufferKey("pages", 1), {
    data: BUFFERED,
    updatedAt: now,
    flushedAt: now,
  });
  const r = versionsRoute({
    table: pages,
    versionsTable: pagesVersions,
    config,
    resolveEditor: () => editor,
    bufferKv: () => kv,
  });
  return { kv, route: r };
}

const publishReq = (body: unknown, pageId = 1) =>
  new Request(`https://site.example/api/louise/pages/${pageId}/publish`, {
    method: "POST",
    headers: { origin: "https://site.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("versionsRoute—publishing an explicit versionId", () => {
  it("answers 404 when the version belongs to another page, without flushing the buffer", async () => {
    const { kv, route: r } = await bufferedRoute();
    const { d1, statements } = publishD1(2);

    const res = await r(publishReq({ versionId: 9 }), { DB: d1 }, ctx);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "Version not found" });
    // The version lookup is the only statement: no draft insert, no publish.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"pages_versions"');
    expect((await readDraftBuffer(kv, draftBufferKey("pages", 1)))?.data).toEqual(BUFFERED);
  });

  it("answers 404 when the version doesn't exist, without flushing the buffer", async () => {
    const { kv, route: r } = await bufferedRoute();
    const { d1, statements } = publishD1(null);

    const res = await r(publishReq({ versionId: 9 }), { DB: d1 }, ctx);

    expect(res?.status).toBe(404);
    expect(statements.some((sql) => /^(insert|update)/i.test(sql))).toBe(false);
    expect((await readDraftBuffer(kv, draftBufferKey("pages", 1)))?.data).toEqual(BUFFERED);
  });

  it("goes on to flush the buffer when the version belongs to the page", async () => {
    const { route: r } = await bufferedRoute();
    const { d1, statements } = publishD1(1);

    await expect(r(publishReq({ versionId: 9 }), { DB: d1 }, ctx)).rejects.toThrow();

    expect(statements.some((sql) => /^insert into "pages_versions"/i.test(sql))).toBe(true);
  });

  it.each([0, -3])("answers 400 for versionId %d before any DB access", async (versionId) => {
    const { route: r } = await bufferedRoute();
    const { d1, statements } = publishD1(1);

    const res = await r(publishReq({ versionId }), { DB: d1 }, ctx);

    expect(res?.status).toBe(400);
    expect(statements).toEqual([]);
  });

  it.each(["0", "-1", "07", "1.5"])("answers 400 for page id %s", async (pageId) => {
    const res = await route(() => editor)(
      req("POST", `/api/louise/pages/${pageId}/publish`),
      { DB: noopD1 },
      ctx,
    );
    expect(res?.status).toBe(400);
  });
});
