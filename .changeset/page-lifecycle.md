---
"louise-toolkit": minor
---

"Published" now has one meaning, and publish and unpublish keep a page's visibility in step (#534, ADR 0021).

- **Publish shows the page.** `publish` now sets the row's `status = 'published'` in the same batch that copies the snapshot and moves the pointer. Before, a new page stayed hidden after its **Publish** until someone changed its Status by hand, and the Pages panel still read Draft.
- **Unpublish hides the page.** `unpublish` now sets `status = 'draft'` and keeps the row and `published_version_id`. Before, it cleared the pointer and left the page public. A collection whose table has no `status` column can't be hidden, so `unpublish` throws `LouiseContentError` there, and the route answers `422`.
- **Superseded drafts stay superseded.** A draft is now superseded when it's at or below the highest version ever promoted, not the current pointer. Before, an unpublish, or publishing an older version by ID, made old drafts pending again, so the next save built on stale content and "publish the latest draft" could put it live. `latestPendingDraft(versions)` drops its second argument, and `resumeDraft` no longer reads `publishedVersionId` from the row.
- **The scheduler skips superseded drafts.** `publishScheduled` no longer promotes a due draft that a later publish superseded.
- **Publish with nothing pending.** `POST …/publish` with no pending draft shows a hidden page again as it stands, through the new `republish`, which keeps edits made while it was hidden. It publishes a never-published page as it stands. A live page with nothing pending still gets `400 No draft to publish`.
- **`status` belongs to publish.** With `versionsTable`, `pagesRoute` refuses `status` on create and update with a `422`. The Pages panel shows **Publish** and **Unpublish** for such a page instead of a Status select, and lists pages as Live, Hidden, or Not published.
- **The rules, exported.** `pageState`, `versionState`, `promotedHighWater`, and `isPageLive` from `louise-toolkit/content`. The versions `GET` adds `state` to each version and `pageState` to the response. The history drawer labels rows Live, Hidden, Earlier, Draft, Scheduled, or Superseded, and the edit bar counts only pending drafts as work to publish.

To upgrade:

- **Pages already unpublished.** A page unpublished before this release still has `status = 'published'` and no pointer, so it's still public, as it was. Nothing changes it automatically, because a page created live without drafts looks the same. Review them with `SELECT id, slug FROM pages WHERE status = 'published' AND published_version_id IS NULL`, and unpublish the ones meant to be hidden.
- **Your own `status` writes.** A script or form that writes `status` through `pagesRoute` on a versioned page now gets a `422`. Call `POST /api/louise/pages/:id/publish` or `…/unpublish` instead.
- **`latestPendingDraft` callers** drop the second argument.
