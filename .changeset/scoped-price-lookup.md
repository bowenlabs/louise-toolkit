---
"astroidjs": minor
---

**Location-scoped pricing: `ScopedPriceLookup`, `verifyCheckout` scope, an
`"out-of-stock"` refusal, and a location-aware Square adapter.**

One catalog sold through several merchants carries a different price per
location — each shop's commission absorbed in its own Square
`location_overrides` entry. Nothing in the checkout path could see that
dimension, so a cart was re-priced against **base** prices no matter which
storefront it came from: a customer could pay the cheapest merchant's price at
the dearest merchant's shop. That is the same exploit as trusting the client's
`unitPriceCents`, one level further back.

All additive; a single-location store changes nothing.

- **`ScopedPriceLookup = (ids, scope?) => Promise<Map | ScopedPrices>`.** A plain
  `PriceLookup` stays assignable — fewer parameters, narrower return.
- **`verifyCheckout(lines, lookup, { scope })`** passes the scope through to the
  lookup.
- **`"out-of-stock"`** joins the refusal union. A lookup reaches it by returning
  `{ prices, outOfStock }`; a bare `Map` can't express it and guessing would put
  the wrong sentence in front of a customer. Delisted is gone and should leave
  the cart, sold out is coming back and is worth a notify-me. Stock is checked
  **before** price, because a sold-out variation is usually still priced.
- **`squareToCatalogItem(item, { locationId })`** replaces `Math.min` over every
  variation. It drops variations the merchant doesn't carry and prices the rest
  through their overrides. The headline number is scoped for the same reason the
  variants are: `price` means "from", so computing it over the whole catalog
  advertises a price this merchant will never honour — and since the dropped
  variation is usually the cheap one, the error runs in the direction a customer
  notices at the till.
- **`squareItemSoldAt(item, locationId)`** is new, because the adapter can't skip
  a row for you — it returns one item, and "don't store this" isn't a
  `CatalogItem`. Without the guard an unstocked item mirrors as a $0 card.

**Also fixes the generated checkout route under `square: { locations: "multi" }`,
which charged against an ambient location id that does not exist.**

`commerceProviderCredentials` deliberately drops `SQUARE_LOCATION_ID` for
multi-location projects, on the stated grounds that any path defaulting to an
ambient id "would ring one merchant's sale against another merchant's books, and
the sale would look perfectly successful while doing it." The scaffold was
exactly such a path: it emitted `locationId: env.SQUARE_LOCATION_ID ?? ""` — a
var the project is told not to set — so the charge either failed outright or, if
someone set the var to quiet it, credited one location for every merchant's
sales.

Multi-location now generates a route that:

- resolves the merchant in a `resolveLocationId(request)` you fill in, from the
  **host**, and refuses the checkout when it returns `null` rather than falling
  back to a default;
- re-prices at that location live from Square via `retrieveVariationPricesAt`,
  because the D1 mirror holds one price per item and structurally cannot answer
  "what does this cost here";
- charges the same location it priced against;
- runs the **dormancy gate before verification** rather than after — per-location
  re-pricing is itself a Square call, so the old ordering would have the
  enforcing step break the rule it enforces ("never call Square with a dummy
  credential"). An unprovisioned multi-merchant store therefore can't do the
  staleness check at all, and says so (`priced: false`) instead of echoing the
  client's total back as though the server had agreed to it.

`SquareCard.astro` takes `locationId` as a prop there too. Single-location output
is byte-identical to before.
