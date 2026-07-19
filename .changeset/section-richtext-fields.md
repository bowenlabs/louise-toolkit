---
"louise-toolkit": minor
---

Add a `richText` section-field type — inline-editable prose stored as sanitized
HTML, edited in place with a **light** ProseKit editor (the format bubble only:
bold/italic/link/brand-colour — no block handles, headings, lists, or image
inserter). `RichText`/`mountRichText` gain a `minimal` option for this; the
section wiring mounts it when a field node carries `data-louise-type="richtext"`
and persists the field's HTML. New `sanitizeSectionsRichText(sections, catalog,
sanitize, blockCatalog?)` export sanitizes those fields on the write path (call it
from the collection `beforeChange`, next to the body sanitize) so section HTML is
never stored raw.
