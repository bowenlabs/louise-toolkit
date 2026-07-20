---
"louise-toolkit": minor
"astroidjs": patch
"create-astroid": patch
---

Gate the generated `/api/checkout` route to same-origin, so the one public POST that moves money has the CSRF protection every other public write already had.

Serving a scaffolded storefront turned this up: a cross-origin, correct-price POST to `/api/checkout` returned 200 and processed (re-priced, and in a provisioned store would charge), while the contact form (`formRoute`) and the vitals beacon both refuse a cross-origin POST with a 403. Checkout — the only endpoint that takes a card — was the only ungated one. The single-use Square card token limits the practical CSRF risk, but the inconsistency is real and a money-moving endpoint should not be reachable cross-origin, if only to stop cross-origin price-probing and rate-budget abuse.

The generated checkout route now calls `isSameOrigin(request)` first — before parsing the body, re-pricing, or charging — and returns 403 on a cross-origin (or header-stripped) request. `isSameOrigin` is now re-exported from `louise-toolkit/security` (it already lived in `auth/guard`, where the editor gates use it) so a commerce route can import the CSRF check without pulling in the whole auth barrel. Verified served: cross-origin → 403, header-stripped → 403, same-origin → passes (the contact form still 201s, unaffected).

The route is scaffold-once, so if you deliberately serve checkout from another origin, the gate is one line to relax — it's yours.
