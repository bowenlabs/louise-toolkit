---
"louise-toolkit": minor
---

Square multi-location: per-merchant pricing, presence, batch catalog + inventory writes, and reporting.

**Why.** A multi-merchant site maps each merchant to a Square **Location**, which
is what buys per-merchant pricing and per-merchant stock off one shared catalog at
no extra cost (Locations are free; the cap is 300). The client had none of the
location surface, so every one of those reads and writes was unavailable.

**`listLocations` / `retrieveLocation`.** `retrieveLocation` returns `null` on a
404 rather than throwing: "this merchant has no Square location yet" is a
legitimate state, not an exception the caller should have to catch.

**Per-location pricing and presence, on read and write.** `SquareVariation` gains
`locationOverrides`, and both it and `SquareCatalogItem` carry the three presence
fields. Two helpers hold the logic so no caller re-derives it:

- `presentAt(presence, locationId)` — Square's two lists are **not** symmetric:
  `present_at_location_ids` is a whitelist used when `present_at_all_locations` is
  false, `absent_at_location_ids` a blacklist used when it is true. Inverting that
  silently shows a merchant products they do not carry.
- `priceAtLocation(variation, locationId)` — the location's override price where
  one is set, else the base price. An override that adjusts availability without
  setting a price correctly falls back rather than reading as free.

`upsertCatalogItem` and `CatalogVariationInput` accept `presence` and
`locationOverrides`; unset keys are omitted from the request body so a write never
clobbers Square-side presence with an accidental default. An override that sets a
price also sends `pricing_type: FIXED_PRICING`, without which Square keeps
inheriting `VARIABLE_PRICING` from the parent.

**`retrieveVariationPricesAt`** — the multi-merchant checkout guard. Verifying a
cart against base prices would let a customer pay the cheapest merchant's price at
the dearest merchant's storefront, so re-price against the location the order is
actually placed at. A variation absent at that location is **omitted** from the
result, so a caller requiring every id to resolve fails closed instead of selling
stock the merchant does not carry.

**`batchUpsertCatalogObjects`** — one request instead of one per item, which is
what keeps a full catalog push from becoming a rate-limit problem. Splits across
Square's 10-batch limit. The call is atomic: one stale `version` fails the whole
batch, which is the right trade for a price push (no half-applied change).

**`batchChangeInventory` / `setPhysicalCount`.** Note the direction of truth —
D1 owns price, presence and placement; **Square owns inventory counts**. These
exist for the reconcile path (a physical recount, seeding a new merchant's opening
stock), not for mirroring a D1 number over Square's. Prefer `PHYSICAL_COUNT`: it
sets an absolute quantity, so a replayed message lands on the same number, whereas
a replayed `ADJUSTMENT` double-counts.

**`searchOrders`** — the reporting rail (best-sellers, per-merchant totals,
reorder suggestions), following the cursor. Defaults to `COMPLETED` only: leaving
the state filter open counts `OPEN` and `CANCELED` orders as revenue and quietly
inflates every downstream report. The sort field is derived from the date field,
because Square rejects a search where the two disagree.

**`SquareConfig.retry`** — opt-in transient-failure retry with `Retry-After`
support and jittered exponential backoff, for unattended paths (cron sync, queue
consumers). **Off by default**, so existing callers are unchanged. Retries 429 and
5xx only — a 400/401 is our bug and will stay wrong. Retrying POSTs is safe here
precisely because every mutating endpoint already takes an `idempotency_key`.

`mapCatalogItem`'s return value gains fields (additive; only exact-equality
assertions are affected).
