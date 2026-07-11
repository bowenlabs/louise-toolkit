---
"louisecms": patch
---

Production-readiness pass from the package audit:

- `mediaMetaByUrl(db, table, base, urls?)` now takes an optional `urls` list and
  scopes the lookup to just those assets (a bounded `IN (…)` query) instead of
  scanning the whole `media` table — so the render-time asset-alt fallback stays
  cheap on a large library. Omitting `urls` keeps the previous full-table load.
- Declare `engines.node >= 20`.
