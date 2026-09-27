---
"louise-toolkit": minor
---

A `SquareCatalogItem` lists every image on the item, not just the primary. `imageUrl` held only the first of the item's `image_ids`, and the primary image is also the item's tile on the register, so a site had no way to show a different picture online.

- `images` is a new field on `SquareCatalogItem`: `SquareItemImage[]`, each an `id` and a `url`, in Square's order with the primary first. `mapCatalogItem`, `listCatalogItems`, `retrieveCatalogItem`, and the catalog search fill it.
- `url` is `null` when the response didn't carry the IMAGE object. A batch upsert's result has ids with no URLs, and so does an image that was deleted but is still listed on the item.
- `imageUrl` is unchanged: it's the first entry's `url`.

What to know when you upgrade: nothing changes for code that reads `imageUrl`. A site that caches catalog items should read `images` as optional until the cache refreshes, since entries written before the upgrade don't have it.
