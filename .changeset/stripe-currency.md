---
"louise-toolkit": minor
---

`createPaymentIntent` and `createAndSendInvoice` take the currency, and a new check, `lint:facts`, records every currency, locale, and time zone literal left in the library (#578).

- **`createPaymentIntent(secretKey, items, { currency })`** and **`createAndSendInvoice(secretKey, { …, currency })`** charge in the ISO 4217 code you pass, in either case, as `createLineItemInvoice` already did. Before, both always charged in USD.
- **Defaults that remain:** each still defaults to `"usd"`, so existing calls are unchanged. The Square client still tags a response that leaves its currency out as `"USD"`, and still fills it in on a write whose input names none; every Square write input takes a `currency`. Fourthwall money without a currency is tagged `"USD"` too.
- **`lint:facts`** fails on an ISO 4217 code, a BCP 47 locale with a region, or an IANA time zone written as a string literal in `packages/louise/src`, unless its allowlist entry in `scripts/ci/checks/site-fact-literals.mjs` gives the reason.

**Upgrading:** a site that sells in anything but US dollars passes `currency` to these helpers, and to the Square writes it calls.
