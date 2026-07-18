# ADR 0004 — Edge caching published pages via a cookie-aware Worker Cache API layer

- **Status:** Accepted, gated off (2026-07-17) — the mechanism ships behind `LOUISE_EDGE_CACHE` (default **false**); flip on only after the preview-deploy runbook below passes.
- **Deciders:** Baylee (solo maintainer)
- **Issue:** #95 (milestone: Platform features push, epic #102)
- **Related:** #163 (root-cause issue, closed), #73 (edit-chrome Server Island), #88 (publish Workflow purge), #69 (D1 Sessions read-your-writes)

## Context

Published CMS pages are SSR'd against D1 on every request. We want anonymous visitors served fast from cache, while an **editor must never be served a cached page** (they need their draft + the inline-edit hooks) and a cached page must never carry editor/draft state.

This has been attempted and **reverted twice**:

- **#160/#161** shipped `Astro.cache.set(...)` + the `cacheCloudflare()` provider (emits `Cloudflare-CDN-Cache-Control`) and enabled it, with a zone **Cache Rule** "bypass when the `louise_edit` cookie is present."
- **#162 reverted activation.** Proven live (2026-07-16): an anonymous request cached the page; a `louise_edit=1` request was then served that cached page — `cf-cache-status` never showed `BYPASS`.
- **Root cause (#163):** `Cloudflare-CDN-Cache-Control` drives Cloudflare's **automatic** edge cache, which is keyed by URL and runs **before** the Worker — so it is **cookie-blind**. `Astro.cache.set(false)` only runs on a cache *miss* (when the route executes); once a URL is cached, an editor is served it straight from the edge without the Worker ever running. A zone Cache Rule does not govern the CDN-Cache-Control cache layer.
- **#164** replaced the mechanism with `withEdgeCache` (a Worker Cache API layer) — merged with the flag off — and **#165 reverted it** after activation: production caching persisted through Cloudflare **Dev Mode** and **Purge Everything** (neither reaches a Worker's `caches.default`), and editor-bypass didn't hold in ways the unit tests didn't model. Conclusion: re-approach on a **preview deploy** with real hit/miss + editor observation before prod.

## Decision

Cache in the **Worker-controlled Cache API (`caches.default`)**, not Cloudflare's automatic edge cache. The Worker runs on **every** request, so it inspects the request *first* and is the only thing that decides cacheability — making the cache **cookie-aware by construction**.

`withEdgeCache` (`louise-toolkit/worker`) wraps the Astro SSR fallback:

- **Public GET** → read/write `caches.default`, keyed by a **normalized cookieless URL** so every anonymous visitor shares one entry.
- **Editor request** (`louise_edit` cookie, via the `bypass: isEditRequest` predicate) → skip the cache entirely (read *and* write); always render fresh.
- A response is stored only when it carries a cacheable `Cloudflare-CDN-Cache-Control` directive — i.e. a route that opted in via `Astro.cache.set(publishedPageCache())`. Edit-mode renders call `Astro.cache.set(false)` → `no-store` → never stored.

Two invariants keep `caches.default` the **only** cache that ever holds a page (so it can't be served cookie-blind to an editor) — both were the #163/#165 failure mode:

1. **Strip `Cloudflare-CDN-Cache-Control` from every response**, so Cloudflare's automatic cookie-blind edge cache never engages.
2. **Send the client `Cache-Control: no-store`** for any page this layer caches (the stored copy keeps the real directive for its `caches.default` TTL). So no browser, CF edge, proxy, or leftover "Cache Everything" Cache Rule can shared-cache the HTML — and a browser can't serve its cached *public* copy after the visitor enters edit mode. Assets (no CDN directive) and edit-mode renders keep their own `Cache-Control` untouched.

**Invalidation** is best-effort `caches.default.delete(url)` on publish (the #88 Workflow's `invalidate-cache` step). `caches.default` is **per-colo**, so a delete only clears the data center it runs in; the short `PAGE_CACHE_MAX_AGE` (60s) is the real global freshness floor. There is no cross-colo tag-purge for `caches.default` — this is an accepted trade for a cache that is cookie-aware and Worker-controlled.

The mechanism ships **behind `LOUISE_EDGE_CACHE` (default false)**. Flag off ⇒ every render is `Astro.cache.set(false)` ⇒ `no-store` ⇒ `withEdgeCache` caches nothing and is a transparent pass-through — merging is a runtime no-op.

## Consequences

- Anonymous published pages can be served from `caches.default` without a D1 round-trip; editors always render fresh. Correctness (never leak drafts, editors never stale) is prioritized over a true edge short-circuit (the Worker still runs per request).
- **The bypass correctness is unit-testable** (the Worker always runs; `bypass` is an in-code branch) — see `test/core/edge-cache.test.ts`, incl. *"an editor is never served an entry a public visitor cached."*
- The flag-on **Worker-cache logic** was additionally verified against **real workerd `caches.default`** (Miniflare): anon GET stores + the 2nd is served from cache, an editor cookie bypasses, the wire is `no-store`, and the `sealed()` reconstruct correctly rewrites `cache.match`'s *immutable* headers (which the fake-cache unit tests can't exercise). Astro's `cacheCloudflare()` provider was confirmed to emit `public, max-age=<n>` (matches `isCacheableDirective`). So the Worker layer is proven; **what remains gated on a preview deploy is only the Cloudflare *edge* layer** (the automatic cache / Cache Rules), which Miniflare doesn't model — and which is exactly what the previous attempt (passing unit tests) got wrong in prod (#165).
- Browser HTML caching of published pages is given up (wire `no-store`); repeat views are served from `caches.default` instead.

## Activation runbook — verify on a preview deploy before flipping the flag

> The mechanism is inert until `LOUISE_EDGE_CACHE=true`. Do **not** enable on prod first — `caches.default` is not cleared by Dev Mode or "Purge Everything," so a mistake is hard to walk back (#165).

1. **Delete any leftover zone Cache Rules** from the #160–#163 experiments (esp. anything "Cache Everything" or the `louise_edit` bypass rule). They are no longer needed and a "Cache Everything" rule can shared-cache HTML cookie-blind, defeating the Worker layer.
2. Deploy this branch to a **preview** with `LOUISE_EDGE_CACHE=true`.
3. **Anonymous** — `curl -sI https://<preview>/` twice:
   - First: `cf-cache-status: MISS` (or absent) → second: served fast; response is `cache-control: no-store` and has **no** `cloudflare-cdn-cache-control` header.
   - Confirm the Worker cache is serving the 2nd hit (add a temporary `x-louise-cache: hit|miss` debug header if needed).
4. **Editor** — with a valid session, `curl -sI -H 'cookie: louise_edit=1; <session>' https://<preview>/`:
   - Every request renders **fresh** (the draft body + inline-edit hooks present), regardless of what anonymous requests cached. Never served the anonymous entry.
5. **Edit-mode transition** — as an editor, load `/` (anonymous first in the same browser, then enter edit mode): confirm the browser does **not** serve its cached public copy (the `no-store` wire header prevents this).
6. **Publish invalidation** — edit + publish a page; confirm the public render updates within `PAGE_CACHE_MAX_AGE` (60s) globally, sooner in the publishing colo.
7. Only after 3–6 pass on preview: set `LOUISE_EDGE_CACHE=true` in prod `wrangler.jsonc` and redeploy.

If any step fails, leave `LOUISE_EDGE_CACHE=false` — the proven-safe `no-store` state — and reopen the investigation on the preview, not prod.
