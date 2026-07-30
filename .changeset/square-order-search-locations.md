---
"louise-toolkit": minor
---

**Fixed: order search broke on the eleventh location.** `searchOrders` and
`searchOrdersByCustomer` passed `locationIds` straight through to
`/v2/orders/search`, where Square caps `location_ids` at **10 per call** — a
documented hard ceiling that answers an eleventh id with a 400, not a truncation.

Both now chunk at 10 and merge, sequentially rather than in parallel: a
300-location account is 30 searches, and firing those at once is the surest way
to meet the rate limit this client only retries when asked to.

Merging needs one thing more than concatenation. **Square sorts within a
response, not across our chunks**, so above 10 locations the result was ordered
per chunk and unordered overall — which spot-checks fine and puts the wrong rows
in any "top N" or "most recent" that trusts the order. Results are re-sorted on
the same axis the search used, with orders missing that timestamp sorted last in
both directions (an `OPEN` order has no `closed_at`, and unguarded it lands where
"newest" should be). `searchOrdersByCustomer` also trims to `limit` after
merging, since `limit` is per request and N chunks otherwise return N×limit.

An empty `locationIds` now throws instead of asking Square to reject it. Not
returning `[]` deliberately: a reporting call that silently yields no rows reads
as "no sales", which is worse than an error.

Also adds **`calculateOrder`** (`POST /v2/orders/calculate`) — preview a cart's
totals including auto-applied taxes through the same pricing engine checkout
uses, without persisting an order to clean up if the customer walks away. It
shares `orderLineItemBody` with `createOrder` and `createPaymentLink`, so the
preview cannot drift from the charge.
