---
"louise-toolkit": patch
---

Square client fixes (#700):

- **`retrieveTimecard` and `retrieveTeamMember` return `null` for a 404,** as `retrieveLocation` and the other retrieves already did, instead of throwing.
- **An empty 2xx body reads as an empty object,** so a caller that reads a field gets `undefined` rather than a `TypeError`.
- **`batchUpsertCatalogObjects` follows Square's object limits:**
  - It packs items into batches of at most 1,000 objects, counting each variation.
  - It refuses a write over 10,000 objects with a clear error before sending anything.
  - It returns without a request for an empty list.

  Before, it split into 10 even batches and left the limit to Square's 400.
