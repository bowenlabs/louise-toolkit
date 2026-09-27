---
"louise-toolkit": minor
---

A site chooses the rich-text color swatches, and the default no longer offers the state colors (#605).

- **`colors` on `RichTextFieldOptions`:** a list of `{ label, token }` theme tokens, on a field or on the `mountSections` `richText` default. A field that names its own list wins, and an empty list hides the color button. A token must fit `--color-<token>` (lowercase letters, digits, and hyphens), or it's skipped.
- **The default is the brand roles:** primary, secondary, accent, and neutral. Info, success, warning, and error are no longer offered: text in a state color reads as a message, and a theme's error orange can turn red.

**Upgrading:** text already colored with a state token keeps its color; only the picker changed. To offer those colors again, or your own brand colors, pass `colors`.
