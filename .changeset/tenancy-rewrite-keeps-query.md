---
"astroidjs": patch
---

**The host rewrite no longer drops the query string.**

The generated rewrite built its target from `context.url.pathname` alone, so
every search param was discarded on a tenant or app host. `?page=2`, `?sort=`,
a campaign tag, `?qr=1` — all silently gone, while the same page on the apex
path form kept them. Nothing errors; the page just renders as though nobody
asked for anything.

It bites hardest on an app host running a routed island. Typed search params
are the reason to reach for a router in an admin UI at all — filter, sort and
pagination live in the URL — and on a full page load or a shared deep link
they were being stripped before the app ever saw them.

Both branches now carry `context.url.search`. A rewrite chooses which *page*
renders; it does not get to edit what was asked of it.

Found on themidwestartist.com while wiring QR attribution, where `?qr=1`
reached the apex form and never the storefront's own host.
