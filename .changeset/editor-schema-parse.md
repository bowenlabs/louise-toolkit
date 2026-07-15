---
"louise-toolkit": patch
---

Editor route handlers now parse request bodies with `louise-toolkit/schema`'s `s.*` builder + `standardValidate` instead of casting untrusted JSON to a type and hand-checking it. `save`, `media`, `settings`, `settings-blob`, `pages`, `versions`, `editors`, and `form` each declare their body shape once; the parse drops unknown keys and rejects malformed bodies consistently (e.g. an array is no longer accepted where an object is expected). Error messages and status codes are unchanged. (#96)
