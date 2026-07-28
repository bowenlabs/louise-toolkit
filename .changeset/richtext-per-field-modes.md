---
"louise-toolkit": minor
---

`richTextModes` — per-field rich-text presets for section fields.

**Why.** `SectionsEditorProps.richText` applied one options object to *every*
`data-louise-type="richtext"` field on the page, which falls apart as soon as a
site has both kinds of rich text. A site whose headings need `inline` (so editing
an `<h1>` can't produce a nested `<p>` that loses the brand style) was forcing that
same single-line mode onto prose bodies, where it suppresses exactly the block
formatting — paragraphs, lists — that a body needs.

A render now opts an individual field into a named preset by stamping
`data-louise-rt` beside the type marker:

```ts
mountSections(el, {
  richText: { inline: true },                              // every heading
  richTextModes: { prose: { minimal: false, grammar: true } }, // opted-in bodies
});
```

```astro
<div data-louise-type="richtext" data-louise-rt="prose" set:html={body} />
```

Resolution is per field: the named mode, else `richText`, else the light-inline
bubble. An **unknown** mode name falls back to the site default rather than
throwing — a render stamped for a mode the mount doesn't declare should degrade to
the default, not lose its editor.

Fully additive: a mount that sets no `richTextModes` behaves exactly as before.
