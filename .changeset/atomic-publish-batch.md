---
"louise-toolkit": patch
---

Publish is now atomic on D1. `createVersionedLocalApi`'s publish path promotes the version snapshot onto the live row (setting `publishedVersionId`) and marks the version row `published` in a single D1 `batch()` — an implicit transaction — so a mid-write failure can no longer leave the row published while its version still reads `draft` (or the reverse). Parent-row existence is guarded before the batch, and any driver without `batch()` keeps the prior sequential behavior, so the generic `BaseSQLiteDatabase` contract is unchanged.
