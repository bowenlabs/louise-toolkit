import type { APIContext, MiddlewareHandler, MiddlewareNext } from "astro";
import { describe, expect, it } from "vitest";
import { createLouiseMiddleware } from "../../src/astro/middleware.js";
import type { KVLike, RateRule } from "../../src/core/security/index.js";

/** In-memory KV counter — the same fake the security tests use. */
function makeKv(): KVLike {
  const store = new Map<string, string>();
  return {
    async get(k) {
      return store.get(k) ?? null;
    },
    async put(k, v) {
      store.set(k, v);
    },
  };
}

const RULES: RateRule[] = [
  {
    name: "auth",
    method: "POST",
    match: (p) => p.startsWith("/api/auth/"),
    limit: 2,
    windowSec: 60,
  },
];

/** Minimal APIContext for driving the middleware handler directly. */
function makeContext(method: string, path: string, ip = "1.2.3.4"): APIContext {
  const url = new URL(`https://example.com${path}`);
  const jar = new Map<string, string>();
  return {
    request: new Request(url, { method, headers: { "cf-connecting-ip": ip } }),
    url,
    locals: {},
    cookies: {
      get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
      set: (k: string, v: string) => jar.set(k, v),
      delete: (k: string) => jar.delete(k),
    },
  } as unknown as APIContext;
}

const htmlNext: MiddlewareNext = async () =>
  new Response("ok", { headers: { "content-type": "text/html" } });

/** Drive the middleware and assert it resolved to a Response (never `void`). */
async function run(mw: MiddlewareHandler, ctx: APIContext): Promise<Response> {
  const res = await mw(ctx, htmlNext);
  expect(res).toBeInstanceOf(Response);
  return res as Response;
}

describe("createLouiseMiddleware — rate limiting", () => {
  it("resolves a function `kv` per request, never at construction (deferred env read)", async () => {
    let reads = 0;
    const kv = makeKv();
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rateLimit: {
        rules: RULES,
        kv: () => {
          reads++;
          return kv;
        },
      },
    });
    // Building the middleware must NOT touch the binding — `env` is only valid in
    // request scope, so an eager read here would crash at module load.
    expect(reads).toBe(0);

    await run(mw, makeContext("POST", "/api/auth/sign-in/magic-link"));
    expect(reads).toBe(1);
  });

  it("blocks a matched surface once the budget is spent (429 + Retry-After)", async () => {
    const kv = makeKv();
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rateLimit: { rules: RULES, kv: () => kv },
    });
    const hit = () => run(mw, makeContext("POST", "/api/auth/sign-in/magic-link"));
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("leaves unmatched requests alone — the limiter is never consulted", async () => {
    let reads = 0;
    const kv = makeKv();
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rateLimit: {
        rules: RULES,
        kv: () => {
          reads++;
          return kv;
        },
      },
    });
    const res = await run(mw, makeContext("GET", "/"));
    expect(res.status).toBe(200);
    expect(reads).toBe(0); // no rule matches → the limiter (and its getter) is never consulted
  });

  it("fails open when the getter yields no backend (binding not provisioned yet)", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rateLimit: { rules: RULES, kv: () => undefined },
    });
    // Three POSTs over a limit of 2 — but with no backend, none are blocked.
    const hit = () => run(mw, makeContext("POST", "/api/auth/sign-in/magic-link"));
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
  });

  it("still accepts a plain backend (non-getter) — backward compatible", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rateLimit: { rules: RULES, kv: makeKv() },
    });
    const hit = () => run(mw, makeContext("POST", "/api/auth/sign-in/magic-link"));
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
  });
});
