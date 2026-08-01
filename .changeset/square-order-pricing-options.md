---
"louise-toolkit": minor
---

square: `createOrder` and `calculateOrder` accept `pricingOptions`

Square applies **nothing** by default to an API-created order. Dashboard tax
settings reach POS and Square Online on their own, but not `CreateOrder` — so a
storefront built on this client charged pre-tax with no error to notice, and the
merchant found out at reconciliation. There was no way to ask for the location's
rates.

Both calls now take an optional `pricingOptions: { autoApplyTaxes?, autoApplyDiscounts? }`,
emitted as `order.pricing_options` — nested inside `order`, which is where Square
reads it. At the request root it is ignored silently, so the nesting is pinned by
a test rather than left to the caller.

`calculateOrder` takes the same option deliberately: taxes are opt-in on both
calls, so a preview that omitted them while the charge applied them would show a
customer a total they never agreed to. Pass the same options to both.

Additive — omitting `pricingOptions` sends no `pricing_options` key and leaves
existing callers charging exactly the line-item prices, as before.

Two notes carried in the type's docs. This client never sends `order.taxes[]`,
which Square documents as double-taxing when combined with `auto_apply_taxes`, so
that combination is unreachable by construction. And whether `auto_apply_taxes`
filters an item's `tax_ids` by the order's `location_id` is strongly implied by
Square staff but never stated in the docs — a seller with different rates per
location should confirm it against their own catalog before trusting it.

Closes #392.
