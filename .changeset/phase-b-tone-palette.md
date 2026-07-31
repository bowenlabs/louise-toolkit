---
"louise-toolkit": minor
---

**The chrome palette now covers every `NodeTone`, and an unknown tone degrades visibly.**

`NodeTone` has reserved `shared` (green) and `external` (yellow) since A1, but
`TONE_CSS` only styled the three depth-derived tones. Returning one of the
reserved tones from `describeNode` rendered an *invisible* selection: the base
active rule set only `border-radius` (no ring), and the toolbar had no
background under its white glyphs. That failure reads as a resolver bug and
sends you debugging the wrong file — found while re-checking the Phase B
premises on #347.

Three changes, no behaviour change for the existing tones:

- **`shared` and `external` get ring + bar rules.** Each uses one value for
  both roles: `--louise-shared` (`#15803d`, 5.02:1 against white) and
  `--louise-external` (`#a16207`, 4.92:1) both clear the toolbar's 4.5:1
  (WCAG 1.4.3) without a darker `-strong` variant. External is deliberately
  NOT `--louise-yellow` — `#ca8a04` measures 2.94:1, failing the ring's 3:1
  as well as the bar's 4.5:1, and the token already carries save/publish
  semantics. Same reasoning gives `shared` its own token.
- **The base rules carry a slate fallback** (ring `#64748b`, bar `#475569`),
  so a tone the palette doesn't know paints a neutral ring and a legible bar
  instead of nothing.
- **The palette is one overridable block.** `--louise-violet` and the three
  `--louise-*-strong` values node-chrome reads were never declared anywhere —
  every reference fell through to its literal, so overriding a base colour
  recoloured the ring but not the toolbar. All are now declared in the
  `:root` block in `styles.ts` next to the tokens that already existed.
