---
"louise-toolkit": patch
---

Error messages and editor UI copy follow the Google developer documentation style guide (ADR 0013). The words are the same; only the punctuation around them changed, so a spaced dash became a period, colon, semicolon, or comma. If you match on the text of these messages, check the new wording:

- `defineCollection` and `defineContent` errors for unindexable search fields, `realtime` without draft versioning, and duplicate collection slugs.
- `LocalApi` errors for an unregistered collection, a relationship to an unknown collection, and `search()` on a collection with no `search` config.
- The email error when no binding is configured.
- The editor's empty states in the media picker, upload field, pages panel, and health dashboard.
