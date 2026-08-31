// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/worker — a cookie-aware edge cache for the SSR fallback (#163).
//
// Why not just `Cloudflare-CDN-Cache-Control`? That header drives Cloudflare's
// AUTOMATIC edge cache, which is keyed by URL and runs BEFORE the Worker — so it
// is blind to cookies. A page cached for an anonymous visitor is then served to
// a logged-in editor straight from the edge, without the Worker (or the route's
// own "don't cache this" decision) ever running. There is no way to make that
// automatic cache cookie-aware from inside a Worker.
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
// The route still decides cacheability however its framework expresses that; the
// decision reaches this layer as a response header, which the wrapper consumes as
// the "cache me" signal rather than letting Cloudflare act on it.

/** Default cacheability-signal header: Cloudflare's own CDN-Cache-Control, which
 *  is what a Cloudflare-targeting SSR adapter emits for a cacheable response.
 *  Consumed here as the route's signal, then stripped so Cloudflare's automatic
 *  (cookie-blind) edge cache never sees it. Override with
 *  {@link EdgeCacheConfig.signalHeader} when a host signals some other way. */
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
  /**
   * The response header carrying the route's cacheability decision. Defaults to
   * {@link CDN_CACHE_CONTROL}.
   *
   * Configurable rather than hard-coded because WHICH header a route uses to say
   * "cache me" is the host's convention, not this layer's: a Cloudflare-targeting
   * SSR adapter emits `Cloudflare-CDN-Cache-Control`, and a host that signals
   * differently should not have to adopt that name to use this cache.
   */
  signalHeader?: string;
}

/**
 * Wrap an SSR `fetch` handler with the cookie-aware Worker Cache API layer
 * described above. Public GETs are served from / stored in the cache keyed by
 * URL; bypassed requests and non-GETs always run `handler`. A response is stored
 * only when it carries a cacheable directive in the signal header (see
 * {@link EdgeCacheConfig.signalHeader}); that header is always stripped from the
 * returned response.
 *
 * Freshness is bounded by the directive's `max-age` (there is no global
 * tag-purge for `caches.default` — a purge only reaches the current colo, so a
 * short `max-age` is the real freshness floor). Drop-in for `composeWorker`'s
 * `fetch`.
 */
/** Query params that identify a campaign or ad click rather than the content.
 *  Deliberately conservative — only params with no content meaning anywhere. */
const TRACKING_PARAM =
  /^(?:utm_[a-z_]+|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|ttclid|twclid|yclid|_gl)$/i;

/**
 * The URL a response is stored under: the request URL with tracking params
 * removed and the survivors sorted. Without this every `?utm_source=…` variant
 * of a shared link mints its own entry, so campaign traffic — exactly the burst
 * a cache is meant to absorb — would miss on almost every request. Only the
 * *key* is normalized; the handler still receives the untouched request, so a
 * page that reads its own query string is unaffected.
 */
export function edgeCacheKeyUrl(url: string): string {
  const u = new URL(url);
  if (!u.search) return u.toString();
  const kept = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);
  return u.toString();
}

/**
 * The default edit-mode cookie name — the one `createLouiseMiddleware` sets when
 * a visitor enters edit mode.
 *
 * Exported so the cookie and the predicate that looks for it are declared in one
 * place. Anything writing its own `"louise_edit"` literal would keep
 * working right up until the middleware default moved, and then fail by serving
 * an editor a cached public page — which is the exact bug this whole layer
 * exists to prevent, and the one that is hardest to notice.
 */
export const LOUISE_EDIT_COOKIE = "louise_edit";

/**
 * Is this an edit-mode request? Detected by the edit cookie.
 *
 * Intended as the {@link EdgeCacheConfig.bypass} predicate, so an editor is
 * never served — nor stores into — the shared public cache entry, and always
 * gets a fresh personalized render.
 *
 * Pass `cookieName` when the middleware was configured with a custom
 * `editCookie`; the two must agree or the bypass silently stops bypassing.
 */
export function isEditRequest(request: Request, cookieName = LOUISE_EDIT_COOKIE): boolean {
  const cookie = request.headers.get("cookie");
  if (cookie === null) return false;
  // Matched at a name boundary so `x_louise_edit=…` can't false-positive into a
  // permanent cache bypass.
  return new RegExp(`(?:^|;\\s*)${cookieName}=`).test(cookie);
}

export function withEdgeCache<Env = unknown>(
  handler: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>,
  config: EdgeCacheConfig = {},
): (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> {
  // `caches.default` is Cloudflare's per-Worker cache. The tsconfig `lib`
  // includes DOM (whose `CacheStorage` has no `default`), and that wins the
  // global merge over @cloudflare/workers-types', so reach it through a cast —
  // same lib.dom clash the site's env.d.ts re-declares around.
  const getCache = config.cache ?? (() => (caches as unknown as { default: Cache }).default);
  // Lower-cased once: `Headers` lookups are case-insensitive, but `sealed()` below
  // is a free function and takes the resolved name rather than re-deriving it.
  const signal = (config.signalHeader ?? CDN_CACHE_CONTROL).toLowerCase();

  return async (request, env, ctx) => {
    const useCache = request.method === "GET" && !(config.bypass?.(request) ?? false);
    // Normalize the key to a bare GET on the URL — independent of the incoming
    // request's cookies/headers, and with tracking params stripped — so every
    // public visitor shares one entry however they arrived at the link.
    const key = useCache ? new Request(edgeCacheKeyUrl(request.url), { method: "GET" }) : undefined;
    const cache = getCache();

    if (key) {
      const hit = await cache.match(key);
      // Serve the stored render, but re-assert the wire headers (a `cache.match`
      // response has immutable headers, so reconstruct): this Worker cache is the
      // ONLY shared cache, so the HTML goes out `no-store` — see the store path.
      if (hit) return sealed(hit, signal);
    }

    const response = await handler(request, env, ctx);
    const directive = response.headers.get(signal);

    // Strip the signal on EVERY response so Cloudflare's automatic, cookie-blind
    // edge cache never engages — this Worker cache is cookie-aware and the only
    // cache in play.
    if (directive !== null) response.headers.delete(signal);

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
      // the route's own cache decision — assets and edit-mode renders keep their
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
function sealed(hit: Response, signalHeader: string): Response {
  const out = new Response(hit.body, hit);
  out.headers.set("cache-control", "no-store");
  out.headers.delete(signalHeader);
  return out;
}
