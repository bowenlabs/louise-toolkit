---
"louise-toolkit": minor
---

Sanitize `richText` inside `array` item fields.

`sanitizeSectionsRichText` walked one level — section fields and block fields — and its own docstring stated the assumption: *"Array item fields are not recursed — richText is a top-level section/block field."* But `SectionField` lets an `array` declare a richText item field, and a catalog promptly did: Astroid's `faq.items[].answer` is richText, rendered with `set:html`. An editor's FAQ answer was therefore stored exactly as typed and served to every visitor, leaving CSP as the only defence for a value the write path was supposed to have scrubbed.

`sanitizeItemRichText` now recurses through `itemFields` at any depth. Non-object rows and non-array values pass through untouched, and non-richText siblings are still left alone — sanitizing them would corrupt legitimate text containing angle brackets.

The rule this restores: anything the schema can express, the write-time sanitizer has to cover. A validator that accepts a shape the sanitizer skips is a hole by construction.
