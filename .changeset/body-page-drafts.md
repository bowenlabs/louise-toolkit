---
"louisecms": minor
---

`mountLouise` can stage inline edits as drafts (body pages join the versioned
workflow).

`mountLouise({ versionedPageId })` opts a page into the draft/publish workflow:
its inline `data-louise-field` edits are collected into a single **draft**
(`POST /api/louise/pages/:id/versions`) — the live row is untouched — and a
**Publish** button (yellow, beside a green **Save draft**) promotes it
(`POST …/publish`). Without `versionedPageId` the bar keeps its previous
behavior (a single live **Save** via `/save`). This brings rich-text body pages
to parity with the sections/home surface, which already staged drafts; the site
resumes the latest draft's field values in edit mode and moves rich-text
sanitizing onto the collection's `beforeChange` hook so it covers the
draft/publish paths (not just the old live `/save`).
