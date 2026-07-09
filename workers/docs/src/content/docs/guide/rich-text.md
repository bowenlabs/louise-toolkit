---
title: Rich text
description: The ProseKit editor, HTML storage, sanitization, and images.
sidebar:
  order: 4
---

Louise's rich-text editor is [ProseKit](https://prosekit.dev) (Solid) —
`louisecms/client`'s `RichText` — used identically by inline fields and
by any drawer form a host app builds.

## HTML in, HTML out

**Storage is HTML, not JSON.** The editor serializes with `htmlFromNode`
client-side; the site stores that HTML and renders it back with `set:html`. No
ProseMirror runs on the Worker. On load, the editor re-parses the stored HTML.

Two rendering rules follow from this:

- Rich fields render as **`<div>`, never `<p>`** — the editor's wrapper is a
  block element, and a `<div>` inside a `<p>` is invalid HTML.
- ProseKit's `htmlFromNode` wraps every payload in a `<div>`. Your sanitizer's
  allowlist **must include that wrapper** — a parser-based sanitizer drops
  disallowed elements _with their children_, so omitting `div` silently wipes
  every save.

## Sanitize on the write path

Because stored HTML is rendered verbatim, the save endpoint is the security
boundary. Sanitize with a **parser-based allowlist**, not a regex stripper
(which nested or split tags can bypass):

- Only formatting tags survive; attributes are a strict **per-tag** allowlist.
- `href`/`src` are scrubbed of `javascript:` / `data:`; inline `style` is
  limited to a single `color:` declaration (so the editor's text-color mark can
  round-trip).
- `<img>` is allowed with `width`/`height`. **SVG is not** — a public media
  domain rendering arbitrary SVG/HTML is a hosted-content risk.
- Block containers (`section`/`figure`/`figcaption`/`hr`, plus `div`/
  `blockquote` with a filtered `class` allowlist) are permitted for the
  [page builder](/guide/page-builder/); iframes stay banned.

## The toolbar

The toolbar is a **selection-based floating popover** (ProseKit's
`InlinePopover`, hoisted into the top layer) — it appears over selected text
rather than always showing. It offers bold / italic / underline / strike,
H2 / H3, bullet & numbered lists, quote, image, and brand text colors. Icons are
Phosphor SVGs inlined raw, so they're CSP-safe (no external requests, no inline
`<script>`).

## Images

Paste, drop, or the toolbar button upload to your media endpoint (typically R2 —
see [Media](/guide/media/)) and insert an `<img>`. A
resizable node view lets an editor drag the corner; the size persists as
`width`/`height` attributes. A block drag handle reorders blocks.

## Using it directly

```tsx
import { RichText } from "louisecms/client";

<RichText
  value={html}
  onChange={(next) => save(next)}
  // `blocks` enables the page-builder slash menu; omit for plain prose fields.
/>;
```

For inline `[data-louise-field]` markers you don't call `RichText` yourself —
[`mountLouise`](/guide/inline-editing/) mounts it for you. `RichText` is
exported for the structured forms a host app builds in its drawer.
