---
title: Structured sections
description: Component-rendered pages under editor control — the preconfigured-blocks model.
sidebar:
  order: 6
---

Structured **sections** are the preconfigured-blocks model: a page is an ordered
list of typed items that _your own components_ render, so a bespoke design stays
pixel-perfect while editors still add, reorder, and edit it. Where the
[page builder](/guide/page-builder/) stores sanitized HTML and
[inline fields](/guide/inline-editing/) edit one value at a time, sections store
**structured JSON** and render through **your** components.

## The shape

A page carries a `sections` array — ordered items, each a `_type` discriminant
plus its field values:

```json
[
  { "_type": "hero", "heading": "Louise CMS", "tagline": "…", "ctaHref": "/docs" },
  { "_type": "featureGrid", "items": [{ "title": "…", "body": "…" }] }
]
```

The **site owns rendering** (a bespoke component per `_type`); Louise owns
**editing** only. No markup is ever authored in the editor, so the design can't
drift.

## The catalog

A `SectionCatalog` describes each type's editable fields — schema only, no
markup:

```ts
import type { SectionCatalog } from "louisecms/client";

export const SECTIONS: SectionCatalog = {
  hero: {
    label: "Hero",
    fields: {
      heading: { type: "text" },
      tagline: { type: "textarea" },
      ctaLabel: { type: "text" },
      // No visible text on the page → edited in the dock, not in place.
      ctaHref: { type: "text", inline: false },
    },
  },
  featureGrid: {
    label: "Feature grid",
    fields: {
      items: {
        type: "array",
        itemLabel: "Feature",
        itemFields: { title: { type: "text" }, body: { type: "textarea" } },
      },
    },
  },
};
```

Field types are `text`, `textarea`, `array` (repeatable, with `itemFields`), and
`image`. Plain text is edited in place; `array` and `image` are edited in the
dock (an `image` gets an upload / clear control that POSTs to your media route),
as is any field you mark `inline: false` (e.g. a link URL with no visible text).

## Rendering + edit markers

Map each item's `_type` to its component. In edit mode, stamp a
`data-louise-sfield` marker on every visible text node so the client can make it
editable in place. The path is `"<index>.<field>"`, or
`"<index>.<key>.<itemIndex>.<subField>"` for array items:

```astro
<h1 data-louise-sfield={`${i}.heading`}>{heading}</h1>
<p data-louise-sfield={`${i}.tagline`} data-louise-multiline>{tagline}</p>
```

Render empty fields too (in edit mode) so there's something to click into;
`data-louise-multiline` keeps newlines for `textarea`-backed fields.

## Editing: `mountSections`

```ts
import { mountSections } from "louisecms/client";

mountSections(el, { catalog: SECTIONS, pageId, initial });
```

`el` is the wrapper around the server-rendered sections. The UX is **hybrid**:

- **Text is edited in place** on the live design — each `data-louise-sfield`
  node becomes `contenteditable`, writing into a shared fine-grained store (a
  keystroke updates only that leaf, so rows never tear down).
- A floating **control dock** handles what you can't point at: add / reorder /
  remove sections, array-item add/remove, and any `inline: false` field.

## The save contract

When the page is wired for [drafts & publishing](/guide/drafts/) (a `versions`
collection), the dock's **Save draft** stages a version without touching the live
page, and **Publish** promotes it. Otherwise **Save** writes straight to the page
via `PATCH /api/louise/pages/:id`.

- **Text edits** are dirty until **Save draft** — no reload (the DOM already
  shows the change); the live page is unchanged until you **Publish**.
- **Structural changes** save a draft and then reload, so the server re-renders
  the new shape (which comes back inline-editable). In edit mode the page resumes
  your latest draft; view mode always shows the published version.

Store `sections` as a JSON column on your `pages` table and add it to your
[`pagesRoute`](/reference/editor/) `fields` allowlist (metadata/create/delete) —
the draft/publish surface is [`versionsRoute`](/reference/editor/).

## Validation

The stored JSON is validated server-side before every write. Give `pagesRoute` a
`validate` hook that runs `assertValidSections` against your catalog:

```ts
import { assertValidSections } from "louisecms/cms";
import { SECTIONS } from "./sections/catalog";

pagesRoute({
  table: pages,
  resolveEditor,
  fields: [...DEFAULT_PAGE_FIELDS, "sections"],
  validate: async (data, ctx) => {
    if ("sections" in data) await assertValidSections(SECTIONS, data.sections, ctx);
  },
});
```

`validateSections` (the non-throwing form) checks that the value is an array, that
every item's `_type` is a known catalog entry, and that each field matches its
declared shape (text/textarea → string; array → objects whose `itemFields` are
validated in turn). A field can also carry a `validation` chain — the same
[`Rule`](/reference/cms/) builder collection fields use, e.g.
`heading: { type: "text", validation: (r) => r.required().max(80) }`.

`assertValidSections` throws `LouiseValidationError` on any error-severity
violation, which `pagesRoute` turns into a `422 { error, violations }` — the
on-page dock surfaces the first violation as the save-failure reason.

## Search

Because `sections` is a `json` field, its content is full-text searchable: list
it in the collection's `search.fields` and the FTS index flattens every string
leaf (headings, feature text…) into the index. Mount
[`searchRoute`](/reference/editor/) and the drawer's Pages panel gains a search
box. Only published content is indexed; run `POST /api/louise/pages/reindex` once
after adding the FTS table to backfill existing rows.
