---
"louise-toolkit": minor
---

The **inspector popover** — the contextual editor for a section's layout + settings (#182 Phase 4 / ADR 0005 §5). The on-canvas chrome toolbar gains a ⚙ (wired via a new optional `onInspect` on the section/block chrome actions) that opens a small popover anchored to the selected element: a **layout picker** (sections with declared `layouts`) and a **settings form** (each `settings` field, reusing the dock's inputs). Picking a layout / committing a setting updates the store (`_layout` / `_settings`) and re-renders the section through the fragment route (the same seam as block add / swap-type), then autosaves — so the change shows on the real design with no reload. Blocks get the settings half (no layouts). Opt-in and additive: no `onInspect`/`layouts`/`settings` → no ⚙, unchanged behaviour. Outline-tree navigation and migrating the dock's per-item forms onto the rail are later refinements.
