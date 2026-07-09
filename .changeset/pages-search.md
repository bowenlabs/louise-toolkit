---
"louisecms": minor
---

Full-text search over pages (full-CMS convergence, step 2).

- **`searchRoute`** (`louisecms/editor`): `GET /api/louise/pages/search?q=…&limit=…`
  returns ranked (published) matches from a collection's FTS5 index; `POST
…/reindex` rebuilds it from the table. Free input is quoted + prefix-matched into
  a safe FTS5 query. Mount **before `pagesRoute`**.
- **Searchable `json` fields**: `search.fields` now accepts `json` fields, indexed
  by flattening every string leaf — so structured `sections` content (headings,
  feature text…) is full-text searchable, not just `text`/`richText`. Adds
  `createLocalApi.reindexSearch()` to rebuild an index (backfill after first
  creating the FTS table).
- **Drawer Pages panel** (`louisecms/client`): a search box that swaps the page
  list for ranked matches.
