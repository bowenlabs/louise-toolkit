---
title: commerce
description: "louise/commerce (shared base) + /commerce/stripe, /commerce/square, /commerce/fourthwall — Stripe, Square, and Fourthwall clients."
sidebar:
  order: 4
---

A shared base plus three provider clients, all raw `fetch` + `crypto.subtle` — no
SDKs, no peers. See the [Commerce guide](/guide/commerce/) for the how and why.

## `louise/commerce` (shared base)

The primitives every provider client shares: a money shape and the webhook
signature crypto. Import them directly if you verify a custom provider's webhook.

```ts
import {
  centsToMajor,
  hmacSha256Hex,
  hmacSha256Base64,
  safeEqual,
  type Money,
} from "louise/commerce";
```

| Export                               | Purpose                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `Money`                              | `{ amount, currency }` — amount in the currency's minor unit (cents).                    |
| `centsToMajor(cents)`                | Minor units → major (`2500` → `25`).                                                     |
| `hmacSha256Hex` / `hmacSha256Base64` | HMAC-SHA256 of a message under a secret (Stripe uses hex; Square/Fourthwall use base64). |
| `safeEqual(a, b)`                    | Constant-time-ish compare — use it to check a computed signature against a header value. |

## `louise/commerce/stripe`

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
} from "louise/commerce/stripe";
```

| Export                                                     | Purpose                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `createPaymentIntent(secretKey, items, …)`                 | Create a PaymentIntent over a multi-item cart.                                        |
| `retrievePaymentIntent(secretKey, id)`                     | Re-fetch a PaymentIntent (webhooks treat events as pointers).                         |
| `verifyStripeSignature(body, header, secret)`              | Verify a webhook signature before trusting the payload.                               |
| `ensureStripeCustomer(secretKey, …)`                       | Reuse-or-create a customer.                                                           |
| `createAndSendInvoice(...)` / `createLineItemInvoice(...)` | Hosted invoices with line items and automatic tax (when the customer has an address). |

The Stripe API version is pinned in the module so an account-default upgrade
can't silently change response shapes — bump it deliberately.

## `louise/commerce/fourthwall`

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
} from "louise/commerce/fourthwall";
```

| Export                                                  | Purpose                                                |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `listCollections(token)` / `getCollectionProducts(...)` | Browse the storefront catalog.                         |
| `getProduct(token, slug)`                               | Fetch a single product (or `null`).                    |
| `listCatalog(...)`                                      | The catalog list used to sync a product overlay.       |
| `lowestPrice(product)`                                  | Cheapest variant price, for "from $X" display.         |
| `createCart(token, items)`                              | Create a cart; hand off to Fourthwall hosted checkout. |
| `verifyFourthwallSignature(...)`                        | HMAC-verify an inbound order webhook.                  |

The `Fw*` interfaces (`FwProduct`, `FwVariant`, `FwImage`, `FwMoney`, `FwStock`,
`FwCollection`, …) type the storefront payloads.

:::tip[Route order webhooks through a queue]
Pair `verifyFourthwallSignature` with [`queues`](/reference/queues/): verify
the HMAC at the edge, `enqueue` the event, and upsert idempotently in the
consumer so a retry can't double-apply.
:::

## `louise/commerce/square`

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
} from "louise/commerce/square";
```

| Area                      | Exports                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| **Config**                | `SquareConfig` (`accessToken`, `environment`, `version`), `SQUARE_VERSION`, `centsToMajor` |
| **Catalog**               | `listCatalogItems`, `retrieveCatalogItem`, `retrieveVariationPrices`, `mapCatalogItem`     |
| **Inventory**             | `retrieveInventoryCounts`                                                                  |
| **Orders**                | `createOrder`, `retrieveOrder`, `searchOrdersByCustomer`                                   |
| **Payments**              | `createPayment` — charge a Web Payments card token against an order.                       |
| **Customers**             | `searchCustomersByEmail`, `retrieveCustomer`, `createCustomer`, `ensureCustomer`           |
| **Cards & subscriptions** | `createCard`, `searchSubscriptionsByCustomer`, `createSubscription`                        |
| **Loyalty**               | `retrieveLoyaltyAccountByCustomer`                                                         |
| **Webhooks**              | `verifySquareSignature(url, body, header, key)` — note the URL is signed too.              |

The `Square*` interfaces (`SquareCatalogItem`, `SquareVariation`, `SquareOrder`,
`SquarePayment`, `SquareCustomer`, `SquareCard`, `SquareLoyaltyAccount`,
`SquareSubscription`, `SquareMoney`, …) type the normalized, camelCase shapes the
client returns. `SquareMoney` is an alias of the shared `Money`, and
`centsToMajor` is re-exported from the [shared base](#louisetoolkitcommerce-shared-base)
— both still import from `louise/commerce/square`.

:::note[Verify prices before charging]
`createOrder` takes catalog variation ids, not prices — Square computes the total.
Pair it with `retrieveVariationPrices` at checkout to reject a tampered cart, then
`createPayment` with the returned `orderId` so the charge matches the order.
:::
