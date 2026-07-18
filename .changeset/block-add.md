---
"louise-toolkit": minor
---

Blocks can now be **added** in place (#182 Phase 3 / ADR 0005 §4). The on-canvas block toolbar gains a `+` (add block after) button, and `mountSections` takes an optional `blocks` (`BlockCatalog`) so the editor knows a section's block palette. Adding a block inserts a blank of the section's allowed type, re-renders the whole section through the fragment route (blocks render inside their section's bespoke component, not standalone), swaps the section element in place, re-stamps + re-wires it, and stages a draft — no reload. New `replaceSectionElement(index, el)` in `louise-toolkit/client` swaps a re-rendered section in place. The `+` and the `blocks` catalog are both opt-in: without them the block toolbar stays move + delete only (the Phase 2 behaviour), and a multi-type block picker is a later slice (single-`allow` sections add their one type).
