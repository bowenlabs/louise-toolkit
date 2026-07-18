---
"louise-toolkit": minor
---

Section **reorder and delete are now instant** (#182 Phase 1 / ADR 0005 §4). Moving a section up/down or deleting it (from the on-canvas toolbar or the dock) reconciles the store and mirrors the change on the already-rendered DOM — relocating/removing the marked section element and re-stamping the `data-louise-section` **and** `data-louise-sfield` markers — then stages a draft via autosave. No more save-and-reload round-trip for these ops, and inline editing stays aligned across a reorder (`wireInline` now re-reads the marker rather than closing over it). New `chrome.ts` helpers: `restampSection`, `moveSectionElement`, `deleteSectionElement`. Add / array-item structural ops still reload for now — they need markup that doesn't exist yet (the Phase 3 fragment-render route).
