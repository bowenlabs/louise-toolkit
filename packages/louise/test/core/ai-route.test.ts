import { describe, expect, it } from "vitest";
import { type AiRunner, aiRunner, REWRITE_MAX_CHARS } from "../../src/core/ai/index.js";
import type { EditorSession } from "../../src/core/auth/index.js";
import { pages } from "../../src/core/db/index.js";
import { aiRoute, seoFixRoute } from "../../src/core/editor/index.js";

// aiRoute never touches D1, but EditorRouteEnv requires the binding—a no-op is
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

  it("413s a selection past the cap, with a message the toolbar can show (#550)", async () => {
    let called = false;
    const counting: AiRunner = {
      run: async () => {
        called = true;
        return { response: "x" };
      },
    };
    const res = (await route({ ai: counting })(
      req("POST", "/api/louise/ai/rewrite", { text: "a".repeat(REWRITE_MAX_CHARS + 1) }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("shorter passage");
    expect(body.error).toContain(REWRITE_MAX_CHARS.toLocaleString("en-US"));
    // Refused before the model: nothing is spent on it.
    expect(called).toBe(false);
  });

  it("accepts a selection exactly at the cap", async () => {
    const res = (await route({})(
      req("POST", "/api/louise/ai/rewrite", { text: "a".repeat(REWRITE_MAX_CHARS) }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(200);
  });

  it("502s a truncated rewrite, so the client keeps the original text (#466)", async () => {
    const r = route({ ai: fakeRunner({ response: "The first half", finish_reason: "length" }) });
    const res = (await r(
      req("POST", "/api/louise/ai/rewrite", { text: "a long passage" }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(502);
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

// A COMPILE-TIME assertion, not a runtime one. `aiRunner` is passed as a route's
// `ai` accessor, whose parameter is that route's own `Env`—so typing it to
// describe the env it reads (`{ AI?, LOUISE_AI? }`) makes it unassignable there:
// TypeScript sees no properties in common with `EditorRouteEnv` and rejects it.
//
// The first version of this shipped exactly that signature. Every unit test
// passed, because they all declared envs that happened to include `AI`—the
// break only appeared in the scaffold smoke job, which type-checks a generated
// worker against the built library. These lines fail `tsgo` locally instead.
describe("aiRunner is usable as a route accessor", () => {
  it("type-checks against envs that declare no AI members", () => {
    // Bare env, exactly like a generated worker's CloudflareEnv at this call.
    type BareEnv = { DB: D1Database };

    const routes = [
      aiRoute<BareEnv>({ resolveEditor: () => editor, ai: aiRunner }),
      seoFixRoute<BareEnv>({ table: pages, resolveEditor: () => editor, ai: aiRunner }),
    ];
    expect(routes).toHaveLength(2);
  });
});

describe("aiRoute — the site's voice (#553)", () => {
  /** A runner that records the messages it's sent. */
  function recording(output: unknown) {
    const sent: { role: string; content: string }[][] = [];
    const runner: AiRunner = {
      run: async (_model, inputs) => {
        sent.push((inputs as { messages: { role: string; content: string }[] }).messages);
        return output;
      },
    };
    return { runner, sent };
  }

  it("passes the site's instructions and examples to rewrite", async () => {
    const { runner, sent } = recording({ response: "Plainer." });
    const r = aiRoute<{ DB: D1Database }>({
      resolveEditor: () => editor,
      ai: () => runner,
      rewrite: {
        instructions: "Warm and plain. British English.",
        examples: [{ before: "Utilise it.", after: "Use it." }],
      },
    });
    const res = (await r(
      req("POST", "/api/louise/ai/rewrite", { text: "Utilize this." }),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(200);
    const messages = sent[0]!;
    expect(messages[0]!.content).toContain(
      "Follow this guidance for the site: Warm and plain. British English.",
    );
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "Utilise it." },
      { role: "assistant", content: "Use it." },
      { role: "user", content: "Utilize this." },
    ]);
  });

  it("passes the site's instructions to SEO suggestions", async () => {
    const { runner, sent } = recording({ response: { title: "T", description: "D" } });
    const r = aiRoute<{ DB: D1Database }>({
      resolveEditor: () => editor,
      ai: () => runner,
      seo: { instructions: "Audience: home cooks." },
    });
    await r(req("POST", "/api/louise/ai/seo", { content: "A page about bread." }), env, ctx);
    expect(sent[0]![0]!.content).toContain(
      "Follow this guidance for the site: Audience: home cooks.",
    );
  });

  it("sends the fixed prompt alone when a site gives no voice", async () => {
    const { runner, sent } = recording({ response: "Plainer." });
    const r = aiRoute<{ DB: D1Database }>({ resolveEditor: () => editor, ai: () => runner });
    await r(req("POST", "/api/louise/ai/rewrite", { text: "Utilize this." }), env, ctx);
    expect(sent[0]![0]!.content).not.toContain("guidance");
    expect(sent[0]).toHaveLength(2);
  });
});
