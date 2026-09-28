---
"louise-toolkit": patch
---

Catalog reads carry custom attributes (`louise-toolkit/commerce/square`):

- **`customAttributes`** on `SquareCatalogItem` and `SquareVariation` lists the seller-defined fields Square returns on the object, such as a description on each variation. `mapCatalogItem`, `listCatalogItems`, and `listCatalogDetailed` fill it, empty when there are none.
- **`customAttributeText(attributes, name)`** returns the trimmed text of the `STRING` attribute with that name, matched without regard to case, or `null`. The name is whatever the seller called the attribute in the Square Dashboard, so pass it in as a site setting.

The field is optional in the types, so an object you build by hand, or one read from a cache written by an earlier version, still type-checks. Read it as `variation.customAttributes ?? []`. The Square Dashboard edits custom attributes on items and variations only; modifiers and categories carry them through the API alone.
