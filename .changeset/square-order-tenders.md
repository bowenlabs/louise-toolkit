---
"louise-toolkit": minor
---

`louise-toolkit/commerce/square` can tell whether an order was paid when the payment call's response was lost. `SquareOrder` gains `tenders` (each with `paymentId`, `amountMoney`, and `tipMoney`) and `netAmountDueMoney`, and the new `retrievePayment` reads a payment by ID, receipt included. `SquarePayment` gains `createdAt`. Existing fields are unchanged.

The new fields are required, since the mappers always fill them. Code that builds a `SquareOrder` by hand, such as a test stub or a fake `retrieveOrder`, now needs `netAmountDueMoney` and `tenders` (an empty array for an unpaid order), and code that builds a `SquarePayment` by hand needs `createdAt` (null is fine).
