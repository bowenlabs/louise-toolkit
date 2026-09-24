---
"louise-toolkit": patch
---

client: the Media panel reports every failed upload; and `unsavedChanges`, `settledSelect`, `uploadMediaFiles` for studio forms (#463)

**Fix: a multi-file upload in the Media panel showed only the last failure.** Each failure
overwrote the same alert. Pick three images, have two refused, and you were told about
one; if the last file succeeded, you were told nothing, and simply saw fewer images.
The panel now lists every file that failed and why: "2 of 3 didn't upload: …".

New in `louise-toolkit/client/studio`. The three are plain DOM, with no router
dependency:

- **`unsavedChanges(snapshot, { alsoDirty?, message?, confirm? })`**: the unsaved-changes
  guard. It compares the form's payload with its value at open, so no field has to mark
  itself dirty. `leave(go)` covers in-form exits. `shouldBlock` plugs into any router's
  blocker (TanStack: `useBlocker({ shouldBlockFn: guard.shouldBlock, enableBeforeUnload:
  guard.dirty })`). `watchUnload()` covers refresh and close, and `markSaved()`
  re-baselines after a save.
- **`settledSelect(commit)`**: handlers for a save-on-change `<select>` that holds
  arrow-key steps until Enter or blur, so arrowing through options doesn't save each one.
- **`uploadMediaFiles(files, { endpoint?, onUploaded? })`** / **`describeUploadFailures`**:
  the helper the panel now uses, for any form that uploads.

The routed studio shell from the same issue is split out to #488, because it needs a
decision on the router dependency first.
