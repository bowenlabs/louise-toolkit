---
"louise-toolkit": minor
---

Rich text can convert punctuation as the owner types, and mark a phrase as another language (#606).

- **`typography` on `RichTextFieldOptions`** (off by default): `--` becomes an em dash and `...` an ellipsis; with `quotes: "“”‘’"` (or any language's four marks), straight quotes become curly ones. There's no default quote pair, since they differ by language.
- **`language: true`** adds a Language button that wraps the selection in `<span lang="…">`. The editor keeps a stored `<span lang>` whether or not the button is on.
- **The sanitizer keeps `lang` on `span`** when its value looks like a BCP 47 tag, and drops it otherwise.

**Upgrading:** nothing is required.
