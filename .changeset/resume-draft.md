---
"louise-toolkit": patch
"@louise-toolkit/astro": patch
---

editor: `resumeDraft` — the edit-mode draft read every site was copying (#455)

Edit mode has to render the editor's work-in-progress, not the live row, or
reopening a page shows the last-published content and the next save reverts the
draft. Every site hand-wrote that read: three client sites carried a near-identical
`lib/louise-drafts.ts`, the docs told readers to write it themselves, and the
toolkit's own demo site had a fourth copy. The three client copies also missed the KV
write buffer, so on a site with buffering on, edit mode could show a draft older
than the one the next save would build on.

```ts
import { resumeReadSession } from "@louise-toolkit/astro";
import { resumeDraft } from "louise-toolkit/editor";

const resume = resumeReadSession(env.DB, Astro.cookies);
const draft = await resumeDraft(
  resume.client,
  { versionsTable: pagesVersions, collection: "pages", bufferKv: env.DRAFTS },
  page, // { id, publishedVersionId }
);
resume.commit();
```

- **`resumeDraft`** (`louise-toolkit/editor`) returns the draft snapshot or `null`,
  in the same order `applySaveDraft` builds on: the KV buffer first, then the newest
  draft *newer* than `publishedVersionId`. A draft at or below the live pointer is
  superseded, and resuming it would silently revert the page. It returns the whole
  snapshot; which fields you render (`sections`, `body`, …) stays yours. It takes the
  row you already loaded, so it adds no query for the live pointer.
- **`resumeReadSession`** (`@louise-toolkit/astro`) opens the D1 session anchored at
  the editor's bookmark cookie, so a draft saved a moment ago is visible behind read
  replication. It falls back to the raw binding when replication is off.
- **`D1_BOOKMARK_MAX_AGE`** (`louise-toolkit/db`): the bookmark cookie's lifetime,
  now shared by the save path and the read path instead of repeated as a literal.

**If you have a `lib/louise-drafts.ts`:** keep your field accessors, and replace the
query inside them with `resumeDraft`. Pass the page row instead of its id. If you
buffer drafts in KV, pass the same namespace as `bufferKv`.
