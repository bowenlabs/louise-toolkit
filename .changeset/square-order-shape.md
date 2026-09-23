---
"louise-toolkit": patch
---

commerce/square: fulfillments, service charges, line-item modifiers, order totals, and a tip on `createPayment` (#451)

A pickup-or-shipping shop could not build its checkout on `createOrder` — it lacked
everything past the bare line items — so the one site that runs one re-implemented
the request layer around the toolkit, bypassing its retries. This closes that gap.
All additive; every existing call is unchanged.

- `SquareOrderLineItem` (catalog form) takes `modifierIds`, sent as catalog
  references. Square prices them, so there is deliberately no amount field.
- `createOrder` and `calculateOrder` take `serviceCharges` (`SquareServiceCharge`:
  name, amount, phase, taxable — defaulting to an untaxed subtotal-phase flat fee,
  i.e. shipping). Pass the same list to both or the preview is short by that much.
- `createOrder` takes `fulfillments` (`SquareFulfillment`: a `pickup` with an `asap`
  prep duration or a `scheduled` instant, or a `shipment` with an address). Created
  `PROPOSED`; notes are trimmed to Square's 500-char cap rather than failing the
  order after the card was entered. `calculateOrder` does not take them — they are
  not a pricing input, and a preview usually runs mid-address.
- `SquareOrder` gains `totalDiscountMoney` and `totalServiceChargeMoney`, so a
  quote can show Square's own breakdown instead of recomputing one.
- `createPayment` takes `tipMoney`, sent as `tip_money` on top of `amount_money`
  (Square requires the payment to equal the order total, tip excluded). Omitted
  when zero. `SquarePayment` reports `tipMoney` back.

Also exported: `SquareServiceCharge`, `SquareFulfillment`, `SquareFulfillmentRecipient`,
`SquareAddress`.
