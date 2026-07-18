// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/worker — a cookie-aware edge cache for the SSR fallback (#163).
//
// Why not just `Cloudflare-CDN-Cache-Control`? That header drives Cloudflare's
// AUTOMATIC edge cache, which is keyed by URL and runs BEFORE the Worker — so it
// is blind to cookies. A page cached for an anonymous visitor is then served to
// a logged-in editor straight from the edge, without the Worker (or Astro's
// `Astro.cache.set(false)`) ever running. There is no way to make that automatic
// cache cookie-aware from inside a Worker.
//
// So this wraps the SSR handler and caches in the Worker-controlled Cache API
// (`caches.default`) instead: the Worker runs on every request, inspects it, and
// only reads/writes the cache for non-bypassed (public) GETs. Bypassed (editor)
// requests always run the handler fresh. Two things keep `caches.default` the
// ONLY cache that ever holds a page (so it can't be served cookie-blind to an
// editor):
//   1. STRIP `Cloudflare-CDN-Cache-Control` from every response, so Cloudflare's
//      automatic (cookie-blind) edge cache never engages.
//   2. Send the client `Cache-Control: no-store` for any page this layer caches,
//      so no browser, CF edge, proxy, or leftover "Cache Everything" Cache Rule
//      shared-caches the HTML — and a browser can't serve its cached PUBLIC copy
//      after the visitor enters edit mode. The cache entry keeps its own TTL.
// Both were the failure mode behind the #163/#165 reverts (a shared cache served
// editors). Editor requests are excluded by construction (the `bypass` predicate).
//
// The route still decides cacheability the same way (`Astro.cache.set(...)` →
// the provider emits `Cloudflare-CDN-Cache-Control`); this wrapper just consumes
// that header as the "cache me" signal rather than letting Cloudflare act on it.

/** The response header the Astro Cloudflare cache provider emits from
 *  `Astro.cache.set(...)`. Consumed here as the route's cacheability signal, then
 *  stripped so Cloudflare's automatic (cookie-blind) edge cache never sees it. */
export const CDN_CACHE_CONTROL = "cloudflare-cdn-cache-control";

/**
 * Is `directive` an opt-in-to-cache Cache-Control value — `public`/unspecified
 * with a positive `max-age`, and not `no-store`/`no-cache`/`private`? The
 * provider emits `no-store` for any response a route didn't opt in (including
 * edit-mode `set(false)`), so this cleanly separates cacheable published renders
 * from everything else.
 */
export function isCacheableDirective(directive: string | null | undefined): boolean {
  if (!directive) return false;
  const d = directive.toLowerCase();
  if (d.includes("no-store") || d.includes("no-cache") || d.includes("private")) return false;
  const m = d.match(/max-age=(\d+)/);
  return m !== null && Number(m[1]) > 0;
}

export interface EdgeCacheConfig {
  /**
   * Return `true` to skip the cache (both read and write) for this request and
   * always run the handler — e.g. an authenticated editor whose render is
   * personalized. Its response is still stripped of the cache signal, so it can
   * never be edge-cached either.
   */
  bypass?: (request: Request) => boolean;
  /** The `Cache` to use. Defaults to `caches.default`. Injectable for tests. */
  cache?: () => Cache;
}

/**
 * Wrap an SSR `fetch` handler with the cookie-aware Worker Cache API layer
 * described above. Public GETs are served from / stored in the cache keyed by
 * URL; bypassed requests and non-GETs always run `handler`. A response is stored
 * only when it carries a cacheable {@link CDN_CACHE_CONTROL} directive; that
 * header is always stripped from the returned response.
 *
 * Freshness is bounded by the directive's `max-age` (there is no global
 * tag-purge for `caches.default` — a purge only reaches the current colo, so a
 * short `max-age` is the real freshness floor). Drop-in for `composeWorker`'s
 * `fetch`.
 */
export function withEdgeCache<Env = unknown>(
  handler: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>,
  config: EdgeCacheConfig = {},
): (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> {
  // `caches.default` is Cloudflare's per-Worker cache. The tsconfig `lib`
  // includes DOM (whose `CacheStorage` has no `default`), and that wins the
  // global merge over @cloudflare/workers-types', so reach it through a cast —
  // same lib.dom clash the site's env.d.ts re-declares around.
  const getCache = config.cache ?? (() => (caches as unknown as { default: Cache }).default);

  return async (request, env, ctx) => {
    const useCache = request.method === "GET" && !(config.bypass?.(request) ?? false);
    // Normalize the key to a bare GET on the URL — independent of the incoming
    // request's cookies/headers — so every public visitor shares one entry.
    const key = useCache ? new Request(request.url, { method: "GET" }) : undefined;
    const cache = getCache();

    if (key) {
      const hit = await cache.match(key);
      // Serve the stored render, but re-assert the wire headers (a `cache.match`
      // response has immutable headers, so reconstruct): this Worker cache is the
      // ONLY shared cache, so the HTML goes out `no-store` — see the store path.
      if (hit) return sealed(hit);
    }

    const response = await handler(request, env, ctx);
    const directive = response.headers.get(CDN_CACHE_CONTROL);

    // Strip the signal on EVERY response so Cloudflare's automatic, cookie-blind
    // edge cache never engages — this Worker cache is cookie-aware and the only
    // cache in play.
    if (directive !== null) response.headers.delete(CDN_CACHE_CONTROL);

    if (key && isCacheableDirective(directive)) {
      const toCache = response.clone();
      // caches.default honors standard Cache-Control for its TTL; mirror the CDN
      // directive onto the STORED copy. Drop Set-Cookie — cache.put rejects a
      // response that carries one, and a shared public page must not ship a
      // per-request cookie. (CDN signal already stripped above.)
      toCache.headers.set("cache-control", directive as string);
      toCache.headers.delete("set-cookie");
      ctx.waitUntil(cache.put(key, toCache));
      // …but send the client `no-store`. `caches.default` (cookie-aware, editor-
      // bypassing) is the only cache that should hold this HTML: no browser, CF
      // edge, proxy, or leftover "Cache Everything" Cache Rule may shared-cache it
      // cookie-blind (the #163/#165 failure mode). `no-store` on the wire also
      // avoids a browser serving its cached PUBLIC copy after the visitor enters
      // edit mode. Only reached for a route that opted a public render in via
      // `Astro.cache.set` — assets and edit-mode (`set(false)`) renders keep their
      // own Cache-Control untouched.
      response.headers.set("cache-control", "no-store");
    }
    return response;
  };
}

/**
 * Reconstruct a cached response for the wire: `cache.match` returns a response
 * with immutable headers, so copy it and force `Cache-Control: no-store` (the
 * cache entry's own TTL still governs eviction from `caches.default`). Keeps the
 * Worker cache the single source of the shared entry.
 */
function sealed(hit: Response): Response {
  const out = new Response(hit.body, hit);
  out.headers.set("cache-control", "no-store");
  out.headers.delete(CDN_CACHE_CONTROL);
  return out;
}
