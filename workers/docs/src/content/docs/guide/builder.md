---
title: Louise Builder
description: Builder blocks, the slash menu, and defineBlock.
sidebar:
  order: 5
---

The rich-text editor has an optional **builder** mode—the `builder` prop on
`RichText`, or `data-louise-builder="1"` on an inline field—on for freeform
content pages and off for inline prose fields. What it inserts are **builder
blocks**, which live inside one rich-text field's HTML. They're not a section's
[blocks](/guide/sections/), which are items in a list your own
components render; the [glossary](/reference/glossary/) keeps the two apart.
`louise-toolkit/client`'s `blocks` module holds the framework.

The prop was `blocks`, and the attribute `data-louise-blocks`, until #537. Both
old names still work.

## Builder blocks are serialized HTML

A builder block is a ProseMirror node spec plus an optional Solid node view for its
editing chrome. Persistence is the same **sanitized-HTML** contract as every
rich field:

- `toDOM` emits `<tag data-block="…" class="pb-…">`.
- `parseDOM` reconstructs the node from that markup on load.

So a block-built page is just HTML—there's no separate block JSON to store or
migrate.

## The slash menu

Typing `/` in the editor opens the inserter, populated from the `BLOCKS`
registry. The reference block set is **hero**, **two columns** (`pbCol`
children), **full-bleed**, **pull quote**, **CTA**, and **divider**.

```ts
import { BLOCKS, BlockInserter } from "louise-toolkit/client";
```

## Defining a builder block

`defineBlock()` pairs the node spec (a `BuilderBlockDef`) with an optional node
view, so new builder blocks can be authored outside the core module:

```ts
import { defineBlock } from "louise-toolkit/client";

export const callout = defineBlock({
  name: "callout",
  // ProseMirror node spec: toDOM emits `<aside data-block="callout" class="pb-callout">`,
  // parseDOM matches it back. The serialized HTML is the storage format.
  // …plus an optional Solid node view for the in-editor chrome.
});
```

## Public styling

Public styles are `pb-*` classes you own in your site stylesheet; block-built
pages typically render at full width while prose pages keep a readable measure.
The sanitizer allows `class` **only** on block containers and **only** `pb-*`
tokens—so editor HTML can never borrow arbitrary site classes.
