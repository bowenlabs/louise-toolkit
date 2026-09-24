---
"louise-toolkit": patch
---

commerce/square-web: one shared `payments()` instance, and Apple Pay / Google Pay via `mountWallets` (#452)

`mountCard` created a new `Square.payments()` on every call. Square ties a payment
request to the instance that made it, so wallets could not share a page with the card
form — the site that needed them forked this file. `mountCard` is unchanged for
callers; it now goes through the shared instance.

- `getPayments(appId, locationId, environment)` — the memoised instance, exported for
  SDK methods this module does not wrap (ACH, gift cards, `verifyBuyer`).
- `mountWallets(appId, locationId, environment, { totalCents, countryCode, currencyCode,
  googlePayEl?, … })` → `{ applePay?, googlePay?, setTotal, unavailable }`. Each wallet
  is optional: whatever Square cannot initialize is left out and the reason is recorded
  in `unavailable` (and passed to `onUnavailable`), because "no Apple Pay button" is
  otherwise undiagnosable — no Safari, no card in Wallet, domain not verified with
  Square. Call `applePay()` synchronously from the click handler; Safari refuses a sheet
  opened after an `await`. `setTotal(cents)` keeps the sheet in step with a tip or a
  re-quote. Country and currency are parameters (with `fractionDigits` for zero-decimal
  currencies), not assumptions.

Wallets need more CSP origins than the card form — Google Pay's script and frame, and
Square's font host. Those ship as data in #453; until then, allow-list them by hand.
