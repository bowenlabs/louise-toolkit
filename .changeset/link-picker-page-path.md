---
"louise-toolkit": minor
---

**The link picker can map a page slug to its real path, and dedupes by path.**

The picker turned every `pages` row into `/${slug}`, which is wrong for exactly
one row on most sites: the one served at `/`. Coracle's `home` row produced a
second "Home" entry pointing at `/home` — a duplicate-content alias offered to
editors as if it were a page (found in the #348 live QA).

`mountSections` accepts `pagePathForSlug?: (slug: string) => string` and the
picker's choice list now dedupes by path, built-ins first — so a DB row mapped
onto a built-in's path collapses into the hand-authored entry rather than
appearing twice.
