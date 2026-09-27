---
"louise-toolkit": minor
---

Structural edits on the canvas undo (#541). Deleting a section or block was instant and autosaved within a second, and Delete or Backspace on a focused node did the same, so the only way back was version history.

- **Undo:** Ctrl+Z or Cmd+Z reverses the newest structural edit, up to 20: deleting, moving, or adding a section or block, and the array-item and variant changes behind the wrench. The keystroke is left alone inside a text or rich-text field, which keep their own undo, and inside a dialog.
- **Notice:** a delete shows **Deleted Hero · Undo** in the edit bar, a `role="status"` region, for 8 seconds, held open while **Undo** has focus.
- **Scope of an undo:** each undo reverses only its own edit, not the whole page. A deleted element goes back as it was, with its paths restamped, so text typed elsewhere after the delete stays.
- **One media prompt:** deleting a media file that content still uses now asks once, naming where it's used, instead of twice in a row. `mediaRoute` and `listMediaRoute` answer a new `GET ?references=<key>` with `{ references }` for that. A server without it still works, with the old second prompt.

No site change is needed.
