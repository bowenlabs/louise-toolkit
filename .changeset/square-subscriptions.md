---
"louise-toolkit": minor
---

`louise-toolkit/commerce/square` covers the subscription lifecycle. `listSubscriptionPlans` reads the catalog's subscription plans with their variations and phases (cadence, periods, `STATIC` or `RELATIVE` pricing). `retrieveSubscription`, `updateSubscription` (a new card, or `canceledDate: null` to undo a scheduled cancel), `cancelSubscription`, `pauseSubscription`, and `resumeSubscription` join `createSubscription` and `searchSubscriptionsByCustomer`. `createSubscription` takes `phases` naming an order template per plan phase, plus `startDate`, `priceOverride`, `taxPercentage`, and `timezone`; `createOrder` takes `state: "DRAFT"` to make that template.

`SquareSubscription` gains `locationId`, `canceledDate`, `invoiceIds`, `phases`, `actions`, `version`, and `createdAt`. Existing fields are unchanged.
