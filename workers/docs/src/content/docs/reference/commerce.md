---
title: commerce
description: "louise-toolkit/commerce (shared base) + /commerce/stripe, /commerce/square, /commerce/fourthwall, /commerce/fourthwall-platform—Stripe, Square, and Fourthwall clients."
sidebar:
  order: 4
---

A shared base plus four provider clients, all raw `fetch` + `crypto.subtle`—no
SDKs, no peers. See the [Commerce guide](/guide/commerce/) for the how and why.

Fourthwall is two of the four, split along its trust boundary:
`/commerce/fourthwall` speaks the public-safe Storefront API, and
`/commerce/fourthwall-platform` the server-only Platform API.

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
| `Money`                              | `{ amount, currency }`—amount in the currency's minor unit (cents).                      |
| `centsToMajor(cents)`                | Minor units → major (`2500` → `25`).                                                     |
| `hmacSha256Hex` / `hmacSha256Base64` | HMAC-SHA256 of a message under a secret (Stripe uses hex; Square/Fourthwall use base64). |
| `safeEqual(a, b)`                    | Constant-time-ish compare—use it to check a computed signature against a header value.   |

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
can't silently change response shapes—bump it deliberately.

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

## `louise-toolkit/commerce/fourthwall-platform`

The **Platform** API (Open API v1.0)—at-cost fulfillment orders and product
creation. A separate subpath from `/commerce/fourthwall`, and the split is
deliberate.

:::caution[Different trust boundary, not just a different base URL]
The storefront `storefront_token` is public-safe by design; shipping it to a
browser is the intended use. These are HTTP Basic credentials that place orders
and create products, and they must never leave a Worker. One module holding both
is how the wrong one ends up in a client bundle—a component imports it for
`lowestPrice`, the bundler pulls the whole graph, and the order client lands in
the browser's source map. Two modules make that a build error instead of a leak.
:::

```ts
import {
  validateExternalOrder,
  createExternalOrder,
  listExternalOrders,
  getExternalOrder,
  cancelExternalOrder,
  isCancellable,
  getProductInventory,
  createProduct,
  deleteProduct,
  setProductAvailability,
  setProductState,
  addProductImages,
  type FourthwallPlatformConfig,
} from "louise-toolkit/commerce/fourthwall-platform";
```

### External orders

| Export                       | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `validateExternalOrder(...)` | Price an order **without creating it**. Call this first.      |
| `createExternalOrder(...)`   | Place it. Chargeable, and never retried—see below.            |
| `listExternalOrders(...)`    | Paged list, optionally filtered by status.                    |
| `getExternalOrder(...)`      | One order, or `null` when it doesn't exist.                   |
| `cancelExternalOrder(...)`   | Cancel. Refused once `PACKAGED`/`SHIPPED`.                    |
| `isCancellable(order)`       | Local check, so a UI can hide the button instead of throwing. |

`validateExternalOrder` is the only place the at-cost breakdown—`manufacturingCost`, `fulfillmentFee`, `shippingCost`, `totalCreatorCost`—is
available before money is committed. Shipping especially isn't knowable up front:
it depends on the destination and on how Fourthwall splits the items across
facilities.

:::danger[A failed validation still answers 200]
Fourthwall returns 200 for a validation that failed, with the reasons in the
body. Read `check.valid` and `check.problems`, not the HTTP status—treating
`res.ok` as the verdict submits an order it was just told wouldn't work.
:::

**`createExternalOrder` never retries, even when `config.retry` is set.**
Fourthwall has no idempotency-key header, so a retried create that actually
succeeded server-side is a second order and a second charge. A sync job that
turned retries on globally must not silently inherit that. For at-most-once
across a queue redelivery, set `externalId` and reconcile with
`listExternalOrders` before creating.

### Products

| Export                        | Purpose                                    |
| ----------------------------- | ------------------------------------------ |
| `createProduct(...)`          | Create. Throttled—5/min per shop.          |
| `deleteProduct(...)`          | Permanent, and the only way to "edit" one. |
| `setProductAvailability(...)` | Shop-level purchasable switch.             |
| `setProductState(...)`        | The product's own lifecycle state.         |
| `addProductImages(...)`       | Appends. There is no replace.              |
| `getProductInventory(...)`    | Read-only—there is no inventory write.     |

:::danger[There is no product update. Not "not yet"—none.]
The API exposes no endpoint to change a product's name, description, price, or
variants after creation. If a detail is wrong, the only remedy is delete and
create again—which mints a **new id**, so anything of yours keyed on the old
one (a mirror row, a saved cart, an order line) has to be reconciled.

Two things to design around: validate your inputs before calling, because there
is no correction pass; and don't treat product ids as stable across an edit—they're stable across time and unstable across a change, because a change is a
re-create.
:::

`createProduct` takes a discriminated input. Physical products are priced by
**`profitMargin`, not by retail price**—you choose what you make per unit and
Fourthwall derives the price. Only digital products take an absolute `price`:

```ts
await createProduct(config, { kind: "physical", name: "Tee", profitMargin: 8 });
await createProduct(config, {
  kind: "digital",
  name: "Zine",
  price: { value: 5, currency: "USD" },
});
```

`getProductInventory` returns `quantity: null` for a variant that isn't
stock-tracked—distinct from `0`, and collapsing them hides a sellable variant.
There's also **no inventory webhook**, so stock drift is only detectable by
polling. Pick an interval against how bad an oversell is for you, not against how
fresh you'd like the number to be.

### Rate limiting

On by default. A token bucket per shop, refilling continuously rather than
resetting on a window boundary—a fixed window lets 2× the limit through across
the boundary, which is the exact burst a limiter is for.

| Limit                 | Default    |
| --------------------- | ---------- |
| Global, all endpoints | 100 / 10 s |
| `POST /products`      | 5 / minute |

Both are counted **per shop**, so adding API users buys no extra budget. The
buckets key on `rateLimitKey`, which defaults to `username`—right for one user
per shop, wrong for several, where each would get its own bucket and the group
would overrun the real limit together. Give every client for a shop the same
string.

`POST /products` also runs a synchronous mockup render, so it's slow as well as
rare. A bulk import of 50 products takes ten minutes by design; the alternative
is 45 of them erroring.

:::caution[Per-isolate, not distributed]
The buckets live in module state, so a second Workers isolate—or a cron and a
queue consumer running concurrently—each gets a full bucket and together can
exceed the shop's real budget. This prevents the failure that actually happens
(one loop hammering an endpoint it could have paced itself under) and doesn't
pretend to be coordination. If you need that, put the calls behind a Durable
Object and let it own the pacing.
:::

Pass `rateLimit: false` to opt out, or override either number to go _lower_.
Raising it doesn't raise the server's limit—it just moves where you find out.

## `louise-toolkit/commerce/square`

Square exposes a single versioned REST surface (`/v2/*`). The whole client is
injected through a `SquareConfig` and pins `Square-Version`.

**Retry is off by default, and that is a decision about who is waiting.** Square
publishes no per-endpoint rate limits—only "`RATE_LIMITED`, HTTP 429, back off
exponentially"—so `SquareConfig.retry` (`attempts`, `baseDelayMs`,
`maxDelayMs`) handles 429 and 5xx with jitter inside every fetch verb. Leaving it
off keeps an attended path honest: on a checkout route a caller is watching a
spinner, and three silent retries turn a fast failure into a slow one. Turn it on
for **unattended** work—the queue consumer's catalog refresh, a cron sync, any
multi-location push—where the failure mode without it is a half-applied catalog
and a second of backoff costs nobody anything.

```ts
const square = { accessToken, environment, retry: { attempts: 3 } };
```

A 4xx other than 429 is never retried: that is our bug, not Square's weather.

### Editing an existing object

Square documents a silent data-loss hazard, verbatim: _"If a client reads an
object at an older API version and writes it back at a newer version, fields that
were introduced between those two versions will be absent from the request, and
the server will interpret that absence"_—as an intentional clear.

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
already exists—which is exactly when accidental erasure is likeliest and least
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

| Area                      | Exports                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Config**                | `SquareConfig` (`accessToken`, `environment`, `version`, `retry`), `SquareRetryConfig`, `SQUARE_VERSION`, `centsToMajor`                                                                                                                     |
| **Locations**             | `listLocations`, `retrieveLocation`, `createLocation`, `updateLocation` (sparse), `SquareLocation`, `SquareLocationInput`                                                                                                                    |
| **Catalog images**        | `createCatalogImage`—multipart upload returning the id that `imageIds` takes                                                                                                                                                                 |
| **Catalog**               | `listCatalogItems`, `retrieveCatalogItem`, `retrieveVariationPrices`, `mapCatalogItem`                                                                                                                                                       |
| **Catalog (write)**       | `upsertCatalogItem`, `batchUpsertCatalogObjects`—per-location pricing via `locationOverrides`, presence via `presentAt` / `priceAtLocation`. Both refuse a variation sold where its item isn't, and an item over Square's 250-variation cap. |
| **Catalog (edit)**        | `readModifyWriteCatalog(config, id, mutate)`—edit one field of an existing object without erasing the ones this client doesn't model. Use it over hand-rolling a read/write pair; see below.                                                 |
| **Inventory**             | `retrieveInventoryCounts`, `batchChangeInventory`, `setPhysicalCount`                                                                                                                                                                        |
| **Orders**                | `createOrder`, `retrieveOrder`, `calculateOrder` (price a cart without persisting it), `searchOrdersByCustomer`, `searchOrders` (date/state/location filters, cursor-paged, chunked at Square's 10-location ceiling)                         |
| **Payments**              | `createPayment`—charge a Web Payments card token against an order.                                                                                                                                                                           |
| **Customers**             | `searchCustomersByEmail`, `retrieveCustomer`, `createCustomer`, `ensureCustomer`                                                                                                                                                             |
| **Cards & subscriptions** | `createCard`, `searchSubscriptionsByCustomer`, `createSubscription`                                                                                                                                                                          |
| **Loyalty**               | `retrieveLoyaltyAccountByCustomer`                                                                                                                                                                                                           |
| **Webhooks**              | `verifySquareSignature(url, body, header, key)`—note the URL is signed too.                                                                                                                                                                  |

The `Square*` interfaces (`SquareCatalogItem`, `SquareVariation`, `SquareOrder`,
`SquarePayment`, `SquareCustomer`, `SquareCard`, `SquareLoyaltyAccount`,
`SquareSubscription`, `SquareMoney`, …) type the normalized, camelCase shapes the
client returns. `SquareMoney` is an alias of the shared `Money`, and
`centsToMajor` is re-exported from the [shared base](#louisetoolkitcommerce-shared-base)—both still import from `louise-toolkit/commerce/square`.

:::note[Verify prices before charging]
`createOrder` takes catalog variation ids, not prices—Square computes the total.
Pair it with `retrieveVariationPrices` at checkout to reject a tampered cart, then
`createPayment` with the returned `orderId` so the charge matches the order.
:::

:::caution[Tax is opt-in on API-created orders]
Square applies **no** tax to an order you create through the API. Dashboard tax
settings reach POS and Square Online on their own, but not `CreateOrder`—so a
storefront that says nothing charges pre-tax, with no error to notice, and the
merchant finds out at reconciliation.

Ask for it explicitly, and pass the **same** options to `calculateOrder`, or the
total you show is not the total you charge:

```ts
const pricingOptions = { autoApplyTaxes: true };

// what the cart displays
const preview = await calculateOrder(config, { locationId, lineItems, pricingOptions });

// what gets charged — same rules, so the two agree
const order = await createOrder(config, { locationId, lineItems, pricingOptions });
await createPayment(config, {
  sourceId,
  locationId,
  orderId: order.id,
  // Square's number, which now includes tax — not your own subtotal.
  amountMoney: order.totalMoney,
});
```

`order.totalTaxMoney` carries the tax half if you render it as its own line.

Two things worth knowing. This client never sends `order.taxes[]`, which Square
documents as double-taxing alongside `auto_apply_taxes`, so that combination is
unreachable here. And whether `auto_apply_taxes` filters an item's `tax_ids` by
the order's `location_id` is strongly implied by Square staff but never stated in
the docs—if you sell the same item at two locations with different rates,
confirm it against your own catalog before trusting it.
:::
