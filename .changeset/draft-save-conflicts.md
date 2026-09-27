---
"louise-toolkit": minor
---

A draft save can now tell that someone else saved first (#572). Before, a save merged over the freshest pending work with no idea what the editor last saw, so an owner with the page open in two tabs, or an agent saving while the owner typed, silently overwrote the other's changes field by field.

Every field now has a revision, a short hash of its stored value. `GET /:id/versions` returns the current ones as `revs`, and every draft save returns the revisions of the fields it stored. A save that sends its starting revisions under `$base` gets a `409` with `conflicts` (each field's current `value` and `rev`) when a field it sets has changed since, unless both ended up at the same value. `applySaveDraft` takes them as a sixth argument, `{ base }`, and `fieldRev`, `fieldRevs`, `parseDraftBase`, and `DRAFT_BASE_KEY` are exported from `louise-toolkit/editor`.

The inline editor and the sections dock send `$base` and show a conflict as a choice: **Keep mine** saves again over their edit, **Reload** loads theirs. Auto-save holds off until the owner picks.

What to know when you upgrade:

- A save without `$base` is unchecked, so scripts and older clients behave as before. The realtime session and the MCP write tools don't send it.
- With the KV draft buffer on, the check narrows the window between two saves; it doesn't close it, because KV isn't atomic.
- A site that wraps `actions.louise.saveDraft` for `mountLouise({ actions })` must resolve with the Action's result, as the option already documents, so a returned conflict reaches the editor.
- The sections dock no longer reports "Couldn't save" when the KV buffer absorbs a save. It treated a save with no new version ID as a failure, which on a buffered site was most of them.
