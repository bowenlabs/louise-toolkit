import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { healthRoute } from "../../src/core/editor/index.js";
import type { HealthSummary } from "../../src/core/health/index.js";

type Env = { DB: D1Database };
const env: Env = { DB: {} as unknown as D1Database };
const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };
const ctx = {} as ExecutionContext;

const req = (method: string, path: string, origin = "https://site.example") =>
  new Request(`https://site.example${path}`, { method, headers: { origin } });

const summary: HealthSummary = {
  brokenLinks: 1,
  missingAlt: 2,
  seoGaps: 0,
  checkedAt: "2026-07-17T12:00:00.000Z",
  brokenLinkDetails: [{ url: "/gone", from: "/", status: 404 }],
};

describe("healthRoute", () => {
  it("falls through (undefined) on a path it doesn't own", async () => {
    const r = healthRoute<Env>({ resolveEditor: () => editor, read: () => summary });
    expect(await r(req("GET", "/other"), env, ctx)).toBeUndefined();
  });

  it("denies an unauthenticated request", async () => {
    const r = healthRoute<Env>({ resolveEditor: () => null, read: () => summary });
    const res = await r(req("GET", "/api/louise/health"), env, ctx);
    expect(res?.status).toBeGreaterThanOrEqual(401);
    expect(res?.status).toBeLessThan(404);
  });

  it("405s a non-GET method", async () => {
    const r = healthRoute<Env>({ resolveEditor: () => editor, read: () => summary });
    expect((await r(req("POST", "/api/louise/health"), env, ctx))?.status).toBe(405);
  });

  it("returns the persisted summary for an editor", async () => {
    const r = healthRoute<Env>({ resolveEditor: () => editor, read: () => summary });
    const res = await r(req("GET", "/api/louise/health"), env, ctx);
    expect(res?.status).toBe(200);
    expect((await res!.json()) as unknown).toEqual({ summary });
  });

  it("returns { summary: null } (200) when no scan has run", async () => {
    const r = healthRoute<Env>({ resolveEditor: () => editor, read: async () => null });
    const res = await r(req("GET", "/api/louise/health"), env, ctx);
    expect(res?.status).toBe(200);
    expect((await res!.json()) as unknown).toEqual({ summary: null });
  });

  it("honours a custom mount path", async () => {
    const r = healthRoute<Env>({
      resolveEditor: () => editor,
      read: () => summary,
      path: "/api/x/health",
    });
    expect(await r(req("GET", "/api/louise/health"), env, ctx)).toBeUndefined();
    expect((await r(req("GET", "/api/x/health"), env, ctx))?.status).toBe(200);
  });
});
