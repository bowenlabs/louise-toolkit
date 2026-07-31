---
"louise-toolkit": patch
---

Re-export `FieldOption`, `FieldOptions`, and `FieldOptionsResolver` from the `louise-toolkit/content` and `louise-toolkit/content/sections` entries. `SectionField.options` was already published typed as `FieldOptions`, but the option types themselves weren't reachable, so a site declaring a resolver-backed picker had to re-declare the shape structurally.
