---
"louise-toolkit": minor
---

**A node's source is now a first-class property — ring colour becomes f(source).**

ADR 0010 Phase B, slice B2 (#373). Two declarations and one resolver change,
exactly at the seam A1 reserved for them:

- `SectionDef.source?: "external"` marks a section whose content mirrors a
  system the site doesn't own (a Square-backed grid). `describeNode`'s section
  arm tones it `external` (yellow) instead of `section`; its position, layout,
  and inspector capabilities are untouched — the page still owns those.
- `SectionDef.consumes?: string[]` names the site-settings keys a section reads
  when it renders — a coupling that was invisible inside the site's Astro
  components, and the input to the "used in N surfaces" count the shared-value
  editor will show (slice B5).
- `describeNode` gains the `["settings", key]` arm: a
  `data-louise-node="settings.<key>"` marker resolves to a wrench-only node
  toned `shared` (green) when the key is declared in the new
  `DescribeContext.shared` map — and to `null` (unmarked) when it isn't, the
  same stale-marker rule as every other path.

Nothing passes `shared` or declares `source` yet, so no editor behaviour
changes until the inspector arms land (B4/B5). The chrome needs no change at
all — which was the point of the seam.
