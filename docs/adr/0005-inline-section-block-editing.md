# ADR 0005: Inline section and block editing with on-canvas chrome, a block layer, and the fragment-render contract

- **Status:** Implemented (2026-07-19, #182). Proposed 2026-07-18. **§2 (the three-attribute marker contract)
  and §3 (the per-layer chrome) are superseded by [ADR 0010](./0010-editable-node-model.md)**
  (2026-07-28). The fragment-render contract, instant structural ops, and the
  inspector stand and are generalized there. Note especially that this ADR's
  "blocks are flat; they do not nest in v1" is a limitation of the hand-rolled
  layer model, not a product decision.
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0003 (Astroid `<Section>` / `<Editable>` primitives), ADR 0001
  (opinionated where it's expensive), #12 (structure builder), #13 (block
  registry), #68 (autosave), epic #102, milestone "Platform features push"
- **Scope:** `packages/louise/src/client` (the sections editor and editor chrome)
  and `packages/louise/src/core/content` (the sections and blocks schema and
  validator), plus the site-side render contract. No styling system changes.
- **Reference prototype:** an interactive concept mockup drove this design:
  on-canvas section (orange) and block (blue) chrome, rich text with brand colors,
  drag-to-reorder, the inspector rail, the bottom edit bar and Settings drawer, and
  mobile. <https://claude.ai/code/artifact/c5ce30aa-9e7e-4efc-bee6-5a980b9cbb9d>

## Context

A Louise **section** is one item of a page's `sections` JSON array
(`{ _type, ...fields }`) that the _site_ renders with its own bespoke component.
Louise owns editing only (`core/content/sections.ts`, `client/sections.tsx`).
Field types are `text` / `textarea` / `array` / `image`, and the **only** nesting
available today is a `type: "array"` field with a single _homogeneous_ `itemFields`
shape (for example, `featureGrid.items`). Editing is **hybrid**: visible text is
edited in place over the real render through `data-louise-sfield="<i>.<key>"`
markers. Everything structural (which sections exist, their order, array
membership, and any non-visible field) lives in a floating **dock** (bottom-left).
Structural changes do `save-draft → reload` so the server can re-render the new
shape.

That model has a gap and a contradiction:

- **Gap.** There's no way to organize the pieces _within_ a section, to swap one
  component for another, or to change a section's layout. A section is a monolith
  with a flat field set (plus one homogeneous array).
- **Contradiction.** Louise's whole thesis is _"edit in place on the real design."_
  The dock is the one surface that breaks it: a side panel of proxy controls for
  things you're looking straight at. It's also the surface that forces a reload
  on every structural edit.

Two pieces of chrome are **not** in question and stay exactly as they are: the
unified **edit bar** (`createChrome` → `.louise-bar`, the bottom-center glassy
pill that owns Publish, save status, Settings, and Done) and the **Louise Settings
drawer** (`client/settings/shell.tsx`, the right-side back-office surface). This
ADR replaces only the floating **sections dock**. The dock already relocates its
Save/Publish onto the edit bar (`.louise-bar-actions`), so removing it is largely
subtractive.

Like ADR 0002/0003, this ADR fixes the design forks **before** any code, so the
implementation PRs have a fixed target. It follows ADR 0001's rule (_opinionated
where it's expensive, framework-agnostic where it's free_) and reuses the
existing schema, validator, marker, and editor machinery rather than forking new
paths.

## Decision

### 1. A first-class `blocks` layer on sections: generalize the discriminator

`SectionItem` gains an optional `blocks` array of polymorphic children, described
by a `BlockCatalog` that mirrors `SectionCatalog`. This is the sections analog
of `ArrayFieldConfig.discriminator` (`core/content/types.ts`) one level up: the
same `_type`-selects-a-field-map model that sections already use, nested.

```ts
interface BlockItem {
  _type: string;
  [key: string]: unknown;
}

interface SectionItem {
  _type: string;
  blocks?: BlockItem[]; // NEW — the organising layer
  [key: string]: unknown; // direct fields still allowed (back-compat)
}

interface SectionDef {
  label: string;
  icon?: string;
  fields: Record<string, SectionField>;
  blocks?: { allow?: string[]; min?: number; max?: number }; // NEW
}

type BlockCatalog = Record<string, BlockDef>;
interface BlockDef {
  label: string;
  icon?: string;
  fields: Record<string, SectionField>;
}
```

Block fields reuse `SectionField` **verbatim**, so `validateSectionField` extends
with one `blocks` branch (each block validated against `BlockCatalog[block._type]`,
recursively) and the `Rule` chain still applies. Storage doesn't change, and
`sections` stays one JSON column. Everything is additive. `blocks` is optional,
existing catalogs and the four dogfood sites are untouched, and a section may mix
direct fields _and_ blocks during a transition.

**Ship it incrementally.** First, land `discriminator` support on `SectionField`
type `array`. The concept is already specced on the collection side
(`ArrayFieldConfig.discriminator`, with `variants` / `variantsAdmin`). That
delivers "swap a block within a field" and forces the type-switcher UI to be built
once. Then promote to a first-class `blocks` array on `SectionItem`.

### 2. The site owns rendering one level deeper: the marker contract

Rendering a section becomes what the page already does, nested: map
`block._type → component` exactly as the page maps `section._type → component`.
The site stamps two new markers alongside the existing `data-louise-sfield`:

```astro
<section data-louise-section={i}>
  <div data-louise-block={`${i}.blocks.${j}`}>
    <h2 data-louise-sfield={`${i}.blocks.${j}.heading`}>{heading}</h2>
  </div>
</section>
```

`data-louise-section="<i>"` and `data-louise-block="<i>.blocks.<j>"` give the
client boundaries to draw chrome on, and the `data-louise-sfield` path deepens
to `<i>.blocks.<j>.<key>`. Crucially, `pathToArgs` / `wireInline` and the
fine-grained store setter (`set("items", ...pathToArgs(path), value)`) are already
depth-agnostic. They split on `.` and coerce numeric segments, so **in-place
text editing needs no client change** for nested blocks.

This is the natural home for ADR 0003's primitives. `<Section>` reads `_layout` /
`_settings` (§5) and slots its children, and `<Editable>` already owns the
`data-louise-*` marker contract, so a site author writes `<Editable field="heading">`
and never hand-stamps the deeper path. The generic `createBlockRegistry`
(`core/content/blocks.ts`, from #13) resolves `block._type → renderer`, which gives
that module a second, aligned use.

### 3. On-canvas chrome replaces the floating dock, and the bar and drawer stay

Delete the bottom-left sections dock. Its per-item structural controls move onto
the canvas as overlay chrome, and its Save/Publish already live on the edit bar.
The edit bar (`.louise-bar`) and the Settings drawer are unchanged.

- **Rings** are drawn as `box-shadow` _on the section or block element itself_, so
  they're never clipped by an `overflow` ancestor and never mismeasured against a
  separate overlay. **Toolbars** are `position: absolute` children, and **"+"
  inserters** sit between siblings. Hit-testing is **deepest-boundary-wins** (a
  block hover doesn't light its parent section), and `:has()` suppresses the
  parent-section toolbar while a block is active.
- **Color coding.** Orange = the section layer, blue = the block layer. This
  overlaps the edit bar's own blue = Settings / orange = Done. That's accepted and
  recorded here: the two are disambiguated by _treatment_ (glassy pill text
  buttons versus on-canvas outline rings), not hue.
- **Autosave is the only save path** (#68). Edits stage a draft on an idle
  debounce, the bar shows live status (Unsaved → Saving… → Draft saved) plus
  Publish, and there's no manual Save button. Autosave never publishes.
- **Three surfaces, three scopes**, kept distinct: the **edit bar** acts on the
  _page_ (publish, status, settings, done), the **Settings drawer** on the _site_
  (pages, media, users, health), and the new **inspector rail** (§5) on the
  _selected element_.

### 4. Structural ops: instant where the markup exists, a fragment route where it doesn't

Structural edits reload today because only the server can render the site's
components. That constraint splits cleanly, and most of it dissolves:

- **Reorder / delete / duplicate** move or clone DOM nodes that are _already
  rendered_ and reconcile the store, with **no server, no reload**. This is the
  headline win over today's reload on every structural change.
- **Add / swap-type** need markup that doesn't exist yet. Add a **per-item
  fragment-render route**. POST the one item (`{ _type, ...fields }`, or the
  section's `{ blocks: [...] }`), the server renders _that item_ through the same
  section render path and returns its HTML, and the client splices it in and
  re-runs `wireInline` on it. There's no full reload, and the editor still authors
  **zero markup**, because the server owns rendering (ADR 0001). This supersedes
  the current save-draft-and-reload for structural edits.

### 5. Settings and layout: an inspector rail over `_settings` and `_layout` tokens

```ts
interface SectionItem {
  _layout?: string; // a named layout variant
  _settings?: Record<string, unknown>; // background, spacing, columns, alignment…
  // …
}
interface SectionDef {
  layouts?: Record<string, { label: string }>; // the _layout options
  settings?: Record<string, SectionField>; // dock-edited (inline: false)
}
```

Blocks carry the same `_settings`. Louise stores only the chosen **token** and the
setting _values_, **never layout CSS**. The site component reads `_layout` /
`_settings` and switches its own grid, flex, or background, so the design stays
100% site-owned (the same contract as today's bespoke renders). The **inspector
rail** is the surface for this. It's contextual to each selection, has an Outline
tree for navigation, and replaces the dock's per-item forms. It's deliberately
_not_ the Settings drawer and _not_ the edit bar (§3).

### 6. Rich text: a ProseKit brand-color mark bound to `BrandTheme` tokens

Text color is a **closed brand palette**, not a freeform picker. Extend the
existing ProseKit editor (`client/RichText.tsx`, `core/content/richtext.ts`) with
an inline text-color **mark** whose attribute is a brand _token key_
(`brand` / `secondary` / `tertiary` / `accent`, which is ADR 0003's `Colorway`).
The site theme resolves it to an actual color at render time. Stored content
therefore stays token-based and theme-aware, and a brand re-theme flows through
with no content rewrite. A floating **format bubble** surfaces bold, italic, and
link plus the brand swatches on text selection. (The prototype uses `execCommand`
for illustration; production uses ProseKit marks, never `execCommand`.)

## Consequences

**Positive**

- Makes _"edit on the real design"_ true for **structure**, not only text. The
  dock was the one surface that broke the thesis, and reorder, delete, and
  duplicate become instant with no server round trip.
- **Additive and reuse-heavy.** `blocks` / `_settings` / `_layout` are optional,
  and existing sites keep working. It _generalizes_ an existing pattern
  (`discriminator`) rather than inventing one, and reuses `SectionField`, the
  validator recursion, the depth-agnostic store and marker machinery,
  `createBlockRegistry`, the ProseKit editor, and the edit bar and drawer. Small
  net-new surface.
- **Fits ADR 0003.** `<Section>` / `<Editable>` are the render home for blocks and
  the deeper markers, and the brand-color mark reuses `Colorway`. This pulls the
  reference site _up_ to the primitive standard rather than forking a model.

**Negative and risks**

- Overlay positioning (scroll, resize, font load, sticky ancestors) and nested
  hit-testing are genuine client work. Three things mitigate it, all proven in the
  prototype: drawing rings as `box-shadow` on the element, deepest-boundary-wins
  selection, and `:has()`.
- The fragment-render route is a real new server contract. It's scoped to a
  _single item's_ render and reuses the site's existing section render path, not
  a second renderer.
- A wholly generic block model risks becoming a page builder or config language,
  the same risk ADR 0003 flags for a generic `<Section>`. Mitigation: bespoke,
  site-owned sections stay first-class, `blocks.allow` bounds each section's
  palette, and **flat ordered `blocks` ship first, named slots are deferred**.
- Color overload (orange/blue mean section/block _and_ Done/Settings). Accepted,
  and disambiguated by treatment.

**Non-goals**

- Not a drag-and-drop page builder that authors markup. The site still owns every
  pixel, and Louise stores structured JSON and tokens.
- Not named slots or cross-section block moves in v1. Flat ordered `blocks` per
  section come first, and slots are a later refinement.
- Not a retro-migration. Sections opt into `blocks` opportunistically, and nothing
  forces a rewrite (same stance as ADR 0003).
- Not a new styling system. Tailwind, daisyUI, and the `louise` theme stay the
  styling layer (ADR 0001/0003). This standardizes structure and settings, not CSS.

## Adoption checklist (phased)

- [ ] **Phase 0.** `discriminator` on `SectionField` type `array`, plus the
      validator and the dock/inspector type-switcher. The proving slice: it reuses
      the collection-side spec and builds the swap UI once.
- [ ] **Phase 1.** On-canvas chrome over the _current_ section model: outline
      rings, floating toolbars, "+" inserters, drag-to-reorder, and the inspector
      rail. Delete the floating dock, and reorder, delete, and duplicate go instant.
      No schema change, so it validates the hard UX first.
- [ ] **Phase 2.** First-class `blocks` and `BlockCatalog`, marker additions
      (`data-louise-section` / `data-louise-block`), and the validator `blocks`
      branch.
- [ ] **Phase 3.** The fragment-render route for add and swap. Retire structural
      save-draft-and-reload.
- [ ] **Phase 4.** `_settings` / `_layout` schema and inspector wiring.
      `<Section>` reads them.
- [ ] **Phase 5.** The ProseKit brand-color mark bound to `BrandTheme.colors`,
      and the format bubble.
- [ ] **Reference.** Convert one `workers/site` section (for example, `Hero`)
      onto blocks as the proving slice, mirroring ADR 0001/0003's "ship with a
      slice".

## Amendment (2026-09-24): what shipped

#182 closed on 2026-07-19 with every phase above shipped, including the
Reference slice. The unchecked boxes in the adoption checklist are historical.
One part of §3 landed differently:

- **The dock is gone** (#229). Everything it did now happens on the canvas: the
  hover toolbar reorders and deletes, the inspector edits array membership and
  non-inline fields, and a floating "+" adds a section.
- **Version history opens in its own right-side drawer,** from a History button on
  the edit bar, not in the Settings drawer. The Settings drawer belongs to
  `mountLouise`, and the sections editor mounts independently of it, so folding
  history into it would couple the two surfaces. The history drawer reuses the
  `.louise-drawer` styles. Merging the two drawers is an open follow-up, not a
  decision.
