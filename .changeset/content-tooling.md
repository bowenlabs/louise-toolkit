---
"louise-toolkit": patch
---

Content tooling fixes (#699):

- **`generateSchemaSource` emits `checkbox` fields** as the integer-as-boolean column `codegen` builds at runtime. It used to throw, so a site with a checkbox field couldn't generate its schema file.
- **`runMigration` takes a typed migration:** a `defineMigration<MyDoc>(…)` result no longer fails typecheck.
- **`runMigration` counts only the writes that land:** a document whose update fails is reported in `errors` alone, not also in `changed` and `changes`.
- **The `search.fields` type error** lists `json` among the indexable types.
