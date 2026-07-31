---
"louise-toolkit": minor
---

**New: `louise-toolkit/commerce/fourthwall-platform` — the Fourthwall Platform
API (Open API v1.0).**

At-cost fulfillment orders and product creation. Raw `fetch` + HTTP Basic, no
SDK, V8-native, matching the other three provider clients.

A separate subpath from `/commerce/fourthwall`, and the split is the point.
Different base URL and different auth, yes — but the reason it is a hard split is
the **trust boundary**. The storefront `storefront_token` is public-safe by
design and shipping it to a browser is the intended use; these are credentials
that place orders and create products, and they must never leave a Worker. One
module holding both is how the wrong one ends up in a client bundle: a component
imports it for `lowestPrice`, the bundler pulls the whole graph, and the order
client lands in the browser's source map. Two modules make that a build error
rather than a leak.

**External orders** — `validateExternalOrder`, `createExternalOrder`,
`listExternalOrders`, `getExternalOrder`, `cancelExternalOrder`, plus a local
`isCancellable` so a UI can hide the button instead of offering an action that
throws.

`validateExternalOrder` is the only place the at-cost breakdown
(`manufacturingCost`, `fulfillmentFee`, `shippingCost`, `totalCreatorCost`) is
available before money is committed. **Fourthwall answers 200 for a validation
that FAILED**, with the reasons in the body — so `res.ok` is not the verdict, and
the client reads `valid`/`errors` instead. Treating the status as the answer
submits an order that was just told it wouldn't work.

**`createExternalOrder` never retries, even when `config.retry` is set.**
Fourthwall has no idempotency-key header, so unlike Square a retried create that
actually succeeded server-side is a second order and a second charge. A sync job
that enabled retries globally must not silently inherit that on the one call that
spends money.

**Products** — `createProduct`, `deleteProduct`, `setProductAvailability`,
`setProductState`, `addProductImages`, and read-only `getProductInventory`.

**There is no product update, and there never will be — the API has none.** No
endpoint changes a product's name, description, price, or variants after
creation. The only remedy is delete and re-create, which mints a new id, so
anything keyed on the old one has to be reconciled. That is documented at
`createProduct` rather than in a release note, because it is where someone
looking for `updateProduct` will actually land.

`createProduct` takes a discriminated input: physical products carry
`profitMargin` (Fourthwall derives the price), digital products carry an absolute
`price`. The type makes the wrong one unspellable rather than silently ignored.

`getProductInventory` returns `quantity: null` for an untracked variant, distinct
from `0` — collapsing them hides a sellable variant. There is also no inventory
webhook, so stock drift is only detectable by polling.

**Rate limiting, on by default.** A token bucket per shop honouring the two
published limits — 100 requests/10s globally and 5 `POST /products`/minute — both
counted per shop, so adding API users buys no budget. Continuous refill rather
than a fixed window, since a fixed window lets 2× the limit through across a
boundary. Product creates spend from both buckets, and acquisition is serialized
so N concurrent callers can't all observe the same empty bucket and burst
together.

The buckets are per **isolate**, and the module says so plainly: two Workers
isolates, or a cron and a queue consumer running concurrently, each get a full
bucket. This prevents the failure that actually happens — one loop hammering an
endpoint it could have paced itself under — and does not pretend to be
distributed coordination. Put the calls behind a Durable Object if you need that.

`rateLimitKey` groups clients that share a shop; it defaults to `username`, which
is right for one user per shop and wrong for several.
