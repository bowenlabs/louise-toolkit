---
"louise-toolkit": patch
---

Three active controls that put blue on a blue tint now clear 4.5:1, the WCAG AA line for text. Each colored its foreground with `--louise-blue-strong` (`#0f6ecd`), and the tint behind it cost that blue its margin. They now read a new palette token, `--louise-blue-deep` (`#0b5cad`), one stop darker. The tints don't change, so each active state keeps its blue fill, apart from the gray hover and the unfilled rest.

- **The active rich-text toolbar button**, on its 12% tint: 4.39:1 to 5.76:1. The icon buttons only need 3:1, but a text label added to the toolbar later passes too.
- **The active drawer tab**, a text label on a 10% tint: 4.49:1 to 5.89:1.
- **The drawer's Settings cog while Settings is open**, on the same 10% tint: 4.49:1 to 5.89:1.

`.louise-btn-primary:hover` reads the same token instead of its own `#0b5cad`, so its color doesn't change.

**What to do:** nothing. If you override `--louise-blue` and `--louise-blue-strong` to restyle the chrome, set `--louise-blue-deep` too, because these three active states and the primary button's hover now read it.
