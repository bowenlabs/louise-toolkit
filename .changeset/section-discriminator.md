---
"louise-toolkit": minor
---

Section `array` fields can now be a **discriminated union** of item shapes (#182 Phase 0). A `SectionField` of `type: "array"` accepts an optional `discriminator` — `key` + `variants` + `variantsAdmin` — mirroring `ArrayFieldConfig.discriminator` one level down, so one array field can hold heterogeneous "block" items (e.g. image vs. quote) instead of a single fixed `itemFields` shape. Each item's `key` value selects its variant, whose fields layer on top of the shared `itemFields`. `validateSections`/`assertValidSections` enforce it: an absent or unknown variant is rejected (like an unknown section `_type`), the selected variant's own field rules run, and other variants' fields stay out of scope. Fully additive — `discriminator` is optional and `array` storage is unchanged (still one JSON column). The editor's type-switcher UI is the next slice.
