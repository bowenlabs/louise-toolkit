---
title: commerce
description: "louise-toolkit/commerce (shared base) + /commerce/stripe, /commerce/square, /commerce/fourthwall — Stripe, Square, and Fourthwall clients."
sidebar:
  order: 4
---

A shared base plus three provider clients, all raw `fetch` + `crypto.subtle` — no
SDKs, no peers. See the [Commerce guide](/guide/commerce/) for the how and why.

## `louise-toolkit/commerce` (shared base)

The primitives every provider client shares: a money shape and the webhook
signature crypto. Import them directly if you verify a custom provider's webhook.

```ts
import {
  centsToMajor,
  hmacSha256Hex,
  hmacSha256Base64,
  safeEqual,
  type Money,
} from "louise-toolkit/commerce";
```

| Export                               | Purpose                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `Money`                              | `{ amount, currency }` — amount in the currency's minor unit (cents).                    |
| `centsToMajor(cents)`                | Minor units → major (`2500` → `25`).                                                     |
| `hmacSha256Hex` / `hmacSha256Base64` | HMAC-SHA256 of a message under a secret (Stripe uses hex; Square/Fourthwall use base64). |
| `safeEqual(a, b)`                    | Constant-time-ish compare — use it to check a computed signature against a header value. |

## `louise-toolkit/commerce/stripe`

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
} from "louise-toolkit/commerce/stripe";
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

## `louise-toolkit/commerce/fourthwall`

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
} from "louise-toolkit/commerce/fourthwall";
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

## `louise-toolkit/commerce/square`

Square exposes a single versioned REST surface (`/v2/*`). The whole client is
injected through a `SquareConfig` and pins `Square-Version`.

**Retry is off by default, and that is a decision about who is waiting.** Square
publishes no per-endpoint rate limits — only "`RATE_LIMITED`, HTTP 429, back off
exponentially" — so `SquareConfig.retry` (`attempts`, `baseDelayMs`,
`maxDelayMs`) handles 429 and 5xx with jitter inside every fetch verb. Leaving it
off keeps an attended path honest: on a checkout route a caller is watching a
spinner, and three silent retries turn a fast failure into a slow one. Turn it on
for **unattended** work — the queue consumer's catalog refresh, a cron sync, any
multi-location push — where the failure mode without it is a half-applied catalog
and a second of backoff costs nobody anything.

```ts
const square = { accessToken, environment, retry: { attempts: 3 } };
```

A 4xx other than 429 is never retried: that is our bug, not Square's weather.

### Editing an existing object

Square documents a silent data-loss hazard, verbatim: _"If a client reads an
object at an older API version and writes it back at a newer version, fields that
were introduced between those two versions will be absent from the request, and
the server will interpret that absence"_ — as an intentional clear.

The same hazard applies to any read-modify-write that rebuilds the object from
the fields it happens to model. `readModifyWriteCatalog` never rebuilds: it reads
the raw object, hands it to your mutator, and writes back what it got, carrying
the version Square returned and the same pinned `Square-Version` on both calls.

```ts
await readModifyWriteCatalog(config, "VAR123", (object) => {
  const data = object.item_variation_data as Record<string, unknown>;
  data.price_money = { amount: 1800, currency: "USD" };
});
```

The version always comes from that read, so a concurrent write makes yours fail
rather than silently overwrite. Reach for `upsertCatalogItem` when creating or
wholesale-replacing an item, and this when touching one field of something that
already exists — which is exactly when accidental erasure is likeliest and least
visible.

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
} from "louise-toolkit/commerce/square";
```

| Area                      | Exports                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| **Config**                | `SquareConfig` (`accessToken`, `environment`, `version`, `retry`), `SquareRetryConfig`, `SQUARE_VERSION`, `centsToMajor` |
| **Locations**             | `listLocations`, `retrieveLocation`, `SquareLocation`                                      |
| **Catalog**               | `listCatalogItems`, `retrieveCatalogItem`, `retrieveVariationPrices`, `mapCatalogItem`     |
| **Catalog (write)**       | `upsertCatalogItem`, `batchUpsertCatalogObjects` — per-location pricing via `locationOverrides`, presence via `presentAt` / `priceAtLocation`. Both refuse a variation sold where its item isn't, and an item over Square's 250-variation cap. |
| **Catalog (edit)**        | `readModifyWriteCatalog(config, id, mutate)` — edit one field of an existing object without erasing the ones this client doesn't model. Use it over hand-rolling a read/write pair; see below. |
| **Inventory**             | `retrieveInventoryCounts`, `batchChangeInventory`, `setPhysicalCount`                      |
| **Orders**                | `createOrder`, `retrieveOrder`, `calculateOrder` (price a cart without persisting it), `searchOrdersByCustomer`, `searchOrders` (date/state/location filters, cursor-paged, chunked at Square's 10-location ceiling) |
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
— both still import from `louise-toolkit/commerce/square`.

:::note[Verify prices before charging]
`createOrder` takes catalog variation ids, not prices — Square computes the total.
Pair it with `retrieveVariationPrices` at checkout to reject a tampered cart, then
`createPayment` with the returned `orderId` so the charge matches the order.
:::
