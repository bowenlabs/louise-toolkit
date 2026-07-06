---
title: client
description: "louisecms/client — the inline-edit client, ProseKit editor, icons, and blocks."
sidebar:
  order: 3
---

```ts
import {
  mountLouise,
  RichText,
  mountRichText,
  Icon,
  icons,
  BLOCKS,
  BlockInserter,
  defineBlock,
  injectStyles,
} from "louisecms/client";
```

The browser-side editor. This is the only subpath that touches the DOM and Solid;
peer dependencies: `solid-js`, `prosekit`, `@prosekit/pm`.

## `mountLouise()`

```ts
function mountLouise(): void;
```

Finds every `[data-louise-field]` marker on the page, makes each editable in
place (plain text via `contenteditable`, rich text via the ProseKit editor), and
mounts the edit bar. **Self-gating** — if no markers are present it does nothing,
so it's safe to lazy-import and call on any page. See
[Inline editing](/docs/guide/inline-editing/).

## `RichText` / `mountRichText`

The ProseKit (Solid) editor used identically by inline fields and by any
drawer form you build.

```tsx
import { RichText, type RichTextProps } from "louisecms/client";

<RichText
  value={html}
  onChange={(next) => save(next)}
  // `blocks` turns on the page-builder slash menu; omit for plain prose.
/>;
```

`mountRichText` is the imperative mount used internally by `mountLouise`;
`RichText` is the Solid component for your own forms. Storage is **HTML**, not
JSON (see [Rich text](/docs/guide/rich-text/)). Exported types: `RichTextProps`,
`RichTextField`.

## `Icon` / `icons`

The Phosphor icon set the toolbar and panels share, inlined as raw SVG (CSP-safe
— no external requests).

```tsx
import { Icon, type IconName } from "louisecms/client";

<Icon name="pencil-simple" />;
```

`icons` is the registry; `IconName` is the union of available names.

:::note[Credit]
The icons are [Phosphor Icons](https://phosphoricons.com) (MIT © Phosphor Icons),
inlined at build time. See the package's `THIRD_PARTY_NOTICES.md`.
:::

## Blocks

The page-builder framework (see [Page builder](/docs/guide/page-builder/)):

```ts
import {
  BLOCKS,
  BlockInserter,
  BlockInserterButton,
  defineBlock,
  defineBlocksExtension,
  type BlockDef,
  type BlockEntry,
} from "louisecms/client";
```

- `BLOCKS` — the registry that drives the `/` slash menu.
- `defineBlock` / `defineBlocksExtension` — author blocks outside the core set.
- `BlockInserter` / `BlockInserterButton` — the inserter UI.

## `injectStyles()`

```ts
function injectStyles(): void;
```

Ensures the shared Louise stylesheet (and edit-mode fonts) is present, even on a
page that has no inline fields — call it before opening a drawer on a bare page.
