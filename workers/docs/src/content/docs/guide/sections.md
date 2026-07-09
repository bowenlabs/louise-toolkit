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

Field types are `text`, `textarea`, and `array` (repeatable, with `itemFields`).
A field defaults to being edited in place; set `inline: false` for a value with
no visible text to click (a link URL, an image ref).

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

- **Text edits** are dirty until **Save**, which `PATCH`es the whole `sections`
  array to your pages route — no reload (the DOM already shows the change).
- **Structural changes** persist and then reload, so the server re-renders the
  new shape (which comes back inline-editable).

Add `sections` to your [`pagesRoute`](/reference/editor/) `fields` allowlist so
the `PATCH` is accepted, and store it as a JSON column on your `pages` table.
