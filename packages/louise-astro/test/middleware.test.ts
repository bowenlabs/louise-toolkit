import type { APIContext, MiddlewareHandler, MiddlewareNext } from "astro";
import { describe, expect, it } from "vitest";
import { createLouiseMiddleware } from "../src/middleware.js";
import type { KVLike, RateRule } from "louise-toolkit/security";

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

describe("createLouiseMiddleware — rewrite (#307)", () => {
  /** A `next` that records what payload it was handed. */
  const spyNext = () => {
    const seen: (string | URL | Request | undefined)[] = [];
    const next: MiddlewareNext = async (payload) => {
      seen.push(payload);
      return new Response("ok", { headers: { "content-type": "text/html" } });
    };
    return { next, seen };
  };

  it("passes the rewritten path to next()", async () => {
    const { next, seen } = spyNext();
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rewrite: (context) => `/t/acme${context.url.pathname}`,
    });
    await mw(makeContext("GET", "/prints"), next);
    expect(seen).toEqual(["/t/acme/prints"]);
  });

  it("calls next() bare when the hook returns undefined", async () => {
    // Not `next(undefined)` by accident — an unrewritten request must take the
    // exact path it always did.
    const { next, seen } = spyNext();
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rewrite: () => undefined,
    });
    await mw(makeContext("GET", "/prints"), next);
    expect(seen).toEqual([undefined]);
  });

  it("leaves context.url alone — it's a rewrite, not a redirect", async () => {
    // The visitor's URL is the public address, and links rendered from it have
    // to stay correct.
    const { next } = spyNext();
    const ctx = makeContext("GET", "/prints");
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rewrite: () => "/t/acme/prints",
    });
    await mw(ctx, next);
    expect(ctx.url.pathname).toBe("/prints");
  });

  it("runs AFTER the guard, so policy is written against the public path", async () => {
    const order: string[] = [];
    const { next, seen } = spyNext();
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      guard: (context) => {
        order.push(`guard:${context.url.pathname}`);
        return undefined;
      },
      rewrite: () => {
        order.push("rewrite");
        return "/t/acme/prints";
      },
    });
    await mw(makeContext("GET", "/prints"), next);
    expect(order).toEqual(["guard:/prints", "rewrite"]);
    expect(seen).toEqual(["/t/acme/prints"]);
  });

  it("does not rewrite a request the guard refused", async () => {
    const { next, seen } = spyNext();
    const rewrite = () => "/t/acme/prints";
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      guard: () => new Response("nope", { status: 403 }),
      rewrite,
    });
    const res = await mw(makeContext("GET", "/prints"), next);
    expect((res as Response).status).toBe(403);
    // next() never ran, so nothing was rendered under either path.
    expect(seen).toEqual([]);
  });

  it("sees locals written by extend", async () => {
    // The ordering tenancy depends on: resolve the tenant in `extend`, then map
    // it to a path in `rewrite`.
    const { next, seen } = spyNext();
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      extend: (context) => {
        (context.locals as { tenant?: string }).tenant = "acme";
      },
      rewrite: (context) => {
        const tenant = (context.locals as { tenant?: string }).tenant;
        return tenant ? `/t/${tenant}${context.url.pathname}` : undefined;
      },
    });
    await mw(makeContext("GET", "/prints"), next);
    expect(seen).toEqual(["/t/acme/prints"]);
  });

  it("lets a throwing rewrite fail loudly rather than serve the unrewritten path", async () => {
    // Degrading to the unrewritten path would, under host dispatch, mean
    // rendering another tenant's page — so this must not be swallowed.
    const { next } = spyNext();
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      rewrite: () => {
        throw new Error("tenant lookup failed");
      },
    });
    await expect(mw(makeContext("GET", "/prints"), next)).rejects.toThrow("tenant lookup failed");
  });
});

describe("createLouiseMiddleware — extend survives an auth failure", () => {
  it("still runs extend when resolveEditor throws", async () => {
    // The dormant-until-provisioned state: SESSION_SECRET is a sentinel, so
    // resolveEditor throws on every request. That must degrade to "signed
    // out" — never to "extend was skipped", because extend is what writes
    // locals.tenant, and skipping it silently turns every tenant subdomain
    // into the ordinary site. Found live on themidwestartist.com's Wave 4.
    let extended = false;
    const mw = createLouiseMiddleware({
      resolveEditor: () => {
        throw new Error("SESSION_SECRET is not configured");
      },
      extend: (context) => {
        extended = true;
        (context.locals as Record<string, unknown>).tenant = { slug: "acme" };
      },
    });
    const ctx = makeContext("GET", "/");
    await run(mw, ctx);
    expect(extended).toBe(true);
    expect((ctx.locals as Record<string, unknown>).tenant).toEqual({ slug: "acme" });
    expect((ctx.locals as Record<string, unknown>).editor).toBeNull();
  });

  it("still resolves the editor when extend throws", async () => {
    // Symmetric: a broken extend must not cancel auth either.
    const mw = createLouiseMiddleware({
      resolveEditor: () => ({ email: "meg@example.com" }) as never,
      extend: () => {
        throw new Error("tenant lookup exploded");
      },
    });
    const ctx = makeContext("GET", "/");
    await run(mw, ctx);
    expect((ctx.locals as { editor: { email: string } | null }).editor).toEqual({
      email: "meg@example.com",
    });
  });
});
