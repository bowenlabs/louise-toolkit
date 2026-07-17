import { describe, expect, it, vi } from "vitest";
import { isCacheableDirective, withEdgeCache } from "../../src/core/worker/index.js";

/** A fake `Cache` recording match/put/delete. `match` returns a stored entry by
 *  URL; `put` stores the response keyed by the request URL. */
function fakeCache() {
  const store = new Map<string, Response>();
  const puts: { url: string; cacheControl: string | null; hasSetCookie: boolean }[] = [];
  const cache = {
    match: vi.fn(async (req: Request) => store.get(req.url)),
    put: vi.fn(async (req: Request, res: Response) => {
      puts.push({
        url: req.url,
        cacheControl: res.headers.get("cache-control"),
        hasSetCookie: res.headers.has("set-cookie"),
      });
      store.set(req.url, res);
    }),
    delete: vi.fn(async (req: Request) => store.delete(req.url)),
  } as unknown as Cache;
  return { cache, store, puts };
}

/** A minimal ExecutionContext whose waitUntil awaits inline so puts are observable. */
function ctx(): ExecutionContext {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException: () => {},
    // test helper — drain queued waitUntil work
    _drain: () => Promise.all(pending),
  } as unknown as ExecutionContext;
}

const CDN = "cloudflare-cdn-cache-control";
const req = (url = "https://site.example/", init?: RequestInit) => new Request(url, init);

function handlerReturning(headers: Record<string, string>, body = "page") {
  return vi.fn(async () => new Response(body, { headers }));
}

describe("isCacheableDirective", () => {
  it("accepts public + positive max-age", () => {
    expect(isCacheableDirective("public, max-age=60")).toBe(true);
    expect(isCacheableDirective("max-age=1, stale-while-revalidate=99")).toBe(true);
  });
  it("rejects no-store / no-cache / private / zero / missing", () => {
    expect(isCacheableDirective("no-store")).toBe(false);
    expect(isCacheableDirective("public, no-cache")).toBe(false);
    expect(isCacheableDirective("private, max-age=60")).toBe(false);
    expect(isCacheableDirective("public, max-age=0")).toBe(false);
    expect(isCacheableDirective("public")).toBe(false);
    expect(isCacheableDirective(null)).toBe(false);
    expect(isCacheableDirective(undefined)).toBe(false);
  });
});

describe("withEdgeCache", () => {
  it("caches a public GET with a cacheable CDN directive, stripping the signal", async () => {
    const { cache, puts } = fakeCache();
    const c = ctx();
    const handler = handlerReturning({ [CDN]: "public, max-age=60" });
    const wrapped = withEdgeCache(handler, { cache: () => cache });

    const res = await wrapped(req(), {}, c);
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();

    // Signal stripped from the client response (so CF's automatic edge cache never engages).
    expect(res.headers.get(CDN)).toBeNull();
    // Stored with the directive mirrored onto standard Cache-Control.
    expect(puts).toHaveLength(1);
    expect(puts[0]?.cacheControl).toBe("public, max-age=60");
  });

  it("serves a stored entry on the second public GET without calling the handler", async () => {
    const { cache } = fakeCache();
    const c = ctx();
    const handler = handlerReturning({ [CDN]: "public, max-age=60" });
    const wrapped = withEdgeCache(handler, { cache: () => cache });

    await wrapped(req(), {}, c);
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();
    await wrapped(req(), {}, c);

    expect(handler).toHaveBeenCalledTimes(1); // second request was a cache hit
  });

  it("bypasses the cache (read + write) for an editor and still strips the signal", async () => {
    const { cache, puts } = fakeCache();
    const c = ctx();
    const handler = handlerReturning({ [CDN]: "public, max-age=60" });
    const wrapped = withEdgeCache(handler, {
      cache: () => cache,
      bypass: (r) => (r.headers.get("cookie") ?? "").includes("louise_edit=1"),
    });

    const res = await wrapped(
      req("https://site.example/", { headers: { cookie: "louise_edit=1" } }),
      {},
      c,
    );
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();

    expect(cache.match).not.toHaveBeenCalled(); // never reads cache
    expect(puts).toHaveLength(0); // never writes cache
    expect(res.headers.get(CDN)).toBeNull(); // signal still stripped → no auto edge cache
  });

  it("an editor is never served an entry a public visitor cached", async () => {
    const { cache } = fakeCache();
    const c = ctx();
    const handler = handlerReturning({ [CDN]: "public, max-age=60" }, "PUBLIC");
    const bypass = (r: Request) => (r.headers.get("cookie") ?? "").includes("louise_edit=1");
    const wrapped = withEdgeCache(handler, { cache: () => cache, bypass });

    // Public visitor warms the cache.
    await wrapped(req(), {}, c);
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();
    // Editor hits the same URL → must run the handler, not read the cached PUBLIC page.
    handler.mockClear();
    await wrapped(req("https://site.example/", { headers: { cookie: "louise_edit=1" } }), {}, c);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not cache a no-store response (uncacheable route)", async () => {
    const { cache, puts } = fakeCache();
    const c = ctx();
    const handler = handlerReturning({ [CDN]: "no-store" });
    const wrapped = withEdgeCache(handler, { cache: () => cache });
    await wrapped(req(), {}, c);
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();
    expect(puts).toHaveLength(0);
  });

  it("does not cache non-GET requests", async () => {
    const { cache, puts } = fakeCache();
    const c = ctx();
    const handler = handlerReturning({ [CDN]: "public, max-age=60" });
    const wrapped = withEdgeCache(handler, { cache: () => cache });
    await wrapped(req("https://site.example/", { method: "POST" }), {}, c);
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();
    expect(cache.match).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });

  it("drops Set-Cookie from the cached copy (cache.put would reject it)", async () => {
    const { cache, puts } = fakeCache();
    const c = ctx();
    const handler = handlerReturning({ [CDN]: "public, max-age=60", "set-cookie": "sess=abc" });
    const wrapped = withEdgeCache(handler, { cache: () => cache });
    const res = await wrapped(req(), {}, c);
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();
    expect(puts[0]?.hasSetCookie).toBe(false); // stripped before caching
    expect(res.headers.get("set-cookie")).toBe("sess=abc"); // client response keeps it
  });
});
