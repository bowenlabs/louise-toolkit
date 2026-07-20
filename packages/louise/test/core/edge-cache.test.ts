import { describe, expect, it, vi } from "vitest";
import {
  edgeCacheKeyUrl,
  isCacheableDirective,
  isEditRequest,
  LOUISE_EDIT_COOKIE,
  withEdgeCache,
} from "../../src/core/worker/index.js";

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
    // The client is told no-store: caches.default is the only cache that holds the
    // HTML, so no browser / CF edge / stray Cache Rule can shared-cache it.
    expect(res.headers.get("cache-control")).toBe("no-store");
    // …but the STORED copy keeps the real directive, so caches.default gets its TTL.
    expect(puts).toHaveLength(1);
    expect(puts[0]?.cacheControl).toBe("public, max-age=60");
  });

  it("serves a stored entry on the second public GET, still no-store on the wire", async () => {
    const { cache } = fakeCache();
    const c = ctx();
    const handler = handlerReturning({ [CDN]: "public, max-age=60" });
    const wrapped = withEdgeCache(handler, { cache: () => cache });

    await wrapped(req(), {}, c);
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();
    const hit = await wrapped(req(), {}, c);

    expect(handler).toHaveBeenCalledTimes(1); // second request was a cache hit
    // The hit is served to the client no-store (and without the CDN signal) too.
    expect(hit.headers.get("cache-control")).toBe("no-store");
    expect(hit.headers.get(CDN)).toBeNull();
    expect(await hit.text()).toBe("page");
  });

  it("leaves a non-cached response's own Cache-Control untouched (e.g. immutable assets)", async () => {
    const { cache, puts } = fakeCache();
    const c = ctx();
    // A hashed asset: standard Cache-Control, no CDN signal → this layer must not
    // cache it and must NOT rewrite its long-lived immutable directive to no-store.
    const handler = handlerReturning({ "cache-control": "public, max-age=31536000, immutable" });
    const wrapped = withEdgeCache(handler, { cache: () => cache });

    const res = await wrapped(req("https://site.example/_astro/app.abcd.js"), {}, c);
    await (c as unknown as { _drain: () => Promise<unknown> })._drain();

    expect(puts).toHaveLength(0); // not cached (no cacheable CDN directive)
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
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

describe("edgeCacheKeyUrl", () => {
  it("strips tracking params so campaign links share one entry", () => {
    expect(edgeCacheKeyUrl("https://x.test/p?utm_source=news&utm_medium=email")).toBe(
      "https://x.test/p",
    );
    expect(edgeCacheKeyUrl("https://x.test/p?fbclid=abc&gclid=def&msclkid=ghi")).toBe(
      "https://x.test/p",
    );
  });

  it("keeps content-bearing params and sorts them for a stable key", () => {
    expect(edgeCacheKeyUrl("https://x.test/p?page=2&utm_source=news")).toBe(
      "https://x.test/p?page=2",
    );
    // Same params in either order resolve to the same entry.
    expect(edgeCacheKeyUrl("https://x.test/p?b=2&a=1")).toBe(
      edgeCacheKeyUrl("https://x.test/p?a=1&b=2"),
    );
  });

  it("leaves a bare URL untouched", () => {
    expect(edgeCacheKeyUrl("https://x.test/p")).toBe("https://x.test/p");
  });
});

describe("isEditRequest", () => {
  const withCookie = (cookie: string) => new Request("https://x.test/", { headers: { cookie } });

  it("detects the edit cookie, alone or among others", () => {
    expect(isEditRequest(withCookie(`${LOUISE_EDIT_COOKIE}=1`))).toBe(true);
    expect(isEditRequest(withCookie(`session=abc; ${LOUISE_EDIT_COOKIE}=1`))).toBe(true);
    expect(isEditRequest(withCookie(`${LOUISE_EDIT_COOKIE}=1; session=abc`))).toBe(true);
  });

  it("is false with no cookie header at all", () => {
    expect(isEditRequest(new Request("https://x.test/"))).toBe(false);
    expect(isEditRequest(withCookie("session=abc"))).toBe(false);
  });

  it("matches at a name boundary, so a suffixed cookie can't false-positive", () => {
    // `x_louise_edit=1` matching would bypass the cache for every request that
    // carried it — a permanent, silent cache miss nobody would think to look for.
    expect(isEditRequest(withCookie(`x_${LOUISE_EDIT_COOKIE}=1`))).toBe(false);
    expect(isEditRequest(withCookie(`not${LOUISE_EDIT_COOKIE}=1`))).toBe(false);
  });

  it("honours a custom cookie name", () => {
    expect(isEditRequest(withCookie("edit_mode=1"), "edit_mode")).toBe(true);
    expect(isEditRequest(withCookie(`${LOUISE_EDIT_COOKIE}=1`), "edit_mode")).toBe(false);
  });

  it("keeps an editor off an entry a public visitor cached", async () => {
    // The headline invariant, now expressed through the shipped predicate rather
    // than a test-local one.
    const cache = fakeCache();
    let renders = 0;
    const handler = () => {
      renders++;
      return new Response("page", {
        headers: { "Cloudflare-CDN-Cache-Control": "public, max-age=60" },
      });
    };
    const wrapped = withEdgeCache(handler, { bypass: isEditRequest, cache: () => cache.cache });

    const ctx = { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext;
    await wrapped(new Request("https://x.test/"), {}, ctx);
    await wrapped(new Request("https://x.test/"), {}, ctx);
    expect(renders).toBe(1); // second public request served from cache

    await wrapped(withCookie(`${LOUISE_EDIT_COOKIE}=1`), {}, ctx);
    expect(renders).toBe(2); // the editor rendered fresh, not served the entry
  });
});
