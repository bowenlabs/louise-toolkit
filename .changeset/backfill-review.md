---
"louise-toolkit": minor
---

The Health panel's AI backfills suggest, and the owner accepts (#549). **Fix with AI** wrote model output straight to live data: SEO fields into the live page row and alt text into the media table, and the list of what changed was thrown away. On a versioned collection, a draft saved before the backfill also blanked the new SEO fields again at the next publish.

- `POST …/media/generate-alt` and `POST …/pages/generate-seo` write nothing. They return `{ suggestions }` for the missing fields only.
- The Health panel's **Suggest with AI** shows them as a list the owner can edit, **Accept**, or **Skip**, with **Accept all**. An accepted description is saved with the media route's `PATCH`.
- An accepted SEO suggestion goes to the new `POST …/pages/generate-seo/apply` (`{ id, seoTitle?, seoDescription? }`). Pass `seoFixRoute({ drafts })`, the draft dependencies `versionsRoute` takes, and it's saved as a draft through `applySaveDraft`, so version history holds it and a publish can't blank it; without `drafts`, it's written to the live row.

What to know when you upgrade: the two backfill endpoints now answer `{ suggestions }` instead of `{ fixed, results }`, and they no longer write. A script that called them to fill fields in bulk should apply what it gets back: the media `PATCH` for alt text, and `generate-seo/apply` for SEO. Marking which fields a model wrote waits on the provenance column the MCP write tools add (#236).
