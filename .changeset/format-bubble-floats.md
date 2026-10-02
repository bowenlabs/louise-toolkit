---
"louise-toolkit": patch
---

The rich-text format bubble floats over the selection again, and a field edited on the page keeps its element's type (#761).

- **The bubble was always visible, in the page flow.** `RichText` rendered only ProseKit's inline popover root, with the toolbar inside it. In the current ProseKit the root only tracks the selection; the positioner places the bubble and the popup shows and hides it. `RichText` now renders both, so the toolbar appears over a selection and hides without one. The `.louise-format-bubble` class moves to the positioner, and the popup gets `.louise-format-popup`.
- **A heading edited in place dropped to the drawer's 14px.** The editing surface always carried `.louise-prose-surface`, sized for a field in the drawer. `mountRichText`, which only mounts on the canvas, now defaults to `surface: "canvas"`: the new `.louise-canvas-surface` inherits the host element's font, color, and spacing. An `inline` field's one paragraph is the editor's, so it takes the host's font and no margin; a prose body keeps the site's paragraph rules. `RichText` takes the same `surface` prop, with `panel` as its default, so a field in the drawer is unchanged.

**Upgrading:** two selectors can stop matching.

- A site rule on `.louise-prose-surface` for a field edited on the page no longer applies, because `mountLouise` and the sections editor pass no `class` and now get `.louise-canvas-surface`. Retarget the rule to `.louise-canvas-surface`. Where you call `mountRichText` yourself, `surface: "panel"` keeps the old class, and a `class` of your own still wins.
- A child rule such as `.louise-format-bubble > .louise-toolbar` no longer matches, because the class is on the positioner and the popup sits between it and the toolbar. Make it a descendant rule, or target `.louise-format-popup`. A rule that styled `.louise-format-bubble` in the flow as a workaround can go.
