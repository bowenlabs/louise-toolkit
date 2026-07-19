---
"louise-toolkit": minor
---

Drop the routine save-status text from the sections edit bar. With auto-save on
(the default), drafts stage on a debounce and flush on navigation, so the
"Saving… / Draft saved / Unsaved / Draft" line is redundant noise — the bar now
shows **History + Publish** only. A *failed* save still surfaces (red, error-only),
since it must never be silent and the Publish button doesn't report it. The
manual Save-draft button is unchanged for hosts that opt out with `autoSave: false`.
