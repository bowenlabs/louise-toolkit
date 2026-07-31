---
"louise-toolkit": patch
---

**`louise-toolkit/content` re-exports `FieldOption` / `FieldOptions` /
`FieldOptionsResolver`.**

`SectionField.options` is typed with `FieldOptions`, but the option types
themselves live in `core/content/field-types.ts` — a module the content barrel
doesn't include, and which `sections.ts` only type-*imported*. The published
entry therefore shipped a field whose type could not be named: a site declaring
a resolver-backed picker had to redeclare a structural stand-in
(`type FieldOption = { value: string; label?: string }`) to annotate its own
resolver.

They're now re-exported from `sections.ts`, alongside the existing
`isSafeLinkUrl` re-export, which covers both entries at once — the
`louise-toolkit/content` barrel and the drizzle-free
`louise-toolkit/content/sections`. Also un-dangles the
`{@link FieldOptionsResolver}` in `SectionField.options`'s doc comment, which
pointed at a symbol the module didn't export.

Types only — no runtime change.
