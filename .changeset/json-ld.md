---
"louise-toolkit": minor
---

JSON-LD structured data from the facts in site settings and commerce (#584).

- **Builders** in `louise-toolkit/seo`: `organizationJsonLd`, `localBusinessJsonLd`, `productJsonLd`, and `breadcrumbJsonLd`. Each takes its facts from the settings row or an argument and supplies none: the business type, the address parts, the hours, and the currency are all yours. A missing fact is left out rather than guessed.
- **Prices** are written in major units at the currency's own precision (`"12.50"` USD, `"1250"` JPY).
- **`jsonLdScript(node)`** serializes a node into a `<script type="application/ld+json">` with `<`, `>`, and `&` escaped, so owner text can't close the element.
- **`pageHead({ …, jsonLd })`** takes the nodes, and `renderHeadTags` prints them after the other head tags. `seoHead` in `@louise-toolkit/astro` passes `jsonLd` through, since it takes `pageHead`'s input.

**Upgrading:** nothing is required. A structured address, opening hours, and a business type have no settings column yet; keep them in the settings row's `custom` JSON until a second local site needs them.
