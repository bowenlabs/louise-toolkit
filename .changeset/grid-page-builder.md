---
"louisecms": minor
---

Grid page-builder + editor packaging fixes.

- **Adjustable grid blocks** (`louisecms/client`): a new `rowBlock` → `columnBlock`
  layout primitive whose column widths are freely adjustable. Rows serialize their
  track list to a sanitizer-validated inline `grid-template-columns` (fr weights),
  and the row node view offers preset layouts (1:1, 6:4, 1:1:1, 4:4:2, …),
  per-column width steppers, and add/remove column + add row. The legacy fixed
  two-column block still parses for back-compat.
- **Gallery block**: a responsive image grid (`data-block="grid"`) with a 2/3/4
  column switch.
- **Page templates**: `PageTemplate` + a `pageTemplates` option on the drawer
  config surfaces "start from a template" starter layouts in the Pages panel.
- **Structured sections** (`louisecms/client`): `mountSections`/`SectionsEditor` —
  a visual block builder for bespoke, component-rendered pages. Pages store an
  ordered array of typed section items (`{ _type, ...fields }`); the site renders
  each with its own component, so the design stays bespoke while editors add /
  reorder / remove sections and edit typed fields (text/textarea/array). Fine-
  grained `createStore` state so typing never rebuilds a row.
- **Type**: brand type is now **Roboto Flex** throughout (`theme/fonts.css` +
  client chrome); headings are the same family at a heavier weight (no Hepta Slab).
- **Sanitizer** (`louisecms/security`): the inline-`style` allowlist now accepts a
  value-validated `grid-template-columns` (numeric `%`/`fr`/`px`/`auto` tracks, no
  functions/urls) in addition to `color`, so adjustable-grid markup round-trips.
- **Fix**: `louisecms/editor` was declared in `exports` but missing from the build
  entry list, so `dist/core/editor/*` was never emitted — the subpath is now built.
