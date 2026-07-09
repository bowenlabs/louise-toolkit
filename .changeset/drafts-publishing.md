---
"louisecms": minor
---

Draft/publish + version history for pages (full-CMS convergence, step 1).

- **`versionsRoute`** (`louisecms/editor`): exposes a versioned collection's
  `createVersionedLocalApi` over HTTP — `GET/POST /api/louise/pages/:id/versions`
  (list / save a draft), `POST …/:id/publish` (`{ versionId? }`, default the
  latest draft), `POST …/:id/unpublish`. A save merges the edit over the current
  live row (config fields only) and stores a complete, publishable snapshot in
  `${slug}_versions`; publish promotes it onto the live row and sets
  `published_version_id`. Mount **before `pagesRoute`** (its `/:id` matcher would
  otherwise claim the `/:id/versions` paths).
- **Sections dock** (`louisecms/client`): **Save** now stages a **draft** — the
  live page is untouched until **Publish**. Adds a **Publish** action and a
  **version history** list that restores (publishes) any earlier version; the
  status line reflects draft vs published.

Model a collection with `defineCollection({ …, versions: { drafts: true } })`,
generate its snapshot table with `collectionVersionsTable`, and render the latest
draft in edit mode (published main row in view mode). See the new **Drafts &
publishing** guide.
