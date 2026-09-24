---
"louise-toolkit": patch
---

commerce: `cartIssues`, `repairCart` and Square's `retrieveLiveCatalogObjectIds` — check a cart against the live catalog, reporting every problem (#457)

A stored cart outlives the catalog it was built from. Refusing a checkout that disagrees
with the catalog is right. Refusing with only the *first* problem is how customers got
stuck: they fixed one line, retried, and were refused over the next. A bag holding an old
price failed every retry, and a deleted add-on made Square reject the whole order with no
way to say which add-on it was. Two sites hand-rolled fixes for this.

- **`cartIssues(lines, { prices, outOfStock?, liveModifierIds? })`** in
  `louise-toolkit/commerce` returns every problem, once per variant or add-on:
  `price-changed` (with today's price), `unavailable`, `out-of-stock` (checked before
  price) and `modifier-unavailable`. It is pure and works with any provider.
- **`repairCart(lines, issues, { key?, maxQuantity? })`** is pure and applies them all in
  one step. It reprices changed variants, removes unavailable and sold-out ones, strips
  deleted add-ons, and combines lines that became identical. It returns
  `{ lines, changes }`, and the changes are data for you to word for your customers.
  There is no quantity cap unless you pass one, and the input is never mutated.
- **`cartModifierIds(lines)`**: the de-duplicated add-on ids to ask the provider about.
- **`retrieveLiveCatalogObjectIds(config, ids, { type? })`** in
  `louise-toolkit/commerce/square` returns which ids still exist and aren't deleted,
  optionally of one `type` (e.g. `"MODIFIER"`). It batches requests at Square's 1000-id
  limit and makes none for an empty list.
