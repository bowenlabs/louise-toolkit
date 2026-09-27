---
"louise-toolkit": minor
---

The editor chrome reads role tokens instead of color literals, every editable node rings in one color, and orange now means danger and nothing else (#603, ADR 0019 §3 and §4).

- **Role tokens:** every rule in the chrome's stylesheet reads a role, such as `--louise-surface`, `--louise-text`, `--louise-text-muted`, `--louise-border`, `--louise-accent`, `--louise-ring`, `--louise-success`, `--louise-warning`, or `--louise-danger`. Roles point at a small palette in the same `:root` block. About 235 literals are gone, and translucent tints are `color-mix()` of a token, so they follow it.
- **One ring:** every section, block, field, shared value, and external value rings in the brand blue (`--louise-node-ring`), with one toolbar color (`--louise-node-bar`). The toolbar's tag says what the node is, so color no longer has to.
- **Orange is danger:** errors, the danger button, the "poor" vitals badge, and the grammar underline use the theme's error orange, `#b8501f` (4.99:1), instead of red, since the palette has no red. Sections and Sign out, which were orange, are now the brand blue. The soft-lock badge, the missing-alt-text flag, and the "needs improvement" vitals badge use a warning amber, `#a16207`.
- **A type scale:** text sizes come from five steps, `--louise-text-2xs` (11 px at the default size) through `--louise-text-lg` (16 px). The 9 px and 10 px labels grow to 11 px, and the 15 px panel titles grow to 16 px.
- **Aligned digits:** the vitals readouts, the dashboard's counts, and the media panel's file sizes use `tabular-nums`.

What to know when you upgrade:

- These chrome tokens are gone: `--louise-yellow`, `--louise-violet`, `--louise-violet-strong`, `--louise-orange-strong`, `--louise-shared`, and `--louise-external`. `--louise-orange` changed from `#ea7317` to `#b8501f`. A site that overrode one of them should override the matching role instead, such as `--louise-danger` or `--louise-node-ring`.
- Owners see the change on the canvas: every ring is blue, and errors are orange instead of red.
- `data-louise-tone` is still set on the active node and the toolbar, so a site's own CSS keyed on it keeps working; the chrome just doesn't color by it.
- The chrome doesn't go dark yet. That's the next part of #603, once every rule reads a role.
