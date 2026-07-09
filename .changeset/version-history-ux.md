---
"louisecms": minor
---

Version-history UX in the sections dock: mark the live version, and discard drafts.

- **Flag the live version.** Publishing sets a version's `status` to
  "published" but never demotes the prior one, so multiple history rows read
  "Published" identically. `GET /api/louise/pages/:id/versions` now also returns
  the page's `publishedVersionId`, and the dock marks that row "Live" (accented,
  disabled "Current" button) — others keep "Published" / "Restore".
- **Discard drafts.** New `POST /api/louise/pages/:id/discard` (body
  `{ versionId }`) deletes a draft version from history, backed by a new
  `VersionedLocalApi.discardVersion(context, versionId)` that refuses to delete
  the currently-live version. Each draft row in the dock gets a delete button.

History stays newest-first (unchanged: `findVersions` orders by version id
descending).
