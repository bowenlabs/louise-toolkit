---
"astroidjs": patch
---

fix(worker): the generated media route never matched, 404-ing every uploaded asset

`mediaAssetRoute` guarded with `url.pathname.startsWith(\`${MEDIA_BASE}/\`)` —
a pathname compared against an origin, which is false for every request that
can exist. The route therefore never ran on any generated site: requests to the
media host fell through to the SSR handler and every uploaded image, on every
page, answered with the site's own 404 page.

The guard now matches `url.origin` against `MEDIA_BASE` and takes the whole
pathname as the R2 key. Sites pick this up by regenerating (any `astroid dev` /
build) — no config or content change.
