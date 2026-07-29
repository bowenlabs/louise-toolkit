---
title: Louise Sections
description: Component-rendered pages under editor control — the preconfigured-blocks model.
sidebar:
  order: 6
---

**Louise Sections** are the preconfigured-blocks model: a page is an ordered
list of typed items that _your own components_ render, so a bespoke design stays
pixel-perfect while editors still add, reorder, and edit it. Where the
[Louise Builder](/guide/builder/) stores sanitized HTML and
[inline fields](/guide/inline-editing/) edit one value at a time, sections store
**structured JSON** and render through **your** components.

## The shape

A page carries a `sections` array — ordered items, each a `_type` discriminant
plus its field values:

```json
[
  { "_type": "hero", "heading": "Louise Toolkit", "tagline": "…", "ctaHref": "/docs" },
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
import type { SectionCatalog } from "louise-toolkit/client";

export const SECTIONS: SectionCatalog = {
  hero: {
    label: "Hero",
    fields: {
      heading: { type: "text" },
      tagline: { type: "textarea" },
      ctaLabel: { type: "text" },
      // No visible text on the page → edited in the inspector, not in place.
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
inspector (an `image` gets **Upload** + **Choose from media** + clear controls, so
it always resolves to a [media asset](/guide/media/#strict-media-every-image-from-the-library),
never a pasted URL), as is any field you mark `inline: false` (e.g. a link URL
with no visible text). Pass `mediaBase` to `assertValidSections` and a section
image that isn't media-hosted is rejected on write (`422`).

## Rendering + edit markers

Map each item's `_type` to its component. In edit mode a render stamps **two**
kinds of marker, and they do different jobs — a site that stamps only one gets
half an editor.

### The boundary: `data-louise-node`

One attribute marks every editable **node** — the thing the on-canvas chrome
rings and hangs a toolbar on. Its value is that node's path into the `sections`
array, and nothing else:

```astro
<!-- a section: item i of the page -->
<div data-louise-node={`${i}`}>…</div>

<!-- a block: item j of section i's `blocks` -->
<article data-louise-node={`${i}.blocks.${j}`}>…</article>

<!-- a value: one field of section i -->
<a data-louise-node={`${i}.ctaHref`} href={ctaHref}>Book now</a>
```

Three shapes, one grammar:

- `"0"` — a **section**. It has a position in the page's list, so its toolbar
  gets move up / down, delete, and a `+` to add a sibling after it.
- `"0.blocks.1"` — a **block**: block `1` of section `0`, ordered within its
  section. `blocks` is the reserved structural key.
- `"0.ctaHref"` — a **value**: a node with no position and no children, so its
  toolbar is a wrench only. That wrench opens an inspector **scoped to that
  field**, rather than its section's whole panel.

The render never declares what a node _is_ — it says only where the node lives.
The editor resolves the path against your catalog and the chrome draws whatever
capabilities come back: an ordered node gets move/delete, a node that holds
children gets an add, a node with configurable fields gets a wrench (and no
wrench at all when there's nothing to configure). A section that declares
`blocks` and currently has none draws its own **Add the first one** `+`.

:::caution[A missing boundary marker fails quietly]
Stamp only `data-louise-sfield` and text still edits in place — but there are no
rings, no toolbars, and no way to add, reorder, or remove anything. The page
looks editable while the entire structural layer is absent.
:::

Astroid's [`<Section>`](/reference/astroid/) dispatcher stamps the boundary for
you, at every depth — a block is the same component recursing with a deeper
`base`, so a type that renders as a section renders unchanged as a block. Value
nodes are yours to stamp, since only your component knows which link is the CTA.

### The fields: `data-louise-sfield`

Stamp this on every visible text node so the client can make it editable in
place. The path is `"<index>.<field>"`, or
`"<index>.<key>.<itemIndex>.<subField>"` for array items:

```astro
<h1 data-louise-sfield={`${i}.heading`}>{heading}</h1>
<p data-louise-sfield={`${i}.tagline`} data-louise-multiline>{tagline}</p>
```

Render empty fields too (in edit mode) so there's something to click into;
`data-louise-multiline` keeps newlines for `textarea`-backed fields.

## Editing: `mountSections`

```ts
import { mountSections } from "louise-toolkit/client";

mountSections(el, { catalog: SECTIONS, pageId, initial });
// Auto-save is on by default; opt out with:
mountSections(el, { catalog: SECTIONS, pageId, initial, autoSave: false });
```

`el` is the wrapper around the server-rendered sections. The UX is **hybrid**,
and entirely on the canvas — there is no floating panel:

- **Text is edited in place** on the live design — each `data-louise-sfield`
  node becomes `contenteditable`, writing into a shared fine-grained store (a
  keystroke updates only that leaf, so rows never tear down).
- **Structure is the on-canvas toolbar.** Hovering (or tabbing to) a
  `data-louise-node` rings the tightest node under the pointer and floats its
  toolbar at the top-right: move up / down, delete, and `+` to add. Exactly one
  node is active at a time — a value beats the block it sits in, which beats the
  section around that.
- **Everything you can't point at is behind the wrench** — array items, images,
  and any `inline: false` field, plus a section's layout and settings. On a
  value node the wrench opens just that field.

Save draft, Publish, and the save status live on the shared
[edit bar](/guide/inline-editing/), not on the sections editor.

## The save contract

When the page is wired for [drafts & publishing](/guide/drafts/) (a `versions`
collection), a save stages a **draft** version without touching the live page,
and **Publish** promotes it.

- **Text edits** stage a **draft** — no reload (the DOM already shows the change);
  the live page is unchanged until you **Publish**. With auto-save on (the
  default) this happens on an idle debounce, so the edit bar shows only
  **Publish** — no Save draft button, and no routine saved/unsaved status; a
  *failed* save still surfaces. Auto-save **never publishes**.
- **Structural changes** save a draft and then reload, so the server re-renders
  the new shape (which comes back inline-editable). In edit mode the page resumes
  your latest draft; view mode always shows the published version.

Opt out with `autoSave: false` to bring back the manual **Save draft** button.

Store `sections` as a JSON column on your `pages` table and add it to your
[`pagesRoute`](/reference/editor/) `fields` allowlist (metadata/create/delete) —
the draft/publish surface is [`versionsRoute`](/reference/editor/).

## Validation

The stored JSON is validated server-side before every write. Give `pagesRoute` a
`validate` hook that runs `assertValidSections` against your catalog:

```ts
import { assertValidSections } from "louise-toolkit/content";
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
[`Rule`](/reference/content/) builder collection fields use, e.g.
`heading: { type: "text", validation: (r) => r.required().max(80) }`.

`assertValidSections` throws `LouiseValidationError` on any error-severity
violation, which `pagesRoute` turns into a `422 { error, violations }` — the edit
bar surfaces the first violation as the save-failure reason.

## Search

Because `sections` is a `json` field, its content is full-text searchable: list
it in the collection's `search.fields` and the FTS index flattens every string
leaf (headings, feature text…) into the index. Mount
[`searchRoute`](/reference/editor/) and the Settings' Pages panel gains a search
box. Only published content is indexed; run `POST /api/louise/pages/reindex` once
after adding the FTS table to backfill existing rows.
