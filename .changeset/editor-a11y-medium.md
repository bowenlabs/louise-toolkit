---
"louise-toolkit": minor
---

Second accessibility pass over the editor — names, semantics, alt text, and contrast.

**Inline images can carry alt text, and no longer lose it (WCAG 1.1.1).** ProseKit's image node ships only `src`/`width`/`height` and serializes exactly those, so an image placed in rich text reached the published page with no description — and any authored `alt=` was silently dropped the first time the field round-tripped through the editor. The image node now has an `alt` attribute that both serializes to `<img alt>` and parses back, plus an on-image control to write it (the badge reads "Alt?" in amber until a description is set). The sanitizer already allowed `alt` on `img`, so it persists end to end.

**Inline editables and inputs have accessible names (WCAG 1.3.1 / 3.3.2 / 4.1.2).** Inline `contenteditable` fields announced only as "edit text" — their sole hint was CSS `::before` content, which is not an accessible name. They now carry `role="textbox"`, `aria-multiline` where applicable, and a name taken from the field's own label. Placeholder-only inputs (invite first/last/email, link label + URL, image URL, Pages search) gained real labels, and the media-library thumbnails — buttons with no text and only a `title` — now have proper names.

**Popup menus tell the truth and dismiss (WCAG 4.1.2 / 2.1.1).** The add-section palette, block-add menu, AI rewrite menu, and colour swatches all declared `role="menu"`/`menuitem`, promising arrow-key roving that was never implemented. They're now labelled button groups — honest semantics for what they are, plain buttons in the tab order — with `aria-haspopup`/`aria-expanded`/`aria-controls` on every trigger, and Escape or an outside press to dismiss (Escape returns focus to the trigger).

**Contrast now clears AA (WCAG 1.4.3).** Measured and fixed: success green on white 3.30:1 → 5.02:1, slate-400 body text 2.56:1 → 4.76:1, empty-field placeholder 2.22:1 → 4.69:1, and the white glyphs on the on-canvas toolbars 3.02:1 → 5.02:1 (section) and 3.88:1 → 5.08:1 (block). The section/block rings keep their brand colours — they're non-text graphics and already clear the 3:1 bar; only the bars carrying white labels darkened. Primary buttons move one stop down the existing brand ramp (3.88:1 → 4.68:1), to a blue that was already the button's own hover.
