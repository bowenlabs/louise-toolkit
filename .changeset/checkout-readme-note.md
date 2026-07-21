---
"create-astroid": patch
---

**Document the scaffolded checkout route in the template README.** A storefront
already gets a server-authoritative `src/pages/api/checkout.ts` (re-prices
server-side, keys idempotency to the cart), but nothing in the README said so — so
the failure it prevents was undocumented where a future site author would look.
The README now has a "Taking payments" section spelling out that hand-rolling
`createPayment` without a stable, cart-scoped idempotency key is exactly what this
route exists to avoid: a double-clicked Pay button double-charges, and a constant
or omitted key lets two customers' identical carts collide into one charge.
