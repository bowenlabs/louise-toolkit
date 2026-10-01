---
"louise-toolkit": minor
---

**Breaking:** Square catalog prices and Fourthwall order costs no longer label a missing currency `"USD"`. The currency is a fact about the site, and a guessed one shows or charges a price in the wrong currency for a site that sells in anything else. Each value now keeps the currency the provider sends, and is `null` when the provider sends none.

- **`louise-toolkit/commerce/square`:** `SquareVariation.currency` and `MenuVariation.currency` are `string | null`. `priceAtLocation`, `retrieveVariationPrices`, and `retrieveVariationPricesAt` return the new `SquareCatalogPrice` (`{ amount, currency: string | null }`) instead of `SquareMoney`. A location override with no currency still takes the base price's.
- **`louise-toolkit/commerce/fourthwall-platform`:** the four costs on `validateExternalOrder`'s result (`manufacturingCost`, `fulfillmentFee`, `shippingCost`, `totalCreatorCost`) are the new `FwReportedMoney` (`{ value, currency: string | null }`). `FwPlatformMoney`, which a digital product's `price` takes, still requires a currency.

**Upgrading:** Square and Fourthwall almost always send a currency, so for most reads nothing changes at run time. TypeScript flags each place that passes one of these currencies on as a `string`, such as into `formatMoney`, a `Money`, or `createOrder`. At each one, fill a missing currency from the site's settings: `price.currency ?? siteCurrency`. If you relied on the `"USD"` label, `price.currency ?? "USD"` restores it, but take the code from your site's config rather than writing it in. astroidjs's catalog adapters already take a `currency` option for this.
