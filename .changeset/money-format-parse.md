---
"louise-toolkit": minor
---

`louise-toolkit/commerce` can now format a `Money` for a person and read the text back, in the currency's own minor unit.

- **`formatMoney(money, { locale, ...options })`** formats a `Money` with `Intl.NumberFormat`: `{ amount: 125000, currency: "USD" }` is `"$1,250.00"` in `en-US`, and 1250 JPY is `"¥1,250"`. It reads the minor-unit count from the currency instead of assuming two decimals. Other `Intl.NumberFormat` options pass through, so `maximumFractionDigits: 0` gives a whole-unit dashboard total.
- **`parseMoney(text, { locale, currency })`** reads what `formatMoney` prints, and what a person types the same way: `"$1,200.50"`, `"1200.5"`, and `"1.200,50 €"` in `de-DE` all come back as minor units. It checks that group separators sit where the locale puts them, so `"12.5"` in `de-DE` is `null` rather than 125 euros. `parseMoneyInput` stays the strict core underneath it.
- **`currencyDigits(currency)`** gives a currency's minor-unit count: 2 for USD, 0 for JPY, 3 for BHD.
- **`centsToMajor(cents, fractionDigits?)`** takes the minor-unit count, matching `majorToCents`. It always divided by 100, so a JPY amount came out a hundred times too small and a BHD amount ten times too large. The default is still 2, so existing calls return what they did.

Locale and currency have no defaults, because both are facts about the site.

**What to do:** nothing is required. If you call `centsToMajor` on a `Money` whose currency isn't two-decimal, pass `currencyDigits(money.currency)`. A hand-rolled `cents / 100` formatter can become `formatMoney`.
