---
"louise-toolkit": minor
---

Add `louise-toolkit/commerce/square-web` — the browser-side companion to `louise-toolkit/commerce/square`. Previously each site carried its own copy of this loader.

- `loadSquare(environment)` — inject Square's Web Payments SDK from the squarecdn host (sandbox vs production picked by the same `SQUARE_ENVIRONMENT` the server uses), memoized so concurrent callers share one script load. Allow-list the squarecdn host in the site CSP.
- `mountCard(appId, locationId, environment, selector)` — attach a Square card input to `selector` and return a `SquareCardHandle` that tokenizes on demand (surfacing Square's error detail) and tears down. The card is tokenized in the browser, so raw PAN never reaches the Worker; the token is what `commerce/square` charges via `/v2/payments`.

Framework-agnostic (DOM globals only — no Solid dependency), so any island or vanilla checkout can consume it.
