---
"louise-toolkit": minor
---

The sections editor gains a **type-switcher UI** for discriminated array fields (#182 Phase 0, completing the schema/validator from the previous release). When a `SectionField` array declares a `discriminator`, the dock renders one "add" button per variant (labelled/iconed from `variantsAdmin`) and a per-item variant `<select>`. Adding shapes the item as the shared `itemFields` ∪ the chosen variant's fields ∪ the discriminator key; switching preserves the shared field values while swapping in the new variant's blanks — via `reconcile`, so the previous variant's fields are dropped, not left merged on the item. Non-discriminated arrays render exactly as before.
