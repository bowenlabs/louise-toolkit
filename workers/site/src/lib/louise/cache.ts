// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Edge-cache policy for published Louise pages (#95). ONE source of truth for the
// cache TTLs + tags, shared by the page renders (`Astro.cache.set`) and the
// publish pipeline's invalidation (`cache.purge`) so the two can't drift.
//
// Mechanism: the @astrojs/cloudflare `cacheCloudflare()` provider (wired in
// astro.config.mjs) turns `Astro.cache` options into `Cloudflare-CDN-Cache-Control`
// + `Cache-Tag` response headers, so Cloudflare's edge caches the published
// render. An edit-mode render calls `Astro.cache.set(false)` → the adapter emits
// `no-store`, so an editor (and any draft content) is never cached, and the edit
// cookie never busts a shared cache entry. On publish, `invalidatePageCache`
// purges the page's tag for an instant update; the short `maxAge` bounds
// staleness if tag-purge isn't available on the plan (`swr` then serves stale
// while it revalidates, so origin load stays low).

/** Fresh window (seconds) before the edge revalidates. Kept short so a publish
 *  is visible fast even without tag-purge; pairs with {@link PAGE_CACHE_SWR}. */
export const PAGE_CACHE_MAX_AGE = 60;
/** Stale-while-revalidate window (seconds) — serve stale + refresh in the
 *  background past `maxAge`, so a cold render is rare. */
export const PAGE_CACHE_SWR = 86_400; // 1 day

/** Per-page cache tag — lets a publish purge exactly this page's edge-cached
 *  render. Matches the tag the render stamps via {@link publishedPageCache}. */
export function pageCacheTag(id: number): string {
  return `page:${id}`;
}

/** Collection-wide tag every published page carries — a blunt "purge all pages"
 *  lever for a global change (e.g. a shared nav/settings edit). */
export const PAGES_CACHE_TAG = "pages";

/** Cache options for a published page render, for `Astro.cache.set(...)`. Tags
 *  the response with its per-page + collection tags so a publish invalidates it. */
export function publishedPageCache(id: number): { maxAge: number; swr: number; tags: string[] } {
  return {
    maxAge: PAGE_CACHE_MAX_AGE,
    swr: PAGE_CACHE_SWR,
    tags: [pageCacheTag(id), PAGES_CACHE_TAG],
  };
}

/** The Cloudflare Workers cache-purge surface — `cache.purge` on
 *  `cloudflare:workers`, enabled by wrangler `cache.enabled` + the adapter's
 *  cache provider. Typed loosely (and accessed via optional chaining) so a
 *  runtime without it degrades to TTL-only freshness rather than throwing. */
type CachePurger = { purge?: (opts: { tags: string[] }) => Promise<unknown> };

/**
 * Best-effort: purge a page's edge-cached render by tag after a publish (or
 * unpublish), for an instant update. No-ops — and never throws — when the Worker
 * cache API isn't available, so it can't fail the publish pipeline; the short
 * `maxAge` is the freshness floor if the purge doesn't land.
 */
export async function invalidatePageCache(id: number): Promise<void> {
  try {
    const mod = (await import("cloudflare:workers")) as unknown as { cache?: CachePurger };
    await mod.cache?.purge?.({ tags: [pageCacheTag(id)] });
  } catch (err) {
    console.error("[louise] cache purge failed", err);
  }
}
