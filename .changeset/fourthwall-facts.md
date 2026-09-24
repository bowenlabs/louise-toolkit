---
"louise-toolkit": patch
---

commerce/fourthwall: the full product type, `fourthwallCopy`, `catchAllFirst`, `FW_IMAGE_HOST`, and a shared `vanishedRows` (#460)

Three facts about Fourthwall's API that one site learned in production, now in the
toolkit so any Fourthwall mirror gets them:

- **`FwProduct.additionalInformation`** (`FwAdditionalInformation[]`): the accordion
  panels. They're real and documented, but the type omitted them, so the site widened
  it locally.
- **`fourthwallCopy(product, { panel?, onComplianceDropped? })`**: the copy worth
  mirroring. `description` is usually empty; sellers type into the More details
  panel. That panel carries a hidden EU GPSR block with **Fourthwall's fulfilment
  address**, which mirrored verbatim is published as the seller's. This returns More
  details with that block removed and falls back to `description`. If compliance text
  survives the strip, the panel is dropped and `onComplianceDropped` is called.
- **`catchAllFirst(catalog)`** / **`isCatchAllCollection(c)`**: Fourthwall returns "All
  Products" last, so a sync that sets a product's category once per collection files
  everything under it. `listCatalog`'s own order is unchanged; its docs now point here.
- **`FW_IMAGE_HOST`**: the host of Fourthwall's signed image URLs.

And in `louise-toolkit/commerce`, for any provider:

- **`vanishedRows(stored, seen, { externalId, alreadyMarked? })`**: the stored rows a
  catalog read didn't return. It's an in-memory diff, because SQLite caps bound
  parameters. Acting on the result is policy: only after a complete read, and never on
  an empty one.
