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
- **Consistent iconography**: the grid row controls and the sections dock now use
  the shared Phosphor `Icon` set instead of ad-hoc text glyphs; two new names
  (`caretRight`, `minus`) are added to the exported `icons`/`IconName`.
- **Page templates**: `PageTemplate` + a `pageTemplates` option on the drawer
  config surfaces "start from a template" starter layouts in the Pages panel.
- **Structured sections** (`louisecms/client`): `mountSections` — a visual block
  builder for bespoke, component-rendered pages. Pages store an ordered array of
  typed section items (`{ _type, ...fields }`); the site renders each with its own
  component, so the design stays bespoke. Editing is **hybrid**: text is edited
  **in place on the live render** — components stamp `data-louise-sfield` markers
  on their text nodes and `mountSections` makes them contenteditable, writing
  straight into a fine-grained `createStore` (so typing never rebuilds a row) — and
  a floating **control dock** handles what you can't point at: add / reorder /
  remove sections, array-item add/remove, and non-visible fields (a field can opt
  out of inline editing with `SectionField.inline: false`, e.g. a link URL). Text
  saves in place; structural changes persist then reload so the server re-renders
  the new shape.
- **Sections validation** (`louisecms/cms`): the section schema types now live in
  core, and `validateSections` / `assertValidSections` validate a `sections` write
  against the catalog — the value is an array, every item's `_type` is known, and
  each field matches its declared shape (with optional per-field `validation` Rule
  chains reused from the collection validator). `pagesRoute` gains a `validate`
  hook; a failed validation is a `422 { error, violations }` the dock surfaces.
- **`image` section fields**: a new field type edited via a dock upload / clear
  control (POSTs to the site's media route); the bespoke component renders the
  uploaded URL (e.g. a hero logo) or its own fallback. The dock also moved
  **Add section** beside **Save** under the footer divider.
- **Type**: brand type is now **Roboto Flex** throughout (`theme/fonts.css` +
  client chrome); headings are the same family at a heavier weight (no Hepta Slab).
- **Sanitizer** (`louisecms/security`): the inline-`style` allowlist now accepts a
  value-validated `grid-template-columns` (numeric `%`/`fr`/`px`/`auto` tracks, no
  functions/urls) in addition to `color`, so adjustable-grid markup round-trips.
- **Fix**: `louisecms/editor` was declared in `exports` but missing from the build
  entry list, so `dist/core/editor/*` was never emitted — the subpath is now built.
