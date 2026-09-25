---
title: Drafts & publishing
description: Stage edits as drafts, publish to go live, and roll back with version history.
sidebar:
  order: 7
---

By default the sections editor writes straight to the live page. Opt a collection
into **drafts** and edits stage as versions instead—the live page only changes
when you **Publish**, and every version is recoverable.

## The model

A page's main row is the **live** document (what the public site renders). Drafts
live in a companion `${slug}_versions` table until published; a nullable
`published_version_id` on the main row points at the live version.

- **Save draft** stores a full snapshot in `${slug}_versions`—the live row is
  untouched. With [auto-save](/guide/inline-editing/#auto-save) on (the default),
  edits stage this draft automatically on an idle debounce—no button.
- **Publish** copies a version's snapshot onto the live row and sets
  `published_version_id`, running full field validation.
- **Unpublish** clears the pointer; **Restore** is just publishing an older
  version again.

Publishing is a distinct privilege from editing (`access.publish`), and is
**always a manual, explicit action**—auto-save only ever stages drafts, it
never publishes.

## Opting in

Model the collection with `versions.drafts` and generate its versions table from
the same config:

```ts
// pages-collection.ts
import { defineCollection } from "louise-toolkit/content";
export const pagesCollection = defineCollection({
  slug: "pages",
  fields: {
    slug: { type: "text", required: true },
    title: { type: "text", required: true },
    sections: { type: "json" },
  },
  versions: { drafts: true },
});

// schema.ts — the snapshot table, plus the pointer column on `pages`
import { collectionVersionsTable } from "louise-toolkit/content";
export const pagesVersions = collectionVersionsTable(pagesCollection);
// pages: { …pagesColumns, publishedVersionId: integer("published_version_id") }
```

Mount [`versionsRoute`](/reference/editor/)—**before `pagesRoute`**, so its
`/:id/versions` paths aren't claimed by `pagesRoute`'s `/:id` matcher:

```ts
versionsRoute({
  table: pages,
  versionsTable: pagesVersions,
  config: pagesCollection,
  resolveEditor,
});
```

A save merges the edit (config fields only) over the newest **pending draft**—falling back to the live row when there is none—and stores a complete,
publishable snapshot; the field keys must match the `pages` table's property
names so publish's write maps straight onto columns. Merging over the pending
draft (not always the live row) is what lets a partial save layer onto
work-in-progress instead of reverting it (see below).

## One versioned surface per page

A save sends only the fields it changed, and the route backfills the rest. That
works cleanly when **one** surface drives a page's drafts. Mounting two versioned
surfaces on the same page—for example, `mountLouise({ versionedPageId })` for an inline
body **and** a sections editor for the same page id—is not the supported model:

- Each surface would render its own **Save draft** / **Publish**. The framework
  de-dupes the shared edit bar (only the first surface's actions land on it), but
  the two surfaces still save independently.
- Saves are made safe by merging each partial edit over the newest pending draft
  rather than the live row, so concurrent surfaces no longer revert each other—but keeping **one** versioned surface per page is still the clearer model.

If a page needs both an inline body and Louise Sections, prefer a single
surface (put the body in the sections catalog, or vice versa) so one **Save
draft** / **Publish** governs the whole page.

## Rendering

View mode renders the live main row. In **edit mode**, resume the editor's
work-in-progress instead, or reopening a page shows the last-published content and
the next save reverts the draft. `resumeDraft` (from `louise-toolkit/editor`)
returns that snapshot, or `null` when there is none:

```ts
import { resumeReadSession } from "@louise-toolkit/astro";
import { resumeDraft } from "louise-toolkit/editor";

let sections = page.sections;
if (Astro.locals.editMode) {
  const resume = resumeReadSession(env.DB, Astro.cookies);
  const draft = await resumeDraft(
    resume.client,
    { versionsTable: pagesVersions, collection: "pages", bufferKv: env.DRAFTS },
    page, // needs `id` and `publishedVersionId`
  );
  resume.commit();
  if (Array.isArray(draft?.sections)) sections = draft.sections;
}
```

It finds the draft in the same order a save layers onto it, so what the editor
sees is what their next save builds on:

1. the KV write buffer, when you pass `bufferKv`—it holds auto-saves newer than
   the last D1 flush;
2. the newest draft **newer** than the live row's `publishedVersionId`.

A draft at or below the live pointer is **superseded**. Publishing stamps
`publishedVersionId` and leaves older drafts in history, and resuming one of those
would silently revert the just-published content. A page that has never published
has no pointer, so every draft counts. The route applies the same rule
server-side: publishing with no explicit `versionId` promotes the newest pending
draft, never a superseded one.

`resumeDraft` returns the whole snapshot. Which fields a page renders from it is
your schema's business.

### Writing to the live row directly

A write that bypasses the routes (a raw SQL `UPDATE` to a page's `sections`, a
one-off script, a migration) changes only the live row. View mode shows it
right away, but edit mode doesn't: `resumeDraft` prefers any pending draft,
whether it's in the KV buffer or a draft version newer than the live pointer.
The editor keeps seeing the draft, and the next save builds on the draft, so
publishing overwrites your direct write.

To change a page that has a pending draft, do one of the following:

- Make the change through the editor or the API, so it lands on the draft.
- Discard the pending draft first with `POST /api/louise/pages/:id/discard` (body
  `{ versionId }`). Discarding also clears the KV buffer.

### Read-your-writes behind read replication

Resuming a draft reads back what auto-save just wrote. On a default D1 database
this is always consistent (reads hit the primary). Enable [D1 read
replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
and a resume read can land on a replica that hasn't caught up to the write yet—"my edit vanished." The toolkit closes that gap with the **D1 Sessions API**, and
it's wired for you:

- The draft **write** (auto-save) runs through a `first-primary` session, so the
  write hits the primary and the session's bookmark advances past it. The route
  persists that bookmark in an HttpOnly `louise_d1_bookmark` cookie
  (`serializeD1BookmarkCookie`).
- The **resume read** opens a session anchored at that cookie
  (`resumeReadSession(env.DB, Astro.cookies)` from `@louise-toolkit/astro`) and
  hands the session to `resumeDraft`, so the read is guaranteed to see the write.
  Call `commit()` after the read to persist the bookmark it advanced to. The
  cookie round-trips automatically—no client code.

Writes always target the primary, so this only shapes the read path. With
replication **off** (or on a runtime without the Sessions API) it degrades to the
raw binding—behaviour is identical, so the seam is safe to ship before you flip
replication on.

The lower-level seam lives in `louise-toolkit/db`: `openD1Session(DB, constraint)`
returns a session (or the raw binding as a fallback), `d1Bookmark(client)` reads
the current bookmark, and `db(session)` accepts either—Drizzle only calls
`prepare`/`batch`, which a session implements.

#### Enabling replication on your database

There's no wrangler command yet—enable it in the dashboard (**D1 → your
database → Settings → Enable Read Replication**), or via the REST API with a token
that has **D1:Edit**:

```sh
# Turn read replication on (auto mode). No extra cost — still billed on rows
# read/written. Replace the account and database ids.
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/d1/database/$D1_DATABASE_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"read_replication": {"mode": "auto"}}'

# Verify it took (expect .result.read_replication.mode == "auto"):
curl -s \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/d1/database/$D1_DATABASE_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result.read_replication'
```
