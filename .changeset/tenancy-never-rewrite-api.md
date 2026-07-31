---
"astroidjs": patch
---

**The host rewrite no longer swallows API routes.**

`tenancy`'s rewrite applied to every path, including `/api/*`. That is wrong in
a way that is very hard to see: an API route is addressed absolutely by
whatever calls it and reads the host from `locals.tenant`, so rewriting it
moves it somewhere no route matches — and on an **app host with a catch-all
page** (`tenancy.apps` + `[...path].astro`, i.e. exactly the studio shape
`mountStudio` encourages), the *page* answers instead. `fetch("/api/…")` then
returns HTML, or a redirect to a sign-in, and every data load on that host
fails silently while the identical code works on the apex.

Found in production on themidwestartist.com: the studio loaded at
`studio.example.com` and then fetched nothing, because `/api/louise/*` was
being rewritten into `/studio/api/louise/*` and answered by the studio's own
catch-all page.

`TenancyConfig.rewriteExclude` now defaults to `["/api"]`, checked before both
the app and tenant branches. Matching is segment-aware, so `/api` covers
`/api/x` but never `/apiary`. Set `[]` to restore the old behaviour, or add
prefixes for other host-agnostic surfaces (`/_actions`, `/webhooks`).

New pure export `isRewriteExcluded(pathname, exclude)` so a site can unit-test
its own list.
