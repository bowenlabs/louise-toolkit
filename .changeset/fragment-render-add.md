---
"louise-toolkit": minor
---

Structural **add** is now instant — no more save-and-reload (#182 Phase 3 / ADR 0005 §4). "+ Add section" optimistically splices the new item into the store, POSTs it to a per-item **fragment-render route**, and inserts the returned server-rendered HTML in place (re-stamped to the target index, inline fields wired), then stages a draft via autosave. New `insertSectionElement(el, index, container)` in `louise-toolkit/client` places a fragment among the marked sections and re-stamps them 0…n (the add analogue of the reorder/delete DOM ops). The editor still authors **zero markup** — the server owns rendering.

**Consuming sites opt in** by providing the fragment route: an editor-gated Astro **partial** (`export const partial = true`) that reads a POSTed `{ item }`, forces edit mode, and renders `<Sections sections={[item]} />` — the toolkit POSTs to `/louise-fragment`. Sites without it degrade gracefully: the add falls back to the previous save-and-reload, so nothing breaks. (workers/site ships the reference route.)
