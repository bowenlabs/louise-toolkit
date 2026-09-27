---
"louise-toolkit": patch
---

Local API fixes (#697):

- **Publishing on the `sqlite-proxy` driver works without a batch callback.** Drizzle's proxy always has a `batch` method, which throws when `drizzle()` got no batch callback. The Local API now sees that and falls back to sequential writes, so publish and search sync no longer fail with "Write failed" on that driver.
- **Drafts accept nested group data.** `saveDraft`, `scheduleDraft`, and `prepareDraft` take `{ seo: { title } }` as `create` does, and store it flat like the row. A flat snapshot (`seo_title`) still works.
- **`publish` returns the document nested,** as `create` and `update` do, and passes the nested shape to `afterChange` and the reindex.
- **`diffVersions` refuses two versions of different pages** with `LouiseContentError`, as its documentation said it would.

**Upgrading:** code that read a published document's flat group columns (`page.seo_title`) should read the nested field (`page.seo.title`).
