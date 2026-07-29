---
"louise-toolkit": minor
---

**`readModifyWriteCatalog` — edit a catalog object without silently erasing it.**

Square documents this hazard verbatim: *"If a client reads an object at an older
API version and writes it back at a newer version, fields that were introduced
between those two versions will be absent from the request, and the server will
interpret that absence"* — as an intentional clear. `SQUARE_VERSION` was pinned,
but nothing enforced read/write symmetry at the call site and there was no helper,
so every consumer hand-rolled one and any of them could get it wrong.

The generalised form is worse than the version-skew case: *any* read-modify-write
that rebuilds the object from the fields it models erases whatever it doesn't.
`location_overrides` is the one that hurts, because per-location pricing is
invisible in a naive round trip and its loss looks like a pricing decision.

So the helper never rebuilds. It reads the raw object, hands *that object* to the
mutator, and writes back what it got — with the version from that read (a
concurrent write then makes yours fail rather than clobber) and the same pinned
`Square-Version` on both calls. `SquareCatalogObject` is deliberately an open type
with an index signature: a closed interface would invite exactly the
reconstruct-from-parts bug this exists to prevent.

**Two write-path guards**, folded in from the multi-location work:

- **A variation's locations must be a subset of its parent item's.** Square
  documents the rule and does not enforce it — violating it yields a silent
  partial state where the item renders at a location with no purchasable
  variation beneath it. Now a thrown `Error` before the request rather than a
  puzzle in production.
- **250 variations per item**, Square's cap and the first ceiling a
  per-merchant-variation design meets. Thrown before the write instead of arriving
  as a 400 partway through a catalog push.

Both apply to `upsertCatalogItem` and `batchUpsertCatalogObjects`.
