# ADR 0005 — Inline section & block editing: on-canvas chrome, a block layer, and the fragment-render contract

- **Status:** Proposed (2026-07-18)
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0003 (Astroid `<Section>` / `<Editable>` primitives), ADR 0001
  (opinionated where it's expensive), #12 (structure builder), #13 (block
  registry), #68 (auto-save), epic #102, milestone "Platform features push"
- **Scope:** `packages/louise/src/client` (the sections editor + editor chrome)
  and `packages/louise/src/core/content` (the sections/blocks schema + validator);
  plus the site-side render contract. No styling system changes.
- **Reference prototype:** an interactive concept mockup drove this design —
  on-canvas section (orange) / block (blue) chrome, rich text with brand colours,
  drag-to-reorder, the inspector rail, the bottom edit bar + Settings drawer, and
  mobile. <https://claude.ai/code/artifact/c5ce30aa-9e7e-4efc-bee6-5a980b9cbb9d>

## Context

A Louise **section** is one item of a page's `sections` JSON array —
`{ _type, ...fields }` — that the *site* renders with its own bespoke component;
Louise owns editing only (`core/content/sections.ts`, `client/sections.tsx`).
Field types are `text` / `textarea` / `array` / `image`, and the **only** nesting
available today is a `type: "array"` field with a single *homogeneous* `itemFields`
shape (e.g. `featureGrid.items`). Editing is **hybrid**: visible text is edited in
place over the real render via `data-louise-sfield="<i>.<key>"` markers; everything
structural — which sections exist, their order, array membership, and any
non-visible field — lives in a floating **dock** (bottom-left). Structural changes
`save-draft → reload` so the server can re-render the new shape.

That model has a gap and a contradiction:

- **Gap.** There is no way to organise the pieces *within* a section, to swap one
  component for another, or to change a section's layout — a section is a monolith
  with a flat field set (plus one homogeneous array).
- **Contradiction.** Louise's whole thesis is *"edit in place on the real design."*
  The dock is the one surface that breaks it: a side panel of proxy controls for
  things you are looking straight at. It is also the surface that forces a reload
  on every structural edit.

Two pieces of chrome are **not** in question and stay exactly as they are: the
unified **edit bar** (`createChrome` → `.louise-bar`, the bottom-centre glassy
pill that owns Publish + save-status + Settings + Done) and the **Louise Settings
drawer** (`client/settings/shell.tsx`, the right-side back-office surface). What
this ADR replaces is only the floating **sections dock** — and the dock already
relocates its Save/Publish onto the edit bar (`.louise-bar-actions`), so removing
it is largely subtractive.

Like ADR 0002/0003, this ADR fixes the design forks **before** any code, so the
implementation PRs have a fixed target. It follows ADR 0001's rule — *opinionated
where it's expensive, framework-agnostic where it's free* — and reuses the
existing schema, validator, marker, and editor machinery rather than forking new
paths.

## Decision

### 1. A first-class `blocks` layer on sections — generalise the discriminator

`SectionItem` gains an optional `blocks` array of polymorphic children, described
by a `BlockCatalog` that mirrors `SectionCatalog`. This is the sections analogue
of `ArrayFieldConfig.discriminator` (`core/content/types.ts`) one level up: the
same `_type`-selects-a-field-map model sections already use, nested.

```ts
interface BlockItem { _type: string; [key: string]: unknown }

interface SectionItem {
  _type: string;
  blocks?: BlockItem[];            // NEW — the organising layer
  [key: string]: unknown;          // direct fields still allowed (back-compat)
}

interface SectionDef {
  label: string; icon?: string;
  fields: Record<string, SectionField>;
  blocks?: { allow?: string[]; min?: number; max?: number };   // NEW
}

type BlockCatalog = Record<string, BlockDef>;
interface BlockDef { label: string; icon?: string; fields: Record<string, SectionField> }
```

Block fields reuse `SectionField` **verbatim**, so `validateSectionField` extends
with one `blocks` branch (each block validated against `BlockCatalog[block._type]`,
recursively) and the `Rule` chain still applies. Storage is unchanged — `sections`
stays one JSON column. Everything is additive: `blocks` is optional, existing
catalogs and the four dogfood sites are untouched, and a section may mix direct
fields *and* blocks during a transition.

**Ship it incrementally.** First land `discriminator` support on `SectionField`
type `array` — the concept is already specced on the collection side
(`ArrayFieldConfig.discriminator`, with `variants` / `variantsAdmin`). That
delivers "swap a block within a field" and forces the type-switcher UI to be built
once. Then promote to a first-class `blocks` array on `SectionItem`.

### 2. The site owns rendering one level deeper — the marker contract

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
client boundaries to draw chrome on; the `data-louise-sfield` path simply deepens
to `<i>.blocks.<j>.<key>`. Crucially, `pathToArgs` / `wireInline` and the
fine-grained store setter (`set("items", ...pathToArgs(path), value)`) are already
depth-agnostic — they split on `.` and coerce numeric segments — so **in-place
text editing needs no client change** for nested blocks.

This is the natural home for ADR 0003's primitives: `<Section>` reads `_layout` /
`_settings` (§5) and slots its children, and `<Editable>` already owns the
`data-louise-*` marker contract, so a site author writes `<Editable field="heading">`
and never hand-stamps the deeper path. The generic `createBlockRegistry`
(`core/content/blocks.ts`, from #13) resolves `block._type → renderer`, giving that
module a second, aligned use.

### 3. On-canvas chrome replaces the floating dock — the bar and drawer stay

Delete the bottom-left sections dock. Its per-item structural controls move onto
the canvas as overlay chrome; its Save/Publish already live on the edit bar. The
edit bar (`.louise-bar`) and the Settings drawer are unchanged.

- **Rings** are drawn as `box-shadow` *on the section/block element itself* — never
  clipped by an `overflow` ancestor, never mis-measured against a separate overlay.
  **Toolbars** are `position: absolute` children; **"+" inserters** sit between
  siblings. Hit-testing is **deepest-boundary-wins** (a block hover doesn't light
  its parent section), and `:has()` suppresses the parent-section toolbar while a
  block is active.
- **Colour coding:** orange = the section layer, blue = the block layer. This
  overlaps the edit bar's own blue = Settings / orange = Done. Accepted and
  recorded here: the two are disambiguated by *treatment* (glassy pill text buttons
  vs. on-canvas outline rings), not hue.
- **Autosave is the only save path** (#68): edits stage a draft on an idle
  debounce, the bar shows live status (Unsaved → Saving… → Draft saved) plus
  Publish, and there is no manual Save button. Autosave never publishes.
- **Three surfaces, three scopes**, kept distinct: the **edit bar** acts on the
  *page* (publish / status / settings / done); the **Settings drawer** on the
  *site* (pages, media, users, health); the new **inspector rail** (§5) on the
  *selected element*.

### 4. Structural ops: instant where the markup exists; a fragment route where it doesn't

The reason structural edits reload today is that only the server can render the
site's components. That constraint splits cleanly, and most of it dissolves:

- **Reorder / delete / duplicate** move or clone DOM nodes that are *already
  rendered* and reconcile the store — **no server, no reload**. This is the
  headline win over today's reload-on-every-structural-change.
- **Add / swap-type** need markup that doesn't exist yet. Add a **per-item
  fragment-render route**: POST the one item (`{ _type, ...fields }`, or the
  section's `{ blocks: [...] }`), the server renders *that item* through the same
  section render path and returns its HTML, the client splices it in and re-runs
  `wireInline` on it. No full reload, and the editor still authors **zero markup**
  — the server owns rendering (ADR 0001). This supersedes the current
  save-draft-and-reload for structural edits.

### 5. Settings & layout: an inspector rail over `_settings` + `_layout` tokens

```ts
interface SectionItem {
  _layout?: string;                        // a named layout variant
  _settings?: Record<string, unknown>;     // background, spacing, columns, alignment…
  // …
}
interface SectionDef {
  layouts?: Record<string, { label: string }>;   // the _layout options
  settings?: Record<string, SectionField>;         // dock-edited (inline: false)
}
```

Blocks carry the same `_settings`. Louise stores only the chosen **token** and the
setting *values* — **never layout CSS**. The site component reads `_layout` /
`_settings` and switches its own grid/flex/background, so the design stays 100%
site-owned (the same contract as today's bespoke renders). The **inspector rail**
is the surface for this — contextual per selection, with an Outline tree for
navigation — replacing the dock's per-item forms. It is deliberately *not* the
Settings drawer and *not* the edit bar (§3).

### 6. Rich text: a ProseKit brand-colour mark bound to `BrandTheme` tokens

Text colour is a **closed brand palette**, not a freeform picker. Extend the
existing ProseKit editor (`client/RichText.tsx`, `core/content/richtext.ts`) with
an inline text-colour **mark** whose attribute is a brand *token key*
(`brand` / `secondary` / `tertiary` / `accent` — ADR 0003's `Colorway`), resolved
to an actual colour by the site theme at render time. Stored content therefore
stays token-based and theme-aware, and a brand re-theme flows through with no
content rewrite. A floating **format bubble** surfaces bold / italic / link plus
the brand swatches on text selection. (The prototype uses `execCommand` for
illustration; production uses ProseKit marks, never `execCommand`.)

## Consequences

**Positive**

- Makes *"edit on the real design"* true for **structure**, not just text — the
  dock was the one surface that broke the thesis, and reorder/delete/duplicate
  become instant with no server round-trip.
- **Additive and reuse-heavy.** `blocks` / `_settings` / `_layout` are optional;
  existing sites keep working. It *generalises* an existing pattern
  (`discriminator`) rather than inventing one, and reuses `SectionField`, the
  validator recursion, the depth-agnostic store/marker machinery,
  `createBlockRegistry`, the ProseKit editor, and the edit bar + drawer. Small
  net-new surface.
- **Fits ADR 0003.** `<Section>` / `<Editable>` are the render home for blocks and
  the deeper markers; the brand-colour mark reuses `Colorway`. This pulls the
  reference site *up* to the primitive standard rather than forking a model.

**Negative / risks**

- Overlay positioning (scroll / resize / font-load / sticky ancestors) and nested
  hit-testing are genuine client work. Mitigated by drawing rings as `box-shadow`
  on the element, deepest-boundary-wins selection, and `:has()` — all proven in
  the prototype.
- The fragment-render route is a real new server contract. Scoped to a *single
  item's* render and reusing the site's existing section render path, not a second
  renderer.
- A wholly generic block model risks becoming a page builder / config language —
  the same risk ADR 0003 flags for a generic `<Section>`. Mitigation: bespoke,
  site-owned sections stay first-class; `blocks.allow` bounds each section's
  palette; **flat ordered `blocks` ship first, named slots are deferred**.
- Colour overload (orange/blue mean section/block *and* Done/Settings). Accepted;
  disambiguated by treatment.

**Non-goals**

- Not a drag-and-drop page builder that authors markup. The site still owns every
  pixel; Louise stores structured JSON + tokens.
- Not named slots or cross-section block moves in v1 — flat ordered `blocks` per
  section first; slots are a later refinement.
- Not a retro-migration. Sections opt into `blocks` opportunistically; nothing
  forces a rewrite (same stance as ADR 0003).
- Not a new styling system — Tailwind + daisyUI + the `louise` theme stay the
  styling layer (ADR 0001/0003). This standardises structure and settings, not CSS.

## Adoption checklist (phased)

- [ ] **Phase 0** — `discriminator` on `SectionField` type `array` + validator +
      the dock/inspector type-switcher. The proving slice; reuses the collection-side
      spec and builds the swap UI once.
- [ ] **Phase 1** — on-canvas chrome over the *current* section model: outline
      rings, floating toolbars, "+" inserters, drag-to-reorder, and the inspector
      rail; delete the floating dock; reorder/delete/duplicate go instant. No schema
      change — validates the hard UX first.
- [ ] **Phase 2** — first-class `blocks` + `BlockCatalog`; marker additions
      (`data-louise-section` / `data-louise-block`); the validator `blocks` branch.
- [ ] **Phase 3** — the fragment-render route for add/swap; retire structural
      save-draft-and-reload.
- [ ] **Phase 4** — `_settings` / `_layout` schema + inspector wiring; `<Section>`
      reads them.
- [ ] **Phase 5** — the ProseKit brand-colour mark bound to `BrandTheme.colors`;
      the format bubble.
- [ ] **Reference** — convert one `workers/site` section (e.g. `Hero`) onto blocks
      as the proving slice, mirroring ADR 0001/0003's "ship with a slice".
