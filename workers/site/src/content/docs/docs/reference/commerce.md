---
title: commerce
description: "louisecms/commerce and /commerce/fourthwall — Stripe and Fourthwall glue."
sidebar:
  order: 4
---

Two entry points, both raw `fetch` + `crypto.subtle` — no SDKs, no peers. See the
[Commerce guide](/docs/guide/commerce/) for the how and why.

## `louisecms/commerce` (Stripe)

```ts
import {
  createPaymentIntent,
  retrievePaymentIntent,
  verifyStripeSignature,
  ensureStripeCustomer,
  createAndSendInvoice,
  createLineItemInvoice,
  type CartItem,
  type InvoiceLineItem,
  type StripeAddress,
} from "louisecms/commerce";
```

| Export | Purpose |
| --- | --- |
| `createPaymentIntent(secretKey, items, …)` | Create a PaymentIntent over a multi-item cart. |
| `retrievePaymentIntent(secretKey, id)` | Re-fetch a PaymentIntent (webhooks treat events as pointers). |
| `verifyStripeSignature(body, header, secret)` | Verify a webhook signature before trusting the payload. |
| `ensureStripeCustomer(secretKey, …)` | Reuse-or-create a customer. |
| `createAndSendInvoice(...)` / `createLineItemInvoice(...)` | Hosted invoices with line items and automatic tax (when the customer has an address). |

The Stripe API version is pinned in the module so an account-default upgrade
can't silently change response shapes — bump it deliberately.

## `louisecms/commerce/fourthwall`

```ts
import {
  listCollections,
  getCollectionProducts,
  getProduct,
  listCatalog,
  lowestPrice,
  createCart,
  verifyFourthwallSignature,
  type FwProduct,
  type FwVariant,
  type FwCartItem,
} from "louisecms/commerce/fourthwall";
```

| Export | Purpose |
| --- | --- |
| `listCollections(token)` / `getCollectionProducts(...)` | Browse the storefront catalog. |
| `getProduct(token, slug)` | Fetch a single product (or `null`). |
| `listCatalog(...)` | The catalog list used to sync a product overlay. |
| `lowestPrice(product)` | Cheapest variant price, for "from $X" display. |
| `createCart(token, items)` | Create a cart; hand off to Fourthwall hosted checkout. |
| `verifyFourthwallSignature(...)` | HMAC-verify an inbound order webhook. |

The `Fw*` interfaces (`FwProduct`, `FwVariant`, `FwImage`, `FwMoney`, `FwStock`,
`FwCollection`, …) type the storefront payloads.

:::tip[Route order webhooks through a queue]
Pair `verifyFourthwallSignature` with [`queues`](/docs/reference/queues/): verify
the HMAC at the edge, `enqueue` the event, and upsert idempotently in the
consumer so a retry can't double-apply.
:::
