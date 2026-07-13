---
title: Drafts & publishing
description: Stage edits as drafts, publish to go live, and roll back with version history.
sidebar:
  order: 7
---

By default the sections editor writes straight to the live page. Opt a collection
into **drafts** and edits stage as versions instead — the live page only changes
when you **Publish**, and every version is recoverable.

## The model

A page's main row is the **live** document (what the public site renders). Drafts
live in a companion `${slug}_versions` table until published; a nullable
`published_version_id` on the main row points at the live version.

- **Save draft** stores a full snapshot in `${slug}_versions` — the live row is
  untouched. With [auto-save](/guide/inline-editing/#auto-save) on (the default),
  edits stage this draft automatically on an idle debounce — no button.
- **Publish** copies a version's snapshot onto the live row and sets
  `published_version_id`, running full field validation.
- **Unpublish** clears the pointer; **Restore** is just publishing an older
  version again.

Publishing is a distinct privilege from editing (`access.publish`), and is
**always a manual, explicit action** — auto-save only ever stages drafts, it
never publishes.

## Opting in

Model the collection with `versions.drafts` and generate its versions table from
the same config:

```ts
// pages-collection.ts
import { defineCollection } from "louise/cms";
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
import { collectionVersionsTable } from "louise/cms";
export const pagesVersions = collectionVersionsTable(pagesCollection);
// pages: { …pagesColumns, publishedVersionId: integer("published_version_id") }
```

Mount [`versionsRoute`](/reference/editor/) — **before `pagesRoute`**, so its
`/:id/versions` paths aren't claimed by `pagesRoute`'s `/:id` matcher:

```ts
versionsRoute({
  table: pages,
  versionsTable: pagesVersions,
  config: pagesCollection,
  resolveEditor,
});
```

A save merges the edit (config fields only) over the newest **pending draft** —
falling back to the live row when there is none — and stores a complete,
publishable snapshot; the field keys must match the `pages` table's property
names so publish's write maps straight onto columns. Merging over the pending
draft (not always the live row) is what lets a partial save layer onto
work-in-progress instead of reverting it (see below).

## One versioned surface per page

A save sends only the fields it changed, and the route backfills the rest. That
works cleanly when **one** surface drives a page's drafts. Mounting two versioned
surfaces on the same page — e.g. `mountLouise({ versionedPageId })` for an inline
body **and** a sections dock for the same page id — is not the supported model:

- Each surface would render its own **Save draft** / **Publish**. The framework
  de-dupes the shared edit bar (only the first surface's actions land on it), but
  the two surfaces still save independently.
- Saves are made safe by merging each partial edit over the newest pending draft
  rather than the live row, so concurrent surfaces no longer revert each other —
  but keeping **one** versioned surface per page is still the clearer model.

If a page needs both an inline body and structured sections, prefer a single
surface (put the body in the sections catalog, or vice versa) so one **Save
draft** / **Publish** governs the whole page.

## Rendering

View mode renders the live main row. In **edit mode**, resume the latest draft so
work-in-progress is visible until published — query the newest `status: 'draft'`
version for the page and render its content, falling back to the main row.

:::note[Read-your-writes with D1 read replication]
Resuming a draft reads back what auto-save just wrote. On a default D1 database
this is always consistent (reads hit the primary). If you enable [D1 read
replication](https://developers.cloudflare.com/d1/best-practices/read-replication/),
route the editor's reads through the **Sessions API** (`env.DB.withSession(bookmark)`,
persisting the bookmark across requests) so a resumed draft is never served stale
from a lagging replica. Writes always go to the primary, so this only affects the
read path.
:::

Skip **superseded** drafts: ignore any draft whose `id` is at or below the live
row's `published_version_id`. Publishing a version stamps `published_version_id`
and leaves older drafts in history; resuming one of those would silently revert
the just-published content. Only a draft **newer** than the live pointer is
pending work (a page that has never published has no pointer, so every draft
counts):

```ts
import { and, desc, eq, gt } from "drizzle-orm";

async function latestPendingDraft(db, pageId) {
  const [page] = await db
    .select({ publishedVersionId: pages.publishedVersionId })
    .from(pages)
    .where(eq(pages.id, pageId));
  const live = page?.publishedVersionId ?? null;
  const [draft] = await db
    .select()
    .from(pagesVersions)
    .where(
      and(
        eq(pagesVersions.parentId, pageId),
        eq(pagesVersions.status, "draft"),
        live === null ? undefined : gt(pagesVersions.id, live),
      ),
    )
    .orderBy(desc(pagesVersions.id))
    .limit(1);
  return draft?.versionData ?? null;
}
```

The route applies the same rule server-side: publishing with no explicit
`versionId` promotes the newest pending draft, never a superseded one.
