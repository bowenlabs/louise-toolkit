---
"louise-toolkit": patch
---

The rich-text format bubble floats over the selection again, and a field edited on the page keeps its element's type (#761).

- **The bubble was always visible, in the page flow.** `RichText` rendered only ProseKit's inline popover root, with the toolbar inside it. In the current ProseKit the root only tracks the selection; the positioner places the bubble and the popup shows and hides it. Both are rendered now, so the toolbar appears over a selection and is hidden otherwise. The `.louise-format-bubble` class moves to the positioner, and the popup gets `.louise-format-popup`.
- **A heading edited in place dropped to the drawer's 14px.** The editing surface always carried `.louise-prose-surface`, sized for a field in the drawer. `mountRichText`, which only mounts on the canvas, now defaults to `surface: "canvas"`: the new `.louise-canvas-surface` inherits the host element's font, color, and spacing, and its paragraph adds no margin. `RichText` takes the same `surface` prop, with `panel` as its default, so a field in the drawer is unchanged.

**Upgrading:** nothing to change. A site that styled `.louise-format-bubble` in the flow as a workaround can drop that rule. A site that passed `class` to `RichText` or `mountRichText` keeps its own surface.
