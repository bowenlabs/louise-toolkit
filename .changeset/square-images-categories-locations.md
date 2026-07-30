---
"louise-toolkit": minor
---

**Catalog writes can now carry imagery and taxonomy, and locations can be created.**

The read path already mapped `image_ids` and `categories` / `reporting_category`;
the write body emitted neither, so `mapCatalogItem` after a write always came back
with `imageUrl: null` and a pushed item landed in no category at all. Both are now
on `CatalogPresentationInput`, shared by `upsertCatalogItem` and
`batchUpsertCatalogObjects`:

- `imageIds` — display order, first is primary
- `categoryIds`
- `reportingCategoryId` — the single category Square attributes sales to

**`reportingCategoryId` must appear in `categoryIds`, and that now throws if it
doesn't.** Square reports against it regardless of membership, so the mismatch
costs you a product that is missing from every sales breakdown while looking
correct in the dashboard — findable only by someone who already suspects it.

Unset keys are omitted rather than sent empty. An absent key means "leave it
alone" and `[]` means "clear it", so defaulting to `[]` would strip every item's
imagery on the first price update.

**`createCatalogImage`** uploads the bytes and returns the id those `imageIds`
take — the catalog write accepts ids, never bytes. It is multipart, and
deliberately not built on the JSON verbs: `content-type` has to carry the boundary
`fetch` generates, and setting it by hand breaks the upload in a way that surfaces
as a Square-side rejection. Pass `objectId` to attach during upload, or omit it
and attach later — which is what you want for many items sharing one picture,
since re-uploading the same bytes bills and stores per item.

**`createLocation` / `updateLocation`** complete the Locations API. `updateLocation`
is sparse, so an omitted field is never cleared — but note that `address` is a
nested object Square replaces wholesale, so a partial address replaces the whole
one. Currency is deliberately not settable: Square derives it from the seller
account, so all locations under one account share it. A merchant needing a
different currency needs a different account, which is an onboarding constraint
worth knowing before designing around it.
