---
"louisecms": minor
---

Add stega (steganographic) auto-tagging for visual editing (#23), a companion to
the manual `editAttr()` path. New `louisecms/stega` export: `stegaEncode` /
`stegaDecode` / `encodeDocument` / `defaultStegaFilter` embed an invisible
`EditRef` inside a field's rendered text, so prose becomes a click-to-edit
target with no wrapper element (built on `@vercel/stega`, an optional peer).
`mountVisualEditing` gains an injected `resolveStega` for text-node hit-testing
(hybrid with `data-louise-edit` element targets). The client save path now
`stegaClean()`s every value (via a dependency-free stripper) so invisible
payload never round-trips into stored HTML / ProseMirror JSON. Encoding is
preview-only.
