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
  untouched.
- **Publish** copies a version's snapshot onto the live row and sets
  `published_version_id`, running full field validation.
- **Unpublish** clears the pointer; **Restore** is just publishing an older
  version again.

Publishing is a distinct privilege from editing (`access.publish`).

## Opting in

Model the collection with `versions.drafts` and generate its versions table from
the same config:

```ts
// pages-collection.ts
import { defineCollection } from "louisecms/cms";
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
import { collectionVersionsTable } from "louisecms/cms";
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

A save merges the edit over the current live row (config fields only) and stores
a complete, publishable snapshot; the field keys must match the `pages` table's
property names so publish's write maps straight onto columns.

## Rendering

View mode renders the live main row. In **edit mode**, resume the latest draft so
work-in-progress is visible until published — query the newest `status: 'draft'`
version for the page and render its content, falling back to the main row.
