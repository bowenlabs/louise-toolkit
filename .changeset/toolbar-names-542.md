---
"louise-toolkit": minor
---

The node toolbar says what it acts on, and its add button says where it adds (#542).

- **One direction:** a section's `+` inserted a new section above it while a block's inserted below, under the same "Add Hero after" label. Both now insert below, labeled "Add section below" and "Add block below," and the section picker opens under the section it adds after. ADR 0010 records the choice.
- **A visible name:** the toolbar shows the node's kind and name at its leading edge, such as "Section · Hero," and uses the same text as its `aria-label` instead of "Editor actions." The kind was told only by ring color before.
- **Shortcuts in tooltips:** "Move up (Alt+Up)," "Move down (Alt+Down)," and "Delete Hero (Delete)." The shortcuts were in `aria-keyshortcuts` only, so a sighted keyboard user couldn't learn them.

What to know when you upgrade: an owner used to a section's `+` adding above it now gets the new section below. A test that looked for the toolbar's "Editor actions" name or an "Add … after" label needs updating.
