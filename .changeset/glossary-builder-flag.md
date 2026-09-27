---
"louise-toolkit": minor
---

The page builder's flag is named for what it turns on, and the docs gain a glossary (#537).

"Block" meant three things: a section's blocks, the rich-text page builder's blocks, and the nodes a renderer registry maps. The flag that turns the builder on was called `blocks`, so it read as the first.

- **`builder` replaces `blocks`** on `RichText`, `mountRichText`, and a `richText` field's options (`RichTextFieldOptions`), and **`data-louise-builder="1"` replaces `data-louise-blocks="1"`** on an inline rich-text field.
- **`BuilderBlockDef`** from `louise-toolkit/client` names a builder block's schema. It was exported as `BlockDef`, the same name as a section's `BlockDef` in `louise-toolkit/content`, a different type.
- **Old names still work.** `blocks`, `data-louise-blocks`, and the client's `BlockDef` remain as deprecated aliases, so nothing breaks. Switch to the new names when you next touch that code.
- **Glossary.** A new reference page gives each content-model term one meaning (section, block, builder block, live, hidden, pending, superseded, and the rest) and the word the editor shows an owner.
