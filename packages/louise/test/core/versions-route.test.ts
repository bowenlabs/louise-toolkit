import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { collectionVersionsTable, defineCollection } from "../../src/core/content/index.js";
import { pages } from "../../src/core/db/index.js";
import { latestPendingDraft, versionsRoute } from "../../src/core/editor/index.js";

// The route short-circuits (fall-through / auth / bad-id) before ever touching
// the DB, so these contract tests need only a no-op D1. The draft-merge /
// publish happy path runs against a real local D1 in the astro-preview E2E
// (there is no async in-memory SQLite harness in this repo).
//
// One behaviour that path guards and this file cannot: `applySaveDraft` now
// converts a `LouiseValidationError` thrown by the collection's `beforeChange`
// hook (e.g. an unknown section `_type`) into a 422, not the unhandled 500 it
// used to be. Reaching that throw needs a real D1 (a mock 404s on the current-row
// SELECT first), so it's asserted served, in CI's scaffold live-smoke leg
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
