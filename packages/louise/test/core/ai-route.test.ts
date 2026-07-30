import { describe, expect, it } from "vitest";
import { type AiRunner, aiRunner } from "../../src/core/ai/index.js";
import type { EditorSession } from "../../src/core/auth/index.js";
import { aiRoute } from "../../src/core/editor/index.js";

// aiRoute never touches D1, but EditorRouteEnv requires the binding — a no-op is
// enough. The real model calls are covered by the core/ai helper tests; here we
// assert routing, the editor guard, opt-in/degrade (503), validation, and the
// pass-through to the helpers.
const noopD1 = { prepare: () => ({ bind: () => ({}) }) } as unknown as D1Database;
const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };
const ctx = {} as ExecutionContext;

/** A fake runner returning a canned model output. */
const fakeRunner = (output: unknown): AiRunner => ({ run: async () => output });

const route = (opts: { editor?: EditorSession | null; ai?: AiRunner | undefined }) =>
  aiRoute<{ DB: D1Database }>({
    resolveEditor: () => ("editor" in opts ? (opts.editor ?? null) : editor),
    ai: () => ("ai" in opts ? opts.ai : fakeRunner({ response: "ok" })),
  });

const req = (method: string, path: string, body?: unknown, origin = "https://site.example") =>
  new Request(`https://site.example${path}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const env = { DB: noopD1 };

describe("aiRoute — routing", () => {
  it("falls through (undefined) on paths / actions it doesn't own", async () => {
    const r = route({});
    expect(await r(req("POST", "/other"), env, ctx)).toBeUndefined();
    expect(await r(req("POST", "/api/louise/ai"), env, ctx)).toBeUndefined();
    expect(await r(req("POST", "/api/louise/ai/bogus"), env, ctx)).toBeUndefined();
  });

  it("405s a non-POST on an owned action", async () => {
    const res = (await route({})(req("GET", "/api/louise/ai/rewrite"), env, ctx)) as Response;
    expect(res.status).toBe(405);
  });
});

describe("aiRoute — guard + availability", () => {
  it("denies when there is no editor session", async () => {
    const res = (await route({ editor: null })(
      req("POST", "/api/louise/ai/rewrite", { text: "hi" }),
      env,
      ctx,
    )) as Response;
    expect([401, 403]).toContain(res.status);
  });

  it("503s when the AI binding is absent (opt-in / degrade)", async () => {
    const res = (await route({ ai: undefined })(
      req("POST", "/api/louise/ai/rewrite", { text: "hi" }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(503);
  });
});

describe("aiRoute — rewrite", () => {
  it("400s an invalid body (missing text)", async () => {
    const res = (await route({})(req("POST", "/api/louise/ai/rewrite", {}), env, ctx)) as Response;
    expect(res.status).toBe(400);
  });

  it("returns the rewritten text on success", async () => {
    const r = route({ ai: fakeRunner({ response: "Tighter." }) });
    const res = (await r(
      req("POST", "/api/louise/ai/rewrite", { text: "a wordy passage", mode: "tighten" }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Tighter." });
  });

  it("502s when the model yields nothing", async () => {
    const r = route({ ai: fakeRunner({ nope: true }) });
    const res = (await r(
      req("POST", "/api/louise/ai/rewrite", { text: "x" }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(502);
  });
});

describe("aiRoute — seo", () => {
  it("returns a title + description on success", async () => {
    const r = route({ ai: fakeRunner({ response: '{"title":"T","description":"D"}' }) });
    const res = (await r(
      req("POST", "/api/louise/ai/seo", { content: "a page about coffee" }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "T", description: "D" });
  });

  it("502s when the reply can't be parsed", async () => {
    const r = route({ ai: fakeRunner({ response: "not json" }) });
    const res = (await r(
      req("POST", "/api/louise/ai/seo", { content: "x" }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(502);
  });
});

describe("aiRoute — AI Gateway (#87)", () => {
  it("forwards the configured gateway to the AI runner", async () => {
    let seen: Record<string, unknown> | undefined;
    const recording: AiRunner = {
      run: async (_m, _i, options) => {
        seen = options;
        return { response: "Tighter." };
      },
    };
    const r = aiRoute<{ DB: D1Database }>({
      resolveEditor: () => editor,
      ai: () => recording,
      gateway: () => ({ id: "louise-gw", cacheTtl: 60 }),
    });
    const res = (await r(
      req("POST", "/api/louise/ai/rewrite", { text: "a wordy passage" }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(200);
    expect(seen).toEqual({ gateway: { id: "louise-gw", cacheTtl: 60 } });
  });
});

describe("aiRoute — the LOUISE_AI kill switch (#334)", () => {
  /** The real wiring: the accessor is `aiRunner`, so the flag is read from env. */
  const flagged = (env: { DB: D1Database; AI?: AiRunner; LOUISE_AI?: string }) => ({
    route: aiRoute<{ DB: D1Database; AI?: AiRunner; LOUISE_AI?: string }>({
      resolveEditor: () => editor,
      ai: aiRunner,
    }),
    env,
  });

  it("503s with reason 'disabled' and never calls the model when off", async () => {
    let called = false;
    const AI: AiRunner = {
      run: async () => {
        called = true;
        return { response: "should not happen" };
      },
    };
    const { route: r, env: e } = flagged({ DB: noopD1, AI, LOUISE_AI: "off" });
    const res = await r(req("POST", "/api/louise/ai/rewrite", { text: "hello" }), e, ctx);

    expect(res?.status).toBe(503);
    expect(await res?.json()).toMatchObject({ reason: "disabled" });
    // The assertion that matters: no model was reached, so nothing was billed
    // and no content was generated while the switch was off.
    expect(called).toBe(false);
  });

  it("503s with reason 'unconfigured' when there is simply no binding", async () => {
    const { route: r, env: e } = flagged({ DB: noopD1 });
    const res = await r(req("POST", "/api/louise/ai/rewrite", { text: "hello" }), e, ctx);
    expect(res?.status).toBe(503);
    expect(await res?.json()).toMatchObject({ reason: "unconfigured" });
  });

  it("serves normally when the binding is present and the flag is unset", async () => {
    const { route: r, env: e } = flagged({ DB: noopD1, AI: fakeRunner({ response: "tightened" }) });
    const res = await r(req("POST", "/api/louise/ai/rewrite", { text: "hello" }), e, ctx);
    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({ text: "tightened" });
  });
});
