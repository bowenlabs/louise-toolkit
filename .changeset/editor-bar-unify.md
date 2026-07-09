---
"louisecms": patch
---

Unify the editor's save controls onto one bar, and tidy the sections dock.

- **One action bar.** The sections editor now renders its **Save draft** (green)
  and **Publish** (yellow) onto the shared edit bar (`.louise-bar`) — as text
  buttons matching Settings/Done — instead of a second set of buttons in the
  dock, so there's a single row of actions rather than two competing Save
  controls. The bar's own inline-field **Save** is omitted on pages that have no
  `data-louise-field`s (e.g. sections-only pages), where it was permanently dead.
- **Dock cleanup.** **Add section** moves above the version history and spans the
  full dock width, matching the section rows. The Save/Publish actions stay on the
  bar even when the dock is collapsed.
