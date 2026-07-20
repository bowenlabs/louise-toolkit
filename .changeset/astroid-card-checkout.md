---
"astroidjs": minor
"create-astroid": minor
---

Scaffold the server-authoritative payment seam, so `archetype: "storefront"` can take a card.

Everything around this already existed and none of it was reachable: `verifyCheckout` re-priced server-side, `checkoutIdempotencyKey` deduped a double-clicked Pay button, the rate rule on `/api/checkout` was in the middleware, `/checkout` and `/cart` were in the noindex list, and the CSP already allowed Square's Web Payments hosts. The route in the middle was missing.

A Square storefront now gets `src/pages/api/checkout.ts` and `<SquareCard>`. The route's step order is the part worth fixing in place, because each step is somewhere a mistake costs money rather than throwing: re-price every line from the D1 mirror (the client's price is a *staleness check*, never an input to the charge — accept `unitPrice` from the body and anyone buys anything for a penny), refuse on mismatch rather than silently charging the server's number, derive the idempotency key from the verified cart *and* the cart id, and only then charge — and only if commerce is actually provisioned, so an unconfigured store simulates instead of calling Square with `DUMMY_REPLACE_ME`. The card field is an iframe served by Square's CDN, so the raw card number never enters the page's DOM or reaches the Worker.

**The cart is deliberately not generated.** Where it lives (localStorage, D1, a portal session), what it holds, and how it renders are project decisions Astroid has no business making; a half-opinionated cart is worse than none. What is *not* a project decision is the order above.

Square only, and named rather than pretended-generic: Fourthwall redirects to its own hosted checkout, and Stripe has no catalog API so it fills the `invoicing` role.

`SQUARE_APP_ID` and `SQUARE_ENVIRONMENT` are emitted as wrangler **vars** rather than added to the commerce credential roster. The app id is public — it ships to the browser to mount the card field — and putting either in `credentials` would also fold it into the dormancy gate, which asks whether we can safely *call* Square, a different question from whether a card field can render. So dormancy semantics are unchanged for existing projects.
