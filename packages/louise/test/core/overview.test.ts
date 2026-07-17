import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { overviewRoute } from "../../src/core/editor/index.js";

// The route only calls resolveEditor + the per-slice resolvers (plain functions
// here), so a no-op D1 satisfies the EditorRouteEnv type without a real DB.
const noopD1 = {} as unknown as D1Database;
type Env = { DB: D1Database };
const env: Env = { DB: noopD1 };
const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };
const ctx = {} as ExecutionContext;

const req = (method: string, path: string, origin = "https://site.example") =>
  new Request(`https://site.example${path}`, { method, headers: { origin } });

describe("overviewRoute", () => {
  it("falls through (undefined) on a path it doesn't own", async () => {
    const r = overviewRoute<Env>({ resolveEditor: () => editor });
    expect(await r(req("GET", "/other"), env, ctx)).toBeUndefined();
  });

  it("denies an unauthenticated request", async () => {
    const r = overviewRoute<Env>({ resolveEditor: () => null });
    const res = await r(req("GET", "/api/louise/overview"), env, ctx);
    expect(res?.status).toBeGreaterThanOrEqual(401);
    expect(res?.status).toBeLessThan(404);
  });

  it("405s a non-GET method", async () => {
    const r = overviewRoute<Env>({ resolveEditor: () => editor });
    const res = await r(req("POST", "/api/louise/overview"), env, ctx);
    expect(res?.status).toBe(405);
  });

  it("assembles the provided slices and omits the ones with no resolver", async () => {
    const r = overviewRoute<Env>({
      resolveEditor: () => editor,
      content: () => ({ drafts: 2, unpublished: 1 }),
      inbox: () => ({ unread: 3 }),
      // no health resolver → the key must be absent, not {} or null
    });
    const res = await r(req("GET", "/api/louise/overview"), env, ctx);
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body).toEqual({ content: { drafts: 2, unpublished: 1 }, inbox: { unread: 3 } });
    expect("health" in body).toBe(false);
  });

  it("awaits async resolvers and passes env through", async () => {
    let seen: Env | undefined;
    const r = overviewRoute<Env>({
      resolveEditor: () => editor,
      inbox: async (e) => {
        seen = e;
        return { unread: 7 };
      },
    });
    const res = await r(req("GET", "/api/louise/overview"), env, ctx);
    expect((await res!.json()) as unknown).toEqual({ inbox: { unread: 7 } });
    expect(seen).toBe(env);
  });

  it("treats a throwing / undefined resolver as absent, keeping the other slices", async () => {
    const r = overviewRoute<Env>({
      resolveEditor: () => editor,
      content: () => {
        throw new Error("D1 down");
      },
      inbox: () => undefined, // binding not provisioned
      health: () => ({ brokenLinks: 1, missingAlt: 0, seoGaps: 0 }),
    });
    const res = await r(req("GET", "/api/louise/overview"), env, ctx);
    expect(res?.status).toBe(200);
    // A broken/absent slice never 500s the dashboard — it's just omitted.
    expect((await res!.json()) as unknown).toEqual({
      health: { brokenLinks: 1, missingAlt: 0, seoGaps: 0 },
    });
  });

  it("honours a custom mount path", async () => {
    const r = overviewRoute<Env>({ resolveEditor: () => editor, path: "/api/x/overview" });
    expect(await r(req("GET", "/api/louise/overview"), env, ctx)).toBeUndefined();
    const res = await r(req("GET", "/api/x/overview"), env, ctx);
    expect(res?.status).toBe(200);
  });
});
