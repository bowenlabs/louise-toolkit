---
"louisecms": minor
---

**Auto-save for on-page editing.** Inline fields (`mountLouise`) and the sections
editor (`mountSections`) now persist edits automatically on a short idle debounce,
reusing each surface's existing save — a live field write, or a **draft** on a
versioned page. Publishing stays a manual, explicit action; auto-save never
publishes.

- On by default. Opt out with `autoSave: false`, or tune the delay with
  `autoSave: { debounceMs }` (default `800ms`). New `AutoSaveOption` export.
- With auto-save on, the manual **Save** / **Save draft** button is dropped in
  favour of the live status line; **Publish** is unchanged.
- Pending edits flush on blur, tab-hide, and navigation (the save `fetch` uses
  `keepalive` so it survives unload), with a browser warning while a save is still
  in flight. A failed save leaves the field dirty and retries on the next edit;
  overlapping saves are serialized so an edit made mid-save is never dropped.
