---
"louise-toolkit": minor
---

Editor: the block toolbar's `+` opens a type-picker when a section accepts more than one block type.

**Why.** `addBlock` resolved the new block's type as `blocks.allow[0]` — the first
allowed type — so a section declaring `allow: ["image", "text", "button"]` could
only ever grow `image` blocks, and the other two were unreachable from the canvas.
That made the block layer usable for single-type sections only, which is not what
ADR 0005 §4 promises and is what blocked a block-capable Content section.

**What changed.** `+` now resolves the section's full allowed set and:

- **one type** — inserts it straight away, unchanged from before (no prompt for a
  choice that isn't a choice);
- **several types** — opens the same palette the section `+` uses, anchored under
  the block, labelled `Add a block`, dismissed on outside-press / Escape.

Insertion stays **after** the hovered block. That is deliberately the opposite of
the section `+` (which inserts *above*): a section list is navigated as a page you
push things down in, whereas a section's blocks read as a list you extend
downward.

**`allow` omitted now means "any block type".** ADR 0005 §4 always defined it that
way, but `allow?.[0]` on an absent `allow` yielded `undefined`, so `blocks: {}`
silently produced a dead `+`. Those sections now offer the whole `BlockCatalog`.
A section with no `blocks` policy at all is unaffected — it is not opted into the
block layer and gets no add affordance.

Block types listed in `allow` that have no `BlockCatalog` entry are dropped from
the picker rather than offered: without a field shape there is no blank to seed.
