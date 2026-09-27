---
"louise-toolkit": minor
---

`buildMenuTabs` in `louise-toolkit/commerce/square` (#715): order-ahead menu tabs from Square's category tree. It takes what `listCatalogDetailed`, `listCategories`, `listModifierLists`, and `retrieveInventoryCounts` already return, and makes no Square call. Each chosen top-level category gives a tab per subcategory, plus a trailing tab for items filed directly under it. Each item carries its priced variations, a sold-out flag (only when every variation is tracked and at zero or below), and its modifier lists with the item's own `min` and `max`.

The chosen categories and hidden items are arguments. An empty `categoryIds` is an empty menu: picking a category by name stays with the site. Nothing changes for existing code.
