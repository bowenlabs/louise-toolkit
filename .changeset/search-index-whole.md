---
"louise-toolkit": minor
---

Search results stay whole while the full-text index updates. Before, a reader could catch the index between steps: a rebuild emptied the table before refilling it, so a search during `reindexSearch` returned partial results, and a rebuild that failed partway left them partial until the next one. A single row's sync ran its delete and its insert separately, so a failure between the two dropped that page from search.

- **One row's sync is one batch.** A publish, a Local API write, and `reindexDoc` send the row's delete and insert together, and D1 commits a batch as one transaction. A reader sees the old entry or the new one, never neither. On a driver without `batch`, the two still run in order, as before.
- **`reindexSearch` no longer empties the index.** It replaces each row's entry in place, 50 rows to a batch, then deletes only the entries whose row no longer exists. The return value is unchanged: the number of rows indexed.
- **`pagesRoute`'s `afterWrite` gets the written row.** A second argument, `{ operation, id }`, names the create, update, or delete that just happened, so the hook can update that one row instead of rebuilding the whole index after every save:

  ```ts
  pagesRoute({
    table: pages,
    resolveEditor,
    afterWrite: (_editor, { id }) => reindexDoc(db(env.DB), pages, pagesCollection, id),
  });
  ```

  `reindexDoc` re-reads the row, so the same call removes the entry after a delete. The new type is `PagesWrite`, from `louise-toolkit/editor`.

**What to do:** nothing is required, and an existing one-argument `afterWrite` keeps working. If your `afterWrite` calls `reindexSearch`, switch it to `reindexDoc` as shown: every save in the Pages panel then touches one index entry instead of every one.
