---
"louise-toolkit": minor
---

`checkoutSession` and `cartFingerprint` in `louise-toolkit/commerce`: a checkout-session ID that persists beside a stored cart, for the server to scope a payment's idempotency key to. An ID held in page memory changes on every reload while a stored cart doesn't, so a customer whose paid checkout lost its response could reload, retry under a new key, and pay twice.

The ID stays the same across retries and reloads of the same cart. It changes when the cart does (`cartFingerprint` covers variants, quantities, and add-ons, not prices), on `rotate()`, after `idleMs` unused, and `maxAgeMs` after it was minted. `storageKey`, `idleMs`, and `maxAgeMs` are required, with no default. Keep any server-side record of an attempt longer than `maxAgeMs`. Storage that throws moves the ID to page memory. A stored value that isn't a session, such as a bare ID a site's own version kept under the same key, is replaced on first use, so you can reuse that key. It's a browser primitive: where there's no `document`, as on a server, a session without a `storage` option keeps nothing between calls, so two customers never share an ID.

`repairCart`'s default line key now JSON-encodes the variant and add-on IDs, so lines whose IDs contain `|` or `,` no longer merge by mistake. Nothing else changes for existing code.
