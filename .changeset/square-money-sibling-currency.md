---
"louise-toolkit": patch
---

`louise-toolkit/commerce/square` takes a missing amount's currency from the amounts around it rather than assuming USD. Square leaves out a zero amount, often a tip. An order's money fields now fall back to the order's currency, found on its total, amount due, tenders, or line items. A tender's tip falls back to the tender's amount. A payment's amounts fall back to its own currency, and for `createPayment` to the currency it was charged in. USD is left only when a response carries no currency anywhere. A loyalty program's amounts fall back to the currency its other rules name, and an order written with an ad hoc line falls back to that line's currency. Callers have nothing to do.
