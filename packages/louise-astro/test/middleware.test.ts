import type { APIContext, MiddlewareHandler, MiddlewareNext } from "astro";
import { describe, expect, it } from "vitest";
import { createLouiseMiddleware } from "../src/middleware.js";
import type { IncidentReport } from "louise-toolkit/incidents";
import type { KVLike, RateRule } from "louise-toolkit/security";
import { composeWorker } from "louise-toolkit/worker";

/** In-memory KV counter—the same fake the security tests use. */
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
    // Building the middleware must NOT touch the binding—`env` is only valid in
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
    // Three POSTs over a limit of 2—but with no backend, none are blocked.
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
    // Not `next(undefined)` by accident—an unrewritten request must take the
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
    // rendering another tenant's page—so this must not be swallowed.
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
    // out"—never to "extend was skipped", because extend is what writes
    // locals.tenant, and skipping it silently turns every tenant subdomain
    // into the ordinary site. Found live on a client site.
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

describe("createLouiseMiddleware — noindex", () => {
  it("sends X-Robots-Tag: noindex on a host the predicate names", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      noindex: (host) => host === "example.com",
    });
    const res = await run(mw, makeContext("GET", "/"));
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("sends nothing for any other host, or without the option", async () => {
    const other = createLouiseMiddleware({ resolveEditor: () => null, noindex: () => false });
    expect((await run(other, makeContext("GET", "/"))).headers.get("x-robots-tag")).toBeNull();
    const none = createLouiseMiddleware({ resolveEditor: () => null });
    expect((await run(none, makeContext("GET", "/"))).headers.get("x-robots-tag")).toBeNull();
  });

  it("still sends it when the rest of the security headers are off", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      securityHeaders: false,
      noindex: () => true,
    });
    const res = await run(mw, makeContext("GET", "/"));
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("x-frame-options")).toBeNull();
  });
});

describe("createLouiseMiddleware — apiGate (ADR 0012)", () => {
  const editor = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };

  /** An APIContext for `path`, with the headers a browser would send. */
  function apiContext(
    path: string,
    init: { method?: string; origin?: string | null; headers?: Record<string, string> } = {},
  ): APIContext {
    const url = new URL(`https://example.com${path}`);
    const headers = new Headers(init.headers);
    const origin = init.origin === undefined ? "https://example.com" : init.origin;
    if (origin) headers.set("origin", origin);
    return {
      request: new Request(url, { method: init.method ?? "GET", headers }),
      url,
      locals: {},
      cookies: { get: () => undefined, set() {}, delete() {} },
    } as unknown as APIContext;
  }

  /** A route that forgot its own guard: answers anyone. */
  const route = (init?: ResponseInit) => {
    const calls = { n: 0 };
    const next: MiddlewareNext = async () => {
      calls.n++;
      return Response.json({ secret: "rows" }, init);
    };
    return { next, calls };
  };

  it("refuses an anonymous request before the route runs, with security headers", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null, apiGate: true });
    const { next, calls } = route();
    const res = (await mw(apiContext("/api/louise/crm/1"), next)) as Response;
    expect(res.status).toBe(401);
    expect(calls.n).toBe(0);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("lets an editor through, and marks the answer no-store", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => editor, apiGate: true });
    const { next } = route();
    const res = (await mw(apiContext("/api/louise/crm/1"), next)) as Response;
    expect(await res.json()).toEqual({ secret: "rows" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps a cache policy the route chose", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => editor, apiGate: true });
    const { next } = route({ headers: { "cache-control": "private, max-age=30" } });
    const res = (await mw(apiContext("/api/louise/crm/1"), next)) as Response;
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
  });

  it("403s a cross-origin write and a cross-origin WebSocket upgrade", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => editor, apiGate: true });
    const evil = "https://evil.example";
    const write = apiContext("/api/louise/pages/1", { method: "POST", origin: evil });
    expect(((await mw(write, route().next)) as Response).status).toBe(403);
    const upgrade = apiContext("/api/louise/realtime/pages/1", {
      origin: evil,
      headers: { upgrade: "websocket" },
    });
    expect(((await mw(upgrade, route().next)) as Response).status).toBe(403);
  });

  it("fails closed when resolveEditor throws — pages degrade, the API refuses", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => {
        throw new Error("SESSION_SECRET is not configured");
      },
      apiGate: true,
    });
    expect(((await mw(apiContext("/api/louise/crm/1"), route().next)) as Response).status).toBe(
      401,
    );
    // The same failure on a page still renders it publicly.
    expect((await run(mw, makeContext("GET", "/about"))).status).toBe(200);
  });

  it("exempts the toolkit's own public routes at their default mounts", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null, apiGate: true });
    for (const path of ["/api/louise/forms/contact", "/api/louise/vitals"]) {
      const { next, calls } = route();
      await mw(apiContext(path, { method: "POST" }), next);
      expect(calls.n, path).toBe(1);
    }
    // The status probe is an anonymous GET from outside, with no Origin.
    const status = route();
    await mw(apiContext("/api/louise/status", { origin: null }), status.next);
    expect(status.calls.n).toBe(1);
  });

  it("exempts a site's own public path, and nothing else", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      apiGate: { isPublic: (p) => p === "/api/louise/hooks/shop" },
    });
    const hook = route();
    await mw(apiContext("/api/louise/hooks/shop", { method: "POST", origin: null }), hook.next);
    expect(hook.calls.n).toBe(1);
    const other = route();
    const res = (await mw(apiContext("/api/louise/hooks/other"), other.next)) as Response;
    expect(res.status).toBe(401);
    expect(other.calls.n).toBe(0);
  });

  it("lets a bearer request through only to a path that takes one", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      apiGate: { takesBearer: (p) => p === "/api/louise/mcp" },
    });
    const bearer = { authorization: "Bearer louise_at_x" };
    // The MCP route checks the token itself, so the gate steps aside for it.
    const mcp = route();
    await mw(
      apiContext("/api/louise/mcp", { method: "POST", origin: null, headers: bearer }),
      mcp.next,
    );
    expect(mcp.calls.n).toBe(1);
    // Anywhere else, a bearer header is no credential at all.
    const other = route();
    const res = (await mw(
      apiContext("/api/louise/pages", { method: "POST", origin: null, headers: bearer }),
      other.next,
    )) as Response;
    expect(res.status).toBe(403);
    expect(other.calls.n).toBe(0);
    // And with no bearer header, the MCP path is gated like any other.
    const cookie = route();
    const gated = (await mw(
      apiContext("/api/louise/mcp", { method: "POST" }),
      cookie.next,
    )) as Response;
    expect(gated.status).toBe(401);
    expect(cookie.calls.n).toBe(0);
  });

  it("takes no bearer request past the gate unless told to", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null, apiGate: true });
    const mcp = route();
    const res = (await mw(
      apiContext("/api/louise/mcp", {
        method: "POST",
        origin: null,
        headers: { authorization: "Bearer louise_at_x" },
      }),
      mcp.next,
    )) as Response;
    expect(res.status).toBe(403);
    expect(mcp.calls.n).toBe(0);
  });

  it("never gates outside the prefix, and is off unless asked for", async () => {
    const gated = createLouiseMiddleware({ resolveEditor: () => null, apiGate: true });
    expect(((await gated(apiContext("/api/louise-shop/x"), route().next)) as Response).status).toBe(
      200,
    );
    const off = createLouiseMiddleware({ resolveEditor: () => null });
    expect(((await off(apiContext("/api/louise/crm/1"), route().next)) as Response).status).toBe(
      200,
    );
  });

  it("honours a custom prefix", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      apiGate: { prefix: "/admin/api" },
    });
    expect(((await mw(apiContext("/admin/api/x"), route().next)) as Response).status).toBe(401);
    expect(((await mw(apiContext("/api/louise/x"), route().next)) as Response).status).toBe(200);
  });
});

describe("createLouiseMiddleware — redirecting a page that moved (#574)", () => {
  const notFound: MiddlewareNext = async () =>
    new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  const moved = (path: string) =>
    path === "/about-us" ? { location: "/about", status: 301 } : null;

  it("answers a 404 for an old path with a redirect, keeping the query string", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null, redirectFor: moved });
    const res = (await mw(makeContext("GET", "/about-us?ref=mail"), notFound)) as Response;
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/about?ref=mail");
  });

  it("leaves a live page alone, even on a path with a redirect", async () => {
    let asked = 0;
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      redirectFor: (path) => {
        asked++;
        return moved(path);
      },
    });
    const res = await run(mw, makeContext("GET", "/about-us"));
    expect(res.status).toBe(200);
    expect(asked).toBe(0);
  });

  it("keeps the 404 for a write, a path that never moved, or a lookup that throws", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null, redirectFor: moved });
    expect(((await mw(makeContext("POST", "/about-us"), notFound)) as Response).status).toBe(404);
    expect(((await mw(makeContext("GET", "/contact"), notFound)) as Response).status).toBe(404);
    const broken = createLouiseMiddleware({
      resolveEditor: () => null,
      redirectFor: () => {
        throw new Error("D1 unreachable");
      },
    });
    expect(((await broken(makeContext("GET", "/about-us"), notFound)) as Response).status).toBe(
      404,
    );
  });
});

describe("createLouiseMiddleware — edit mode (#508)", () => {
  const signedIn = () =>
    createLouiseMiddleware({ resolveEditor: () => ({ email: "alex@example.com" }) as never });
  const ctxAt = (path: string, cookie?: string) => {
    const ctx = makeContext("GET", path);
    if (cookie) ctx.cookies.set("louise_edit", cookie);
    return ctx;
  };
  const editMode = (ctx: APIContext) => (ctx.locals as { editMode: boolean }).editMode;

  it("enters edit mode on ?louise and remembers it in a cookie", async () => {
    const ctx = ctxAt("/?louise");
    await run(signedIn(), ctx);
    expect(editMode(ctx)).toBe(true);
    expect(ctx.cookies.get("louise_edit")?.value).toBe("1");
  });

  it("stays in edit mode from the cookie alone, and leaves on ?louise=off", async () => {
    const sticky = ctxAt("/about", "1");
    await run(signedIn(), sticky);
    expect(editMode(sticky)).toBe(true);

    const off = ctxAt("/about?louise=off", "1");
    await run(signedIn(), off);
    expect(editMode(off)).toBe(false);
    expect(off.cookies.get("louise_edit")).toBeUndefined();
  });

  it("ignores the cookie without a session", async () => {
    const ctx = ctxAt("/about", "1");
    await run(createLouiseMiddleware({ resolveEditor: () => null }), ctx);
    expect(editMode(ctx)).toBe(false);
  });
});

describe("createLouiseMiddleware — cspStyleSrc", () => {
  it("rewrites the response CSP's style-src", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      cspStyleSrc: "'self' 'unsafe-inline'",
    });
    const res = (await mw(
      makeContext("GET", "/"),
      async () =>
        new Response("ok", {
          headers: {
            "content-type": "text/html",
            "content-security-policy": "default-src 'self'; style-src 'self'",
          },
        }),
    )) as Response;
    expect(res.headers.get("content-security-policy")).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
  });
});

describe("createLouiseMiddleware—incidents (ADR 0022)", () => {
  // Astro catches a page's throw outside every middleware and renders its own
  // 500, so this stands in for Astro inside a composeWorker fallback.
  async function throughWorker(
    mw: MiddlewareHandler,
    next: MiddlewareNext,
    path = "/menu",
  ): Promise<{ status: number; reports: IncidentReport[] }> {
    const reports: IncidentReport[] = [];
    const worker = composeWorker({
      fetch: async (request) => {
        const context = makeContext(request.method, new URL(request.url).pathname);
        try {
          return (await mw(context, next)) as Response;
        } catch {
          return new Response("Astro's error page", { status: 500 });
        }
      },
      onIncident: (report) => {
        reports.push(report);
      },
    });
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException() {},
    };
    const res = await worker.fetch!(
      new Request(`https://example.com${path}`) as unknown as Parameters<
        NonNullable<ExportedHandler["fetch"]>
      >[0],
      {},
      ctx as unknown as ExecutionContext,
    );
    await Promise.all(pending);
    return { status: res.status, reports };
  }

  const throwingPage: MiddlewareNext = async () => {
    throw new TypeError("Cannot read properties of undefined (reading 'title')");
  };

  it("reports a page's throw, and re-throws it for Astro's error page", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null });
    const { status, reports } = await throughWorker(mw, throwingPage);
    expect(status).toBe(500);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: "fetch", name: "TypeError", path: "/menu" });
  });

  it("reports a guard that throws", async () => {
    const mw = createLouiseMiddleware({
      resolveEditor: () => null,
      guard: () => {
        throw new Error("guard broke");
      },
    });
    const { reports } = await throughWorker(mw, htmlNext);
    expect(reports.map((r) => r.message)).toEqual(["guard broke"]);
  });

  it("counts an error once when it also escapes to composeWorker", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null });
    const reports: IncidentReport[] = [];
    const worker = composeWorker({
      // No catch here: the error escapes the middleware and the fallback both.
      fetch: async (request) =>
        (await mw(makeContext("GET", new URL(request.url).pathname), throwingPage)) as Response,
      onIncident: (report) => {
        reports.push(report);
      },
    });
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException() {},
    };
    await expect(
      worker.fetch!(
        new Request("https://example.com/menu") as unknown as Parameters<
          NonNullable<ExportedHandler["fetch"]>
        >[0],
        {},
        ctx as unknown as ExecutionContext,
      ),
    ).rejects.toThrow(TypeError);
    await Promise.all(pending);
    expect(reports).toHaveLength(1);
  });

  it("changes nothing for a page that doesn't throw", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null });
    const { status, reports } = await throughWorker(mw, htmlNext);
    expect(status).toBe(200);
    expect(reports).toEqual([]);
  });

  it("reports nothing with reportErrors: false", async () => {
    const mw = createLouiseMiddleware({ resolveEditor: () => null, reportErrors: false });
    const { status, reports } = await throughWorker(mw, throwingPage);
    expect(status).toBe(500);
    expect(reports).toEqual([]);
  });
});
