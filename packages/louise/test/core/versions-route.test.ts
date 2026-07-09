import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { collectionVersionsTable, defineCollection } from "../../src/core/cms/index.js";
import { pages } from "../../src/core/db/index.js";
import { versionsRoute } from "../../src/core/editor/index.js";

// The route short-circuits (fall-through / auth / bad-id) before ever touching
// the DB, so these contract tests need only a no-op D1. The draft-merge /
// publish happy path runs against a real local D1 in the astro-preview E2E
// (there is no async in-memory SQLite harness in this repo).
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
});
