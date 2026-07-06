---
title: commerce
description: "louisecms/commerce, /commerce/fourthwall, and /commerce/square — Stripe, Fourthwall, and Square."
sidebar:
  order: 4
---

Three entry points, all raw `fetch` + `crypto.subtle` — no SDKs, no peers. See the
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

## `louisecms/commerce/square`

Square exposes a single versioned REST surface (`/v2/*`). The whole client is
injected through a `SquareConfig` and pins `Square-Version`.

```ts
import {
  SQUARE_VERSION,
  centsToMajor,
  listCatalogItems,
  retrieveCatalogItem,
  retrieveVariationPrices,
  retrieveInventoryCounts,
  createOrder,
  retrieveOrder,
  searchOrdersByCustomer,
  createPayment,
  searchCustomersByEmail,
  retrieveCustomer,
  createCustomer,
  ensureCustomer,
  createCard,
  retrieveLoyaltyAccountByCustomer,
  searchSubscriptionsByCustomer,
  createSubscription,
  verifySquareSignature,
  type SquareConfig,
  type SquareCatalogItem,
  type SquareOrder,
  type SquarePayment,
  type SquareCustomer,
  type SquareSubscription,
} from "louisecms/commerce/square";
```

| Area | Exports |
| --- | --- |
| **Config** | `SquareConfig` (`accessToken`, `environment`, `version`), `SQUARE_VERSION`, `centsToMajor` |
| **Catalog** | `listCatalogItems`, `retrieveCatalogItem`, `retrieveVariationPrices`, `mapCatalogItem` |
| **Inventory** | `retrieveInventoryCounts` |
| **Orders** | `createOrder`, `retrieveOrder`, `searchOrdersByCustomer` |
| **Payments** | `createPayment` — charge a Web Payments card token against an order. |
| **Customers** | `searchCustomersByEmail`, `retrieveCustomer`, `createCustomer`, `ensureCustomer` |
| **Cards & subscriptions** | `createCard`, `searchSubscriptionsByCustomer`, `createSubscription` |
| **Loyalty** | `retrieveLoyaltyAccountByCustomer` |
| **Webhooks** | `verifySquareSignature(url, body, header, key)` — note the URL is signed too. |

The `Square*` interfaces (`SquareCatalogItem`, `SquareVariation`, `SquareOrder`,
`SquarePayment`, `SquareCustomer`, `SquareCard`, `SquareLoyaltyAccount`,
`SquareSubscription`, `SquareMoney`, …) type the normalized, camelCase shapes the
client returns.

:::note[Verify prices before charging]
`createOrder` takes catalog variation ids, not prices — Square computes the total.
Pair it with `retrieveVariationPrices` at checkout to reject a tampered cart, then
`createPayment` with the returned `orderId` so the charge matches the order.
:::
