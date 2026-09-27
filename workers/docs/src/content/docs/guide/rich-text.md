---
title: Rich text
description: The ProseKit editor, HTML storage, sanitization, and images.
sidebar:
  order: 4
---

Louise's rich-text editor is [ProseKit](https://prosekit.dev) (Solid)—`louise-toolkit/client`'s `RichText`—used identically by inline fields and
by any Settings form a host app builds.

## HTML in, HTML out

**Storage is HTML, not JSON.** The editor serializes with `htmlFromNode`
client-side; the site stores that HTML and renders it back with `set:html`. No
ProseMirror runs on the Worker. On load, the editor re-parses the stored HTML.

Two rendering rules follow from this:

- Rich fields render as **`<div>`, never `<p>`**—the editor's wrapper is a
  block element, and a `<div>` inside a `<p>` is invalid HTML.
- ProseKit's `htmlFromNode` wraps every payload in a `<div>`. Your sanitizer's
  allowlist **must include that wrapper**—a parser-based sanitizer drops
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
- `<img>` is allowed with `width`/`height`. **SVG is not**—a public media
  domain rendering arbitrary SVG/HTML is a hosted-content risk.
- Block containers (`section`/`figure`/`figcaption`/`hr`, plus `div`/
  `blockquote` with a filtered `class` allowlist) are permitted for the
  [Louise Builder](/guide/builder/); iframes stay banned.

## The toolbar

The toolbar is a **selection-based floating popover** (ProseKit's
`InlinePopover`, hoisted into the top layer)—it appears over selected text
rather than always showing. It offers bold / italic / underline / strike,
H2 / H3, bullet & numbered lists, quote, image, and brand text colors. Icons are
Phosphor SVGs inlined raw, so they're CSP-safe (no external requests, no inline
`<script>`).

### Text colors

A text color is stored as a theme token, `color: var(--color-<token>)`, so the
text follows a re-theme with no content rewrite. By default the popover offers
the brand roles: primary, secondary, accent, and neutral. The state colors
(info, success, warning, error) aren't offered, because text in them reads as a
message, and a theme can change what they look like.

The palette is a brand fact, so pass your own as `colors`, a list of
`{ label, token }`. Any token works that your theme defines as
`--color-<token>`. Set it on a field, or for every field on the `mountSections`
`richText` default; a field that names its own list wins, and an empty list
hides the color button.

```ts
mountSections(host, {
  catalog,
  richText: {
    colors: [
      { label: "Brand orange", token: "brand-orange" },
      { label: "Ink", token: "neutral" },
    ],
  },
});
```

### Punctuation and other languages

Two options on a rich-text field, both off by default:

- **`typography`** turns on input rules as the owner types: `--` becomes an em
  dash and `...` an ellipsis. Add `quotes`, the four marks your language uses
  (opening and closing double, then opening and closing single), and straight
  quotes become them: `typography: { quotes: "“”‘’" }` for English,
  `"«»‹›"` for French. There's no default pair, because quote marks differ by
  language. A paste isn't converted, and undo right after reverts a rule.
- **`language: true`** adds a Language button to the format bubble. It marks the
  selection with `<span lang="…">`, so a screen reader pronounces the phrase in
  its own language. The tag must look like BCP 47 (`fr`, `pt-BR`); the
  sanitizer keeps `lang` on a `span` only in that shape. A stored
  `<span lang>` survives editing whether or not the button is on.

## Images

Paste, drop, or the toolbar button upload to your media endpoint (typically R2—see [Media](/guide/media/)) and insert an `<img>`. A
resizable node view lets an editor drag the corner; the size persists as
`width`/`height` attributes. A block drag handle reorders blocks.

## Using it directly

```tsx
import { RichText } from "louise-toolkit/client";

<RichText
  value={html}
  onChange={(next) => save(next)}
  // `builder` enables the page builder's slash menu; omit for plain prose fields.
/>;
```

For inline `[data-louise-field]` markers you don't call `RichText` yourself—[`mountLouise`](/guide/inline-editing/) mounts it for you. `RichText` is
exported for the structured forms a host app builds in its Settings.
