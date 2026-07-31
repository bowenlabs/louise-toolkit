---
"louise-toolkit": minor
---

**The green ring works: shared site-settings values are editable on-canvas.**

ADR 0010 Phase B, slice B5 (#376) — the last reference-ring slice. A site
declares its on-canvas-editable settings keys at mount:

```ts
mountSections(el, {
  …,
  shared: {
    phone: { type: "text", label: "Phone number", surfaces: ["the header"] },
  },
})
```

and stamps `data-louise-node="settings.<key>"` wherever the value renders —
the Nav, the Footer, a location panel; outside the sections host is fine
(#377 made the lookups document-wide for exactly this). A declared key
resolves to a **green, wrench-only** node named after the value. Its
inspector is the one panel whose writes do NOT stage into the page draft:

- **The warning band is persistent**, not a `confirm()`: *"Used in the header
  and 3 pages — saves immediately, everywhere."* The count is assembled from
  the def's static chrome `surfaces` plus the pages whose stored sections
  include a type whose catalog def `consumes` the key (spec §3, approach A —
  the declaration doubles as documentation of a coupling that was invisible).
- **Saves PATCH `/api/louise/settings` on commit** — immediate and
  unversioned by decision (spec §4); a failed save keeps the optimistic value
  on screen with the error.
- **Every marker syncs after a save**: the Nav renders a value twice
  (desktop + mobile), and updating one would leave the page lying about the
  other. Plain-text values only; richer renders get their truth next load.

`InspectTarget` gains the `{ kind: "shared"; key }` arm; an undeclared
settings key stays unmarked, the same stale-marker rule as every other path.
