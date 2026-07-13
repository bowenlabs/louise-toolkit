---
"louisecms": patch
---

fix(client): make the inline editor chrome usable on mobile

- The structured-sections dock becomes a full-width bottom sheet on phones
  instead of a fixed 300px card that overflowed the viewport and sat under the
  edit bar.
- The shared edit bar docks to the top on mobile so the two floating bars no
  longer collide (the sheet owns the bottom thumb zone).
- The caret formatting toolbar is kept within the viewport (CSS `max-width`
  plus a left clamp in `ToolbarDock`) instead of bleeding off the right edge.
- Comfortable touch targets on coarse pointers (toolbar buttons, swatches,
  section-row ops, inputs, disclosure toggles), and a persistent
  ring + focus-revealed pencil on editable regions so they stay discoverable
  where there is no `:hover`.
