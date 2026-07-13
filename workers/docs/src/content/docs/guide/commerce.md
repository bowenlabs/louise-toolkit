---
title: Commerce
description: Stripe invoices, Fourthwall storefront, and the Square /v2 client — no SDKs.
sidebar:
  order: 11
---

Louise's commerce primitives are thin, V8-native glue over three external
services. They use raw `fetch` and `crypto.subtle` — **no Node SDKs** — so they
run in a Worker unchanged. Each provider is its own subpath — `/commerce/stripe`,
`/commerce/square`, `/commerce/fourthwall` — over a shared `louise-toolkit/commerce`
base that holds the money helpers and webhook-signature crypto all three reuse.

:::tip[See it live]
The [Workers checkout example](https://louisetoolkit.com/examples/commerce) runs a
real Square charge against the [sandbox](https://sandbox.louisetoolkit.com) — the
same `louise-toolkit/commerce/square` client shown below, with its secret resolved
through [`astro:env`](/guide/getting-started/#typed-env-vars-with-astroenv).
:::

## Stripe — invoices only

`louise-toolkit/commerce/stripe` creates hosted Stripe invoices: reuse-or-create a
customer, add line items, enable automatic tax when the customer has an address,
and verify incoming webhooks.

```ts
import { verifyStripeSignature } from "louise-toolkit/commerce/stripe";

// Webhook route — verify before trusting the payload.
export async function POST({ request, env }) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const event = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  // …handle event.type…
  return new Response(null, { status: 200 });
}
```

Two design notes worth knowing:

- **The API version is pinned** so an account-default upgrade can't silently
  change response shapes — bump it deliberately.
- Stripe's `/v2` namespace doesn't yet cover PaymentIntents/Invoices, so those
  use `/v1` endpoints. The webhook path treats events as pointers and re-fetches
  the object from the API rather than trusting the event body.

## Fourthwall — storefront & orders

`louise-toolkit/commerce/fourthwall` wraps the Fourthwall storefront
(catalog + cart) and platform (orders) APIs, plus HMAC webhook verification.

```ts
import {
  listCatalog,
  lowestPrice,
  createCart,
  verifyFourthwallSignature,
} from "louise-toolkit/commerce/fourthwall";
```

A typical shop keeps a light on-site cart keyed by Fourthwall variant id, then
hands off to Fourthwall's **hosted checkout** — Fourthwall owns payment, tax,
shipping, and fulfillment. Orders mirror back read-only via an HMAC-verified
webhook, which you can route through a [queue](/reference/queues/) to an
idempotent consumer.

## Square — catalog, orders, payments & subscriptions

`louise-toolkit/commerce/square` is the fullest of the three: a **read-first** client
over Square's `/v2` REST surface, covering catalog, inventory, orders, payments,
customers, cards, loyalty, and subscriptions. Everything is injected through a
`SquareConfig` (an access token plus a `sandbox`/`production` environment), and the
`Square-Version` is pinned — unlike Stripe, Square has no `/v1` vs `/v2` split, so
date-versioning rides on a single namespace.

```ts
import {
  listCatalogItems,
  retrieveVariationPrices,
  createOrder,
  createPayment,
  verifySquareSignature,
} from "louise-toolkit/commerce/square";

const config = { accessToken: env.SQUARE_ACCESS_TOKEN, environment: "production" };
```

The one write path is **checkout**, and it's deliberately trust-nothing:

1. **Verify prices** — re-fetch the cart's variations with `retrieveVariationPrices`
   and compare them against the client-submitted amounts before charging.
2. **Create the Order** from catalog references with `createOrder`, so Square
   computes the authoritative total and taxes — the browser never dictates price.
3. **Charge** with `createPayment`, passing a Web Payments SDK card token
   (`sourceId`) tokenized in the browser (raw card data never reaches the Worker)
   plus the `orderId`, so the amount matches Square's computed total.

Subscriptions reuse the same tokenized-card model: save a card on file with
`createCard`, then enroll against a plan variation with `createSubscription`.

Webhooks differ from Stripe and Fourthwall in one important way — Square signs the
**concatenation of your exact notification URL and the raw body**, so
`verifySquareSignature` takes that URL as its first argument:

```ts
const ok = await verifySquareSignature(
  "https://example.com/webhooks/square", // the URL configured in Square, exactly
  await request.text(),
  request.headers.get("x-square-hmacsha256-signature"),
  env.SQUARE_SIGNATURE_KEY,
);
```

As with Fourthwall, route the verified event through a
[queue](/reference/queues/) to an idempotent consumer.

See the [commerce reference](/reference/commerce/) for the full export
list.
