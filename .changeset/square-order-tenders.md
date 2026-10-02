---
"louise-toolkit": minor
---

`louise-toolkit/commerce/square` can tell whether an order was paid when the payment call's response was lost. `SquareOrder` gains `tenders` (each with `paymentId`, `amountMoney`, and `tipMoney`) and `netAmountDueMoney`, and the new `retrievePayment` reads a payment by ID, receipt included. `SquarePayment` gains `createdAt`. Existing fields are unchanged.
