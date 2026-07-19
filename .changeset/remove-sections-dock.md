---
"louise-toolkit": minor
---

Remove the floating "Page sections" dock (#182) — the sections editor is now
fully on-canvas. Everything the dock owned relocated:

- **Per-section editing → the ⚙ inspector.** The inspector popover already held
  layout + settings; it now also edits the section/block's non-inline **fields**
  (link URL, image, token) and its **array membership** (per-variant add, per-item
  variant switcher, remove), so the dock's form is no longer needed.
- **Reorder / delete → the on-canvas toolbar.** Section and block move-up /
  move-down / delete already live on the hover toolbar (`chrome.ts`); the dock's
  duplicate row controls are gone.
- **Save / Publish / status / History → the shared edit bar** via
  `.louise-bar-actions` (a fixed fallback strip when no `.louise-bar` exists).
- **Add section → an on-canvas floating control** (same palette markup).
- **Version history → a dedicated right-side drawer** opened from the bar's
  History button (reuses the Louise drawer visual family). New `history` icon.

Net effect: no floating panel, no drag-to-move, no collapse toggle — you edit on
the real design, with page-level actions on the bar. The store, autosave, inline
wiring, and structural fragment routes are unchanged.
