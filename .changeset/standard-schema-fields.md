---
"louise-toolkit": minor
---

Add `louise-toolkit/schema`: Standard Schema (https://standardschema.dev) support with a zero-dependency `s.*` builder, a `standardValidate` runner that folds any Standard Schema's result into Louise's `ValidationViolation` shape, and `parseOrThrow`.

Form fields (`FormField`) and collection fields (`FieldConfig`) now accept a `schema` — any Standard Schema (Zod/Valibot/ArkType or the built-in `s.*` builder) — run in the shared client+server validation pass alongside the existing zero-dep `Rule` engine, which stays the default. Empty values are skipped so optional fields stay optional. (#98)
