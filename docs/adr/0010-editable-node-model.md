# ADR 0010 — The editable-node model: one recursive node, one field registry, one marker

- **Status:** Proposed (2026-07-28)
- **Deciders:** Baylee (solo maintainer)
- **Supersedes:** ADR 0005 §2 (the three-attribute marker contract) and §3 (the
  per-layer chrome). The rest of 0005 — the fragment-render contract, instant
  structural ops, the inspector — stands and is generalised here.
- **Related:** ADR 0003 (astroid `<Section>` / `<Editable>`), ADR 0001
  (opinionated where it's expensive), coracle.coffee#37 (Phase 3 reference
  rings), coracle.coffee/docs/phase-3-reference-rings.md
- **Scope:** `packages/louise/src/client` (chrome + sections editor + settings
  fields), `packages/louise/src/core/content` (field schema + validator),
  `packages/astroid/src/components` (the render-side dispatcher), and the
  site-facing marker contract. **Breaking** — see Migration.

## Context

The editor grew one layer at a time, and each layer was hand-rolled. That was the
right call three times; it is the wrong call twice more.

**The render layer already has the model we want.** `astroid`'s `<Section>`
dispatcher recurses through itself with a deeper `base` path, and its own comment
states the invariant: _"a component never learns its own depth, so a type that
renders as a section renders unchanged as a block."_ Containment is uniform and
path-addressed.

**The editing layer does not.** `client/chrome.ts` hardcodes three layers with
three attributes, four path grammars, and two hand-written parsers. The seam where
these two models meet is visible in one line of `Section.astro`:

```astro
base.includes(".blocks.") ? { "data-louise-block": base } : { "data-louise-section": base }
```

The dispatcher **string-sniffs a path to choose a marker attribute**. That is the
three-attribute design leaking into an otherwise uniform recursive model.

### Measured cost of the current shape

|                                        | Today          | If #37 ships as spec'd |
| -------------------------------------- | -------------- | ---------------------- |
| Marker attributes / grammars / parsers | 3 / 4 / 2      | 5 / 6 / 4              |
| `clear*` calls for layer suppression   | **24**         | ~50 — it is O(n²)      |
| Edit sites to add one field type       | **5**          | unchanged              |
| Field-type systems                     | **2 parallel** | 2                      |

The five edit sites for a field type: the `SectionFieldType` union, a 7-arm server
validation ladder, a hardcoded `isInline()` type list, a 7-arm `ScalarField`
ladder, and the inspector's `Match` arms. The two systems are `SectionFieldType`
(8 types) and `SettingsFieldType` (6) — overlapping, unequal, and only the drawer
has a `render` escape hatch.

### The bugs are symptoms, not coincidences

Live QA on 2026-07-28 (coracle, real browser, first time) found three defects, and
each traces to a modelling gap rather than a coding slip:

1. **A freshly added block-capable section is a dead end** — 0 blocks, and the
   block `+` only exists on a block's own toolbar. There is no "add the first
   child" affordance because _containment is hardcoded per layer rather than
   modelled_. The identical problem was solved one level up (empty page → centred
   `+`) and could not be reused.
2. **The link toolbar renders orange** — each layer hand-builds its own chrome, so
   one background rule was simply missed.
3. **Duplicate destination options** — two lists merged ad hoc, with no notion of
   a resolved source.

And #37 is already blocked by the model: its Square pickers need dynamic options,
which `SectionField` cannot express and the drawer's `render` hatch can, but the
section inspector has no equivalent.

## Decision

Replace the three hardcoded layers with **one recursive editable node**. Every
marked element declares three things:

- **path** — one grammar, one parser, one re-stamper.
- **role** — `container` (holds ordered children) · `item` (a child) · `value` (a
  field).
- **source** — where its truth lives: `page` (staged into a draft) · `shared`
  (site settings; immediate) · `external` (mirrored, e.g. Square; config-only).

Everything the chrome does becomes derived rather than built:

- **Ring colour = f(source)**, not f(depth). Own content keeps depth shading;
  `shared` is green and `external` is yellow. The epic's two-tier ring stops being
  two new layers and becomes a property of a node.
- **Toolbar = f(role, capabilities)**. A container offers add; an item offers
  move/delete; anything inspectable offers a wrench. The link layer's wrench-only
  bar _derives_ from declaring only `inspect`, instead of being hand-built.
- **An empty container renders an "add first child" affordance automatically**,
  because containment is modelled. Defect 1 above is dissolved, not patched.
- **Suppression is generic deepest-wins over one attribute** — the 24 manual
  `clear*` calls collapse to one.

**Fields become a registry.** One `defineFieldType({ name, validate, editor,
inline, options? })`, consumed by both the section inspector and the settings
drawer. A new type is one registration instead of five edits, the two parallel
systems merge, and a type may declare an async options source — which is exactly
what #37's Square pickers need.

`richTextModes` (shipped 0.20.0) becomes ordinary field-level options. It was a
symptom: editor options were mount-level when they always belonged to the field.

### What this changes conceptually

- **Blocks stop being a special second level.** A section is a container instance;
  a block is an item that may itself be a container. Nesting, empty states, and
  re-stamping become uniform. ADR 0005's "flat; blocks do not nest in v1" is
  revealed as a limitation of the hand-rolled model, not a product decision.
- **Links stop being a layer.** A link is a `value` with an inspector. This is
  what building #38 actually discovered — its marker already points at a _field_
  rather than a container, unlike section and block markers.
- **Sections are unchanged in spirit**: the top-level container instance.

## Staging

Deliberately two arcs, because the evidence is not evenly distributed.

**Phase A — node model + field registry.** Everything above except `source`.
Justified entirely by measured cost and the three live defects. Ships the single
`data-louise-node` attribute, the registry, and the generic chrome.

**Phase B — the source abstraction.** `page` / `shared` / `external`, and with it
#37. Deferred because it is the one piece with **no** implementation evidence
yet — Phase 3 has never been built, and its own spec has five unresolved
questions. Designing it blind is how we got here.

Corollary: **#37 is not built on the current chrome.** It is the forcing function
that exposed this ADR, and building it as spec'd would roughly double the layer
plumbing and add two grammars immediately before deleting all of it.

## Migration — a clean cut with a codemod

The marker attributes are the site-facing contract: every `.astro` render stamps
them by hand across four consuming sites. We take **one breaking change** rather
than carrying aliases.

- `data-louise-section="<i>"`, `data-louise-block="<i>.blocks.<j>"`, and
  `data-louise-link="<path>"` all become `data-louise-node="<path>"`, with `role`
  and `source` supplied by the catalog rather than inferred from the attribute
  name. `data-louise-sfield` is folded in as a `value` node.
- A **codemod** rewrites the stamps. They are mechanical and regular — today's QA
  showed every one of coracle's is a literal template expression.
- Sites land in lockstep with the release. Coracle is the proving ground; it is
  the only site currently exercising blocks and links.
- Rejected: an aliasing compat shim. It keeps two contracts alive indefinitely,
  and the aliasing is subtle precisely where the model is subtlest (a link nested
  in a block nested in a section). A single cut with a codemod is smaller total
  work and leaves no ambiguity about which contract is real.

## Consequences

**Good.** New ring kinds, field types, and container kinds become registrations
rather than edits across five files. The empty-container class of bug cannot recur.
The render and editing layers finally describe containment the same way, so
`Section.astro` stops sniffing paths. #37 becomes expressible.

**Costs.** A breaking release with a coordinated four-site migration. A rewrite of
`client/chrome.ts` and the inspector's field rendering — both well covered by
tests (chrome-link-layer, sections-inspector, sections-blocks), which is what makes
this tractable. The codemod is new code that must itself be verified.

**Risks.** The `source` model is designed in Phase B against real Phase 3
requirements, not now — if that proves wrong, ring colour keying is where it
surfaces. Nested containers are _enabled_ but should stay unused until something
asks for them; enabling is not the same as adopting.

**Unresolved (deliberately).** The five open questions in
`coracle.coffee/docs/phase-3-reference-rings.md` §9 gate Phase B and are not
pre-empted here.
