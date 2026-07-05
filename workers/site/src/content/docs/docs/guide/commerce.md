---
title: Commerce
description: Stripe invoices and Fourthwall storefront glue — no SDKs.
sidebar:
  order: 9
---

Louise's commerce primitives are thin, V8-native glue over two external
services. They use raw `fetch` and `crypto.subtle` — **no Node SDKs** — so they
run in a Worker unchanged.

## Stripe — invoices only

`@louisecms/core/commerce` creates hosted Stripe invoices: reuse-or-create a
customer, add line items, enable automatic tax when the customer has an address,
and verify incoming webhooks.

```ts
import { verifyStripeSignature } from "@louisecms/core/commerce";

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

`@louisecms/core/commerce/fourthwall` wraps the Fourthwall storefront
(catalog + cart) and platform (orders) APIs, plus HMAC webhook verification.

```ts
import {
  listCatalog,
  lowestPrice,
  createCart,
  verifyFourthwallSignature,
} from "@louisecms/core/commerce/fourthwall";
```

A typical shop keeps a light on-site cart keyed by Fourthwall variant id, then
hands off to Fourthwall's **hosted checkout** — Fourthwall owns payment, tax,
shipping, and fulfillment. Orders mirror back read-only via an HMAC-verified
webhook, which you can route through a [queue](/docs/reference/queues/) to an
idempotent consumer.

See the [commerce reference](/docs/reference/commerce/) for the full export
list.
