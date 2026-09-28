---
"louise-toolkit": patch
---

Square catalog reads leave out archived items. An archived item is hidden from the point of sale and the online store, but it isn't deleted, so it used to reach a storefront.

- **`listCatalogItems` and `listCatalogDetailed`** skip an ITEM whose `item_data.is_archived` is true, as they already skip a deleted one.
- **`retrieveVariationPrices` and `retrieveVariationPricesAt`** omit a variation whose parent item is archived, so a cart saved before the item was archived fails the price check instead of reaching checkout. Both now send `include_related_objects: true` to read the parent item.
