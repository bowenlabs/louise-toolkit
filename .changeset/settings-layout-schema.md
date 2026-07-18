---
"louise-toolkit": minor
---

Sections and blocks gain **layout + settings** schema (#182 Phase 4 / ADR 0005 §5). `SectionItem` can carry a `_layout` token (one of `SectionDef.layouts`) and a `_settings` object; `BlockItem` carries `_settings` (against `BlockDef.settings`). `SectionDef` declares `layouts` (named variants, picker fodder for the inspector rail) and `settings` (non-inline fields — background, spacing, columns … reusing `SectionField`); `BlockDef` declares `settings`. `validateSections` now checks them: an unknown/undeclared `_layout` is rejected like an unknown `_type`, and `_settings` values validate against the declared setting fields with the same `Rule` machinery (undeclared keys ignored, absent `_settings`/`_layout` a no-op). Louise stores only tokens/values — never CSS; the site component reads `_layout`/`_settings` and owns the styling. Fully additive. The inspector-rail UI and a reference-slice render are the next slices.
