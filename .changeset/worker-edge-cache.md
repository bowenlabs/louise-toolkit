---
"louise-toolkit": minor
---

Add `withEdgeCache` + `isCacheableDirective` to `louise-toolkit/worker` — a **cookie-aware Worker Cache API layer** for the SSR fallback (#95/#163), so published pages can edge-cache while editor requests always render fresh.

Because `Cloudflare-CDN-Cache-Control` drives Cloudflare's *automatic* edge cache — which is keyed by URL and runs before the Worker, so it's cookie-blind — a page cached for an anonymous visitor was served to a logged-in editor (the #163/#165 reverts). `withEdgeCache` caches in `caches.default` instead: the Worker runs on every request, reads/writes the cache only for non-bypassed public GETs, and keeps two invariants so `caches.default` is the *only* cache that ever holds a page:

- strips `Cloudflare-CDN-Cache-Control` from every response (CF's cookie-blind auto edge cache never engages);
- sends the client `Cache-Control: no-store` for any page it caches (the stored copy keeps the directive for its TTL), so no browser, CF edge, proxy, or leftover "Cache Everything" Cache Rule can shared-cache the HTML cookie-blind — and a browser can't serve a cached public copy after the visitor enters edit mode.

Editor requests are excluded by construction via a `bypass` predicate. A host wires it as `composeWorker`'s `fetch` (`withEdgeCache(handle, { bypass: isEditRequest })`) and opts renders in per-route with `Astro.cache.set(...)`. See ADR 0004 for the activation runbook — the mechanism ships gated off until verified on a preview deploy.
