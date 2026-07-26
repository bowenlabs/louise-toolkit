---
"louise-toolkit": minor
"astroidjs": patch
---

Square hosted checkout links, a QR encoder, and two silent-failure fixes.

**`louise-toolkit/commerce/square`** — `createPaymentLink` / `retrievePaymentLink` /
`deletePaymentLink` over `/v2/online-checkout/payment-links`, plus the `sqDelete`
helper they need. Prefer the `order` form over `quickPay`: it is the only one that
carries a `referenceId` onto the resulting Order, which is how an in-person sale
stays attributable — the reference survives into the merchant's own Square
dashboard and the Transactions export. Its line items may be ad-hoc, so a site can
sell from its own catalog without mirroring anything into Square first. The
alternative rail (`commerce/square-web`) mounts a card field only; a hosted link
gets Apple Pay / Google Pay / Cash App Pay from a config flag, which is what a
shopper standing in a shop with a phone actually wants. Order line-item
serialization is now shared with `createOrder` so the two cannot drift.

**`louise-toolkit/qr`** — a new subpath: a vendored ISO/IEC 18004 byte-mode
encoder (`encodeQr`) and SVG rendering (`qrSvg`, `qrDataUri`). Vendored rather
than depended on because the package ships with zero runtime dependencies and QR
is a frozen spec — the same call already made for hand-rolled SVG in
`core/browser/og-card.ts`. Byte mode only: the payloads are URLs, so alphanumeric
mode could never apply. Full 8-mask penalty evaluation (fixing a mask produces
codes some scanners refuse), a 4-module quiet zone by default, and dark modules
emitted as ONE run-merged `<path>` rather than a rect per module — roughly 4x
smaller, which is what keeps a code inlineable. Pure string generation, no
bindings, so a QR route works with every commerce secret still a placeholder.
Hand `qrSvg()` to `core/browser/resvg.ts` for a PNG.

**`astroidjs` — `SQUARE_ENVIRONMENT` was withheld from invoicing-only sites.**
Both Square vars were gated on `usesCardCheckout` (storefront === `"square"`), but
`SQUARE_ENVIRONMENT` selects the API host for *every* Square call and
`SquareConfig.environment` defaults to `"sandbox"`. A project running
`{ storefront: "fourthwall", invoicing: "square" }` therefore got no var and
created every **production** invoice against the sandbox — no error, no warning.
The two vars are now gated separately: `SQUARE_APP_ID` for the browser card field,
`SQUARE_ENVIRONMENT` whenever Square holds any role. Same fix in
`generateAstroidCheckoutEnv`.

**`astroidjs` — per-provider dormancy gating.** `CommerceStatus.configured` is an
all-or-nothing `every()`, correct for "is the module ready" and wrong for gating a
single call site: with Fourthwall live and Square dormant it reads `false`, so
gating on it would have simulated the *working* Fourthwall checkout. Adds
`providerConfigured(status, provider)` and `roleConfigured(status, role)`;
`ProviderStatus.roles` widens to `CommerceRole[]`. The aggregate is unchanged, so
this is additive.
