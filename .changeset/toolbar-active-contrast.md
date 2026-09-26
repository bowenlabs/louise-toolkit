---
"louise-toolkit": patch
---

The active button in the rich-text toolbar now clears 4.5:1, the WCAG AA line for text. Its icon on the 12% blue tint was `--louise-blue-strong` (`#0f6ecd`), at 4.39:1. It now reads a new palette token, `--louise-blue-deep` (`#0b5cad`), at 5.76:1. The icon buttons only need 3:1, but a text label added to the toolbar later passes too. The tint stays at 12%, so the active state keeps its blue fill, apart from the gray hover.

`.louise-btn-primary:hover` reads the same token instead of its own `#0b5cad`, so its color doesn't change.

**What to do:** nothing. If you override `--louise-blue` and `--louise-blue-strong` to restyle the chrome, set `--louise-blue-deep` too, because the active toolbar icon and the primary button's hover now read it.
