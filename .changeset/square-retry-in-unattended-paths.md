---
"astroidjs": patch
---

**The scaffolded queue consumer now says to turn Square's retry on.** `SquareConfig.retry`
has existed since the multi-location wave, off by default so an attended checkout route
keeps failing fast — a customer watching a spinner is better served by an error than by
three silent backoffs. The queue consumer is the exact inverse: nobody is watching, and a
rate-limited catalog push that gives up halfway leaves the site serving a half-applied
catalog.

That distinction lived only in a source comment on the library side, so the one place it
actually matters — the `refreshCatalog` seam a project fills in — never mentioned it. The
scaffolded `src/queue.ts` now does, with the Square-specific form when Square is the
storefront provider and a generic note otherwise.

Comment-only in generated output; no behaviour change to existing projects.
