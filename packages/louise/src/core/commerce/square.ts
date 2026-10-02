// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square—Square API client (V8-native). Raw fetch +
// crypto.subtle only, no `square` Node SDK (it assumes Node and won't run on
// Workers). Square exposes a single versioned REST surface—everything lives
// under the /v2/* namespace and the release is pinned with the `Square-Version`
// header (there is no /v1 vs /v2 split like Stripe's; date-versioning rides on
// top of v2). Mirrors the shape of commerce/index.ts (Stripe) and
// commerce/fourthwall.ts.
//
// Read-first: this site treats Square as the source of truth for commerce, so
// the bulk here is catalog/orders/customers/loyalty/subscriptions reads. The
// one write path is checkout—verify prices against the live catalog, create
// an Order, then charge it with a Web Payments SDK card token via /v2/payments
// (card data is tokenized in the browser and never reaches the Worker).
//
// One file per area under `square/`; this barrel re-exports every public one,
// so `louise-toolkit/commerce/square` is unchanged. `square/request.ts` and
// `square/wire.ts` are internal and stay out of it.

export * from "./square/client.js";
export * from "./square/money.js";
export * from "./square/locations.js";
export * from "./square/catalog.js";
export * from "./square/catalog-details.js";
export * from "./square/inventory.js";
export * from "./square/menu.js";
export * from "./square/orders.js";
export * from "./square/payments.js";
export * from "./square/customers.js";
export * from "./square/cards.js";
export * from "./square/loyalty.js";
export * from "./square/subscription-plans.js";
export * from "./square/subscriptions.js";
export * from "./square/team.js";
export * from "./square/labor.js";
export * from "./square/invoices.js";
export * from "./square/payment-links.js";
export * from "./square/webhooks.js";
