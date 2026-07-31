---
"louise-toolkit": minor
---

**The yellow wrench works: an external section's inspector gains its source-settings group.**

ADR 0010 Phase B, slice B4 (#375). A section declaring the object form of
`source` now opens a two-group inspector:

- **Source settings first** — the mirror's knobs (which category, which items
  hidden), declared as `SectionField`s under `source.settings` and stored in
  the site-settings `custom` JSON under `source.settingsKey`. They PATCH
  `/api/louise/settings` the moment a value commits — shared by every page,
  so they cannot ride the page draft — and the group's caption says so:
  "Save immediately, everywhere this content appears." A failed save keeps the
  optimistic value on screen **with** the error, so the editor knows the page
  and the store disagree. After a save the section re-renders through the
  fragment route, so the canvas reflects the new source config.
- **Everything else unchanged** — the section's own fields, arrays, and layout
  keep staging into the draft exactly as before.

Supporting pieces:

- `SectionDef.source` widens to `"external" | ExternalSource` (`kind`,
  `label`, `settingsKey`, `settings`); `externalSourceOf` normalizes the two
  forms. A section whose *only* knobs are source settings still gets its
  wrench.
- `SectionField.multiple` (select only): the value is a string array, rendered
  as a checkbox list over the same literal-or-fetched options, validated
  member-wise with the same resolver exemption as single selects — the shape a
  mirror's filter lists need.
