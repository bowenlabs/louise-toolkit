---
"louisecms": minor
---

Convergence features toward the commerce/ordering use case:

- **`louisecms/astro`: `defineCatalogLoader`** — shared plumbing for an Astro
  Live Content Collection backed by a commerce catalog. Maps items to keyed
  entries, stamps a `cacheHint` (tag + snapshot age), and wraps read failures
  as loader errors. Sites inject only the domain-specific bits (how to read/
  resolve items, each item's slug), so different providers share one loader.
- **`louisecms/cms` media: `cfImageSrcset`** — a width-descriptor `srcset` (+
  default `src`) for rectangular renders, so the browser picks the smallest
  derivative covering the rendered width at the device DPR. Optional `ratio`
  derives each step's height to match a CSS `object-fit` cover crop. Mirrors
  `circleImage` for non-square frames.
- **Editor `pagesRoute`: `versionsTable`** — an optional version-snapshot table
  so a page DELETE cascades to its draft/publish snapshots (which have no FK to
  the page row and would otherwise orphan). Omit for unversioned collections.
- **Forms: typed derived columns** — `deriveFormColumns` and
  `FormDefinition.columns` are now typed as `SQLiteColumnBuilderBase`, dropping
  the internal cast and letting consumers spread the columns into their own
  `sqliteTable` with extra fields.
