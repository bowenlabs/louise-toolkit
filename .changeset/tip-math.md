---
"louise-toolkit": minor
---

Tip math in `louise-toolkit/commerce` (#716): `percentTip`, `tipCap`, `parseTipCents`, and `clampTip`, so a checkout's page and server compute presets and the cap with the same code. The presets, the cap's floor and ceiling, and its share of the subtotal are all arguments. The one default is `subtotalPercent: 100`, a cap equal to the subtotal before the floor and ceiling apply.

`louise-toolkit/commerce/square` adds `orderSubtotal(order)`: Square's subtotal after discounts and before tax and service charges. Take the tip cap on it, from `calculateOrder` on the page and the created order on the server, so the two sides can't disagree near the cap. Nothing changes for existing code.
