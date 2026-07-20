---
"astroidjs": minor
"create-astroid": minor
"louise-toolkit": minor
---

Wire edge caching for published pages — shipped wrapped, and shipped off.

The generated worker now wraps Astro's SSR fallback in `withEdgeCache`, Louise's cookie-aware Worker Cache API layer (ADR 0004), with `bypass: isEditRequest`. The scaffold gets the `cacheCloudflare()` provider, a page-level opt-in on the home route, and an `ASTROID_EDGE_CACHE` var that defaults to `"false"`.

**The default is the safe state, not merely the off state.** With the var off every render calls `Astro.cache.set(false)` → `no-store` → `withEdgeCache` stores nothing and is a transparent pass-through. Wrapping unconditionally is therefore inert; the wrap only becomes live when a page emits a cacheable directive, which requires both the var *and* a request that isn't in edit mode.

Why this layer rather than Cloudflare's automatic edge cache: the automatic one is keyed by URL and runs **before** the Worker, so it cannot see the edit cookie and will serve a cached public page — drafts and inline-edit hooks and all — to a signed-in editor. `withEdgeCache` runs inside the Worker, decides cacheability after inspecting the request, and strips the CDN directive from every response so the automatic cache never engages. That distinction is what got this feature reverted twice, and it is why activation stays gated on the preview-deploy runbook in `docs/adr/0004-edge-caching.md`: `caches.default` is not cleared by Cloudflare Dev Mode or "Purge Everything", so a bad production flip is hard to walk back.

**`louise-toolkit` gains `isEditRequest` and `LOUISE_EDIT_COOKIE`** (from `louise-toolkit/worker`). The edit-cookie predicate was hand-rolled in the reference site, and Astroid would have hand-rolled it a second time — against a cookie name that lives as a default inside `createLouiseMiddleware`. Now the middleware that *sets* the cookie and the predicate that *looks for* it read one constant, so they cannot drift. Drift there is not a cosmetic bug: it means an editor served a cached public page, which is precisely the failure this layer exists to prevent and the hardest one to notice. The predicate matches at a cookie-name boundary, so `x_louise_edit=1` can't false-positive into a permanent cache bypass.
