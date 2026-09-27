---
"louise-toolkit": patch
---

Stripe invoice fixes (#701):

- **Currency case:** `createLineItemInvoice` lowercases the currency, as `createPaymentIntent` and `createAndSendInvoice` already do.
- **Fallback total:** when Stripe doesn't report the amount due, the total is summed from the rounded line amounts, the same values the invoice items were sent with.
- **Encoded ids:** both invoice helpers encode the invoice id in the finalize and send paths.
