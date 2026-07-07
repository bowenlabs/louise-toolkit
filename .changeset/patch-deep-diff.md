---
"louisecms": minor
---

`louisecms/cms` patch: `diffDocuments` is now a `_key`-aware deep diff. A changed
`blocks` array reports the specific sub-field that changed at a segmented path
(`FieldChange.path` is now `PathSeg[]`, e.g. `["blocks", { key }, "heading"]`)
instead of one opaque "blocks changed"; reordering blocks with unchanged content
is a no-op; block add/remove is reported at the block's key path. Adds a
`formatPath` display helper. The `computePatch`/`applyPatch` write path stays
top-level field-level (unchanged) — path-addressed write ops remain a future
Tier-2 concern.
