---
"louise-toolkit": minor
---

Every in-section structural edit is now instant — the last save-and-reloads are gone (#182 Phase 3 / ADR 0005 §4). The dock's variant **type-switcher** (swap-type), array **item add/remove**, discriminated **variant add**, and **media set** now route through a single `rerenderSection(i)` seam: mutate the store, re-render just that section through the `/louise-fragment` route, and swap its element in place (re-wired, draft staged) — no page reload. Falls back to save-and-reload when the section isn't on the live rendered page or the fragment can't render, so nothing is lost. Only loading a *different* draft version still reloads (it swaps the whole document). Purely internal to the sections editor — no API change.
