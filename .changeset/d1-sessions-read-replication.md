---
"louise-toolkit": minor
---

Add a D1 Sessions API seam so draft resume is read-your-writes even behind [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) (#69). With replication on, a resume read (loading the latest draft after an auto-save) can land on a replica that hasn't caught up to the write — "my edit vanished." The Sessions API closes that gap, and the toolkit now wires it end to end.

`louise-toolkit/db` gains the seam: `db()` now accepts a `D1Database` **or** a `D1DatabaseSession` (Drizzle only calls `prepare`/`batch`, both of which a session implements), plus `openD1Session(DB, constraint)`, `d1Bookmark(client)`, and the bookmark-cookie helpers `D1_BOOKMARK_COOKIE` / `readD1Bookmark` / `serializeD1BookmarkCookie`. All of it feature-detects `withSession` and degrades to the raw binding when the runtime predates the Sessions API — so behaviour on an un-replicated D1 is unchanged and the seam is safe to ship before you flip replication on.

The draft-save path (`applySaveDraft`, shared by the raw `versionsRoute` POST and the `louiseSaveDraft` Action) now runs through a `first-primary` session and persists the session bookmark in an HttpOnly `louise_d1_bookmark` cookie. The resume read anchors a session at that cookie and threads it through the draft query, so the write is always visible. The cookie round-trips automatically across the same-origin auto-save POST and the next top-level edit-mode navigation — no client code. Writes always target the primary, so only the read path changes; public view-mode renders stay session-free and cacheable.

```ts
// Edit-mode resume, anchored at the last auto-save's bookmark.
import { resumeReadSession } from "./lib/louise/drafts.js";
const resume = resumeReadSession(env.DB, Astro.cookies);
const draft = await latestDraftSections(resume.client, home.id, env.DRAFTS);
resume.commit(); // persist the advanced bookmark
```

See `guide/drafts.md` for the how-to, including the REST call to enable replication (`PUT /accounts/{id}/d1/database/{id}` with `{"read_replication":{"mode":"auto"}}`).
