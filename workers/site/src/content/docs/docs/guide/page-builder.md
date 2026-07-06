---
title: Page builder
description: Blocks, the slash menu, and defineBlock.
sidebar:
  order: 5
---

The rich-text editor has an optional **blocks** mode — the `blocks` prop on
`RichText`, on for freeform content pages and off for inline prose fields.
`louisecms/client`'s `blocks` module holds the framework.

## Blocks are serialized HTML

A block is a ProseMirror node spec plus an optional Solid node view for its
editing chrome. Persistence is the same **sanitized-HTML** contract as every
rich field:

- `toDOM` emits `<tag data-block="…" class="pb-…">`.
- `parseDOM` reconstructs the node from that markup on load.

So a block-built page is just HTML — there's no separate block JSON to store or
migrate.

## The slash menu

Typing `/` in the editor opens the inserter, populated from the `BLOCKS`
registry. The reference block set is **hero**, **two columns** (`pbCol`
children), **full-bleed**, **pull quote**, **CTA**, and **divider**.

```ts
import { BLOCKS, BlockInserter } from "louisecms/client";
```

## Defining a block

`defineBlock()` pairs the node spec with an optional node view, so new blocks can
be authored outside the core module:

```ts
import { defineBlock } from "louisecms/client";

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
tokens — so editor HTML can never borrow arbitrary site classes.
