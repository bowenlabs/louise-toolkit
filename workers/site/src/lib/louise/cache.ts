// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Edge-cache policy for published Louise pages (#95, #163). The mechanism is the
// cookie-aware Worker Cache API layer (`withEdgeCache`, louise-toolkit/worker),
// wired over the Astro SSR fallback in worker.ts — NOT Cloudflare's automatic
// `Cloudflare-CDN-Cache-Control` edge cache (that one is cookie-blind and would
// serve a cached public page to an editor; see #163).
//
// A route opts a published render in with `Astro.cache.set(publishedPageCache())`
// (the provider emits `Cloudflare-CDN-Cache-Control`, which `withEdgeCache` reads
// as its cache signal, then strips); an edit-mode render calls
// `Astro.cache.set(false)`. `isEditRequest` is the bypass predicate that keeps
// editor requests off the shared cache entirely.

import { EDIT_COOKIE } from "./session.js";

/** Fresh window (seconds) for a cached published page. Kept short because
 *  `caches.default` has no global tag-purge — this maxAge is the freshness floor
 *  (a publish is visible everywhere within it); see {@link invalidatePageCache}. */
export const PAGE_CACHE_MAX_AGE = 60;

/** Cache options for a published page render, for `Astro.cache.set(...)`. The
 *  `withEdgeCache` layer reads the resulting `Cloudflare-CDN-Cache-Control` as
 *  its "cache me" signal and stores the render in the Worker cache. */
export function publishedPageCache(): { maxAge: number } {
  return { maxAge: PAGE_CACHE_MAX_AGE };
}

/**
 * Is this a Louise edit-mode request? Detected by the `louise_edit` cookie
 * (set by the middleware when entering edit mode). Used as the `withEdgeCache`
 * bypass predicate so an editor is never served — or storing into — the shared
 * public cache entry; they always get a fresh, personalized render.
 */
export function isEditRequest(request: Request): boolean {
  const cookie = request.headers.get("cookie");
  // Match the cookie by name at a boundary so `x_louise_edit` can't false-match.
  return cookie !== null && new RegExp(`(?:^|;\\s*)${EDIT_COOKIE}=`).test(cookie);
}

/** Map a page slug to its public URL. The home page (`home`) is the site root. */
function pageUrl(slug: string): string {
  return `https://louisetoolkit.com${slug === "home" ? "/" : `/${slug}`}`;
}

/**
 * Best-effort: drop a just-published page's cached render so the update shows
 * sooner. `caches.default` is per-colo, so `delete` only clears the data center
 * the publish Workflow runs in — the {@link PAGE_CACHE_MAX_AGE} TTL is the global
 * freshness floor. Never throws (a purge failure must not fail the pipeline).
 */
export async function invalidatePageCache(slug: string): Promise<void> {
  try {
    await caches.default.delete(new Request(pageUrl(slug), { method: "GET" }));
  } catch (err) {
    console.error("[louise] cache purge failed", err);
  }
}
