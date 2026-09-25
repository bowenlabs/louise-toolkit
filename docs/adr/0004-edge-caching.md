# ADR 0004: Edge caching published pages through a cookie-aware Worker Cache API layer

- **Status:** Accepted (2026-07-17). The mechanism ships behind `LOUISE_EDGE_CACHE` (default **false**). It's been on for the reference site since 2026-07-18; see the amendment.
- **Deciders:** Baylee (solo maintainer)
- **Issue:** #95 (in the Platform features push milestone, epic #102)
- **Related:** #163 (root-cause issue, closed), #73 (edit-chrome Server Island), #88 (publish Workflow purge), #69 (D1 Sessions read-your-writes)

## Context

Published CMS pages are server-rendered against D1 on every request. The goal is to serve anonymous visitors fast from cache, while an **editor must never be served a cached page** (they need their draft and the inline-edit hooks), and a cached page must never carry editor or draft state.

This has been attempted and **reverted twice**:

- **#160/#161** shipped `Astro.cache.set(...)` and the `cacheCloudflare()` provider (which emits `Cloudflare-CDN-Cache-Control`) and enabled it, with a zone **Cache Rule** "bypass when the `louise_edit` cookie is present."
- **#162 reverted activation.** Proven live (2026-07-16): an anonymous request cached the page, and a `louise_edit=1` request was then served that cached page. `cf-cache-status` never showed `BYPASS`.
- **Root cause (#163):** `Cloudflare-CDN-Cache-Control` drives Cloudflare's **automatic** edge cache, which is keyed by URL and runs **before** the Worker, so it's **cookie-blind**. `Astro.cache.set(false)` only runs on a cache _miss_ (when the route executes). Once a URL is cached, the edge serves it straight to an editor without the Worker ever running. A zone Cache Rule doesn't govern the CDN-Cache-Control cache layer.
- **#164** replaced the mechanism with `withEdgeCache` (a Worker Cache API layer), merged with the flag off, and **#165 reverted it** after activation. Production caching persisted through Cloudflare **Dev Mode** and **Purge Everything** (neither reaches a Worker's `caches.default`), and editor bypass didn't hold in ways the unit tests didn't model. Conclusion: re-approach on a **preview deploy** with real hit/miss and editor observation before prod.

## Decision

Cache in the **Worker-controlled Cache API (`caches.default`)**, not Cloudflare's automatic edge cache. The Worker runs on **every** request, so it inspects the request _first_ and is the only thing that decides cacheability. That makes the cache **cookie-aware by construction**.

`withEdgeCache` (`louise-toolkit/worker`) wraps the Astro SSR fallback:

- **Public GET** → read and write `caches.default`, keyed by a **normalized cookieless URL** so every anonymous visitor shares one entry.
- **Editor request** (`louise_edit` cookie, through the `bypass: isEditRequest` predicate) → skip the cache entirely (read _and_ write) and always render fresh.
- A response is stored only when it carries a cacheable `Cloudflare-CDN-Cache-Control` directive, that is, a route that opted in through `Astro.cache.set(publishedPageCache())`. Edit-mode renders call `Astro.cache.set(false)` → `no-store` → never stored.

Two invariants keep `caches.default` the **only** cache that ever holds a page, so it can't be served cookie-blind to an editor. Both were the #163/#165 failure mode:

1. **Strip `Cloudflare-CDN-Cache-Control` from every response**, so Cloudflare's automatic cookie-blind edge cache never engages.
2. **Send the client `Cache-Control: no-store`** for any page this layer caches (the stored copy keeps the real directive for its `caches.default` TTL). That way no browser, Cloudflare edge, proxy, or leftover "Cache Everything" Cache Rule can shared-cache the HTML, and a browser can't serve its cached _public_ copy after the visitor enters edit mode. Assets (no CDN directive) and edit-mode renders keep their own `Cache-Control` untouched.

**Invalidation** is a best-effort `caches.default.delete(url)` on publish (the `invalidate-cache` step of the #88 Workflow). `caches.default` is **per-colo**, so a delete only clears the data center it runs in. The short `PAGE_CACHE_MAX_AGE` (60 seconds) is the real global freshness floor. There's no cross-colo tag purge for `caches.default`. That's an accepted trade for a cache that's cookie-aware and Worker-controlled.

The mechanism ships **behind `LOUISE_EDGE_CACHE` (default false)**. With the flag off, every render is `Astro.cache.set(false)` ⇒ `no-store` ⇒ `withEdgeCache` caches nothing and is a transparent pass-through. Merging is a runtime no-op.

## Consequences

- Anonymous published pages can be served from `caches.default` without a D1 round trip, and editors always render fresh. Correctness (never leak drafts, editors never stale) takes priority over a true edge short-circuit (the Worker still runs for each request).
- **The bypass correctness is unit-testable** (the Worker always runs, and `bypass` is an in-code branch). See `test/core/edge-cache.test.ts`, including _"an editor is never served an entry a public visitor cached."_
- The flag-on **Worker-cache logic** was also verified against **real workerd `caches.default`** (Miniflare). An anonymous GET stores and the second one is served from cache, an editor cookie bypasses, the wire is `no-store`, and the `sealed()` reconstruct correctly rewrites the _immutable_ headers from `cache.match` (which the fake-cache unit tests can't exercise). Astro's `cacheCloudflare()` provider was confirmed to emit `public, max-age=<n>` (matches `isCacheableDirective`). So the Worker layer is proven. **What remains gated on a preview deploy is only the Cloudflare _edge_ layer** (the automatic cache and Cache Rules), which Miniflare doesn't model. That's exactly what the previous attempt (with passing unit tests) got wrong in prod (#165).
- Browser HTML caching of published pages is given up (the wire says `no-store`). Repeat views are served from `caches.default` instead.

## Activation runbook: verify on a preview deploy before flipping the flag

> The mechanism is inert until `LOUISE_EDGE_CACHE=true`. Do **not** enable it on prod first. Dev Mode and "Purge Everything" don't clear `caches.default`, so a mistake is hard to walk back (#165).

1. **Delete any leftover zone Cache Rules** from the #160–#163 experiments (especially anything "Cache Everything" or the `louise_edit` bypass rule). They're no longer needed, and a "Cache Everything" rule can shared-cache HTML cookie-blind, which defeats the Worker layer.
2. Deploy this branch to a **preview** with `LOUISE_EDGE_CACHE=true`.
3. **Anonymous:** run `curl -sI https://<preview>/` twice.
   - First: `cf-cache-status: MISS` (or absent) → second: served fast. The response is `cache-control: no-store` and has **no** `cloudflare-cdn-cache-control` header.
   - Confirm that the Worker cache serves the second hit (add a temporary `x-louise-cache: hit|miss` debug header if needed).
4. **Editor:** with a valid session, run `curl -sI -H 'cookie: louise_edit=1; <session>' https://<preview>/`.
   - Every request renders **fresh** (the draft body and inline-edit hooks are present), regardless of what anonymous requests cached. It's never served the anonymous entry.
5. **Edit-mode transition:** as an editor, load `/` (anonymous first in the same browser, then enter edit mode). Confirm that the browser does **not** serve its cached public copy (the `no-store` wire header prevents this).
6. **Publish invalidation:** edit and publish a page. Confirm that the public render updates within `PAGE_CACHE_MAX_AGE` (60 seconds) globally, and sooner in the publishing colo.
7. Only after steps 3–6 pass on preview: set `LOUISE_EDGE_CACHE=true` in the prod `wrangler.jsonc` and redeploy.

If any step fails, leave `LOUISE_EDGE_CACHE=false` (the proven-safe `no-store` state) and reopen the investigation on the preview, not prod.

## Amendment (2026-09-24): enabled on the reference site

`LOUISE_EDGE_CACHE` has been `"true"` in `workers/site/wrangler.jsonc` since #184
(2026-07-18), after the runbook passed. The library default stays **false**, so
every other site still opts in through the same runbook.

- **Rollback:** set `LOUISE_EDGE_CACHE` back to `"false"` (or comment the line out)
  and redeploy. That returns the site to the proven `no-store` state. Pages already
  in `caches.default` age out within `PAGE_CACHE_MAX_AGE`, because neither Dev Mode
  nor Purge Everything clears that cache.
- **What to watch for:** an editor served a public or stale page. That's the
  failure both earlier attempts hit (#162, #165).
- **For other code:** `isEditRequest` and `LOUISE_EDIT_COOKIE` are exported from
  `louise-toolkit/worker`, so a site's bypass predicate and the middleware read one
  cookie name and can't drift apart.
