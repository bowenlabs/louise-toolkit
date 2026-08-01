---
"louise-toolkit": patch
---

fourthwall: `getCollectionProducts` reads every page, not just the first

The Storefront API paginates its list endpoints — `page` (0-indexed) and `size`,
answering `{ results, paging: { hasNextPage } }`. This client sent neither
parameter, and its `unwrap` helper kept `results` and discarded everything
around it, `paging.hasNextPage` included. So a catalog read was one page of an
**undocumented default size**, handed back as though it were the whole
collection.

Nothing about that is visible from the outside. Products past the first page do
not error, they simply never appear, and a consumer mirroring the catalog just
ends up with a smaller shop. It also gets worse precisely as a store sells more,
so it looks like it works right up until it matters — a real store was two
uploads away from silently losing products.

`getCollectionProducts` now walks `page=0` upward with an explicit `size=50`
(Fourthwall's own documented example) until `hasNextPage` stops being true. The
signature is unchanged, so every caller — `listCatalog` included — gets the whole
collection without touching anything.

Two deliberate refusals:

- It **throws** at a 200-page backstop rather than returning what it has. A
  truncated catalog is worse than a failed call for the thing this feeds: a
  caller reconciling its mirror against "everything Fourthwall has" will drop or
  unpublish whatever it did not see. Failing loudly keeps a partial read away
  from that decision.
- A **bare-array** response is still treated as the only page, exactly as
  `unwrap` has always tolerated it. Assuming the documented envelope would read a
  bare array as an *empty* catalog — a far worse failure than the truncation this
  fixes, and the same reconciling caller would act on it.

Anything other than an explicit `hasNextPage: true` ends the walk, so a
malformed or absent envelope stops rather than loops.

Not verified against a live store: the fix follows Fourthwall's published
pagination contract and is covered by tests against that shape. If an endpoint
turns out not to send `paging` at all, the walk reads page 0 and stops — the
previous behaviour exactly, so there is no regression either way.
