---
"louise-toolkit": minor
---

`checkoutSession` and `cartFingerprint` in `louise-toolkit/commerce`: a checkout-session id that persists beside a stored cart, for the server to scope a payment's idempotency key to. An id held in page memory changes on every reload while a stored cart doesn't, so a customer whose paid checkout lost its response could reload, retry under a new key, and pay twice.

The id stays the same across retries and reloads of the same cart. It changes when the cart does (`cartFingerprint` covers variants, quantities, and add-ons, not prices), on `rotate()`, and after `idleMs` unused. `storageKey` and `idleMs` are required, with no default. Storage that throws moves the id to page memory. Nothing changes for existing code.
