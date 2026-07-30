# ADR 0010 — The editable-node model: one recursive node, one field registry, one marker

- **Status:** Accepted (2026-07-28) — A1 shipped in `louise-toolkit@0.21.0` /
  `astroidjs@0.5.0` (2026-07-29). Amended below where building it changed the
  answer.
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
- **capabilities** — independent, not an exclusive role:
  - `ordered` — has a position in a parent's list, so it can move and delete;
  - `children` — holds an ordered list, so it can be added to;
  - `fields` — has an inspector.
- **source** — where its truth lives: `page` (staged into a draft) · `shared`
  (site settings; immediate) · `external` (mirrored, e.g. Square; config-only).

> Capabilities must be independent because **a section is both**: an item of the
> page's ordered list _and_ a container of blocks. An exclusive
> `container | item | value` enum cannot express that, and modelling it that way
> would reintroduce per-layer special cases — the exact failure this ADR exists to
> remove. A "value" (a link, a field) is then just a node with neither `ordered`
> nor `children`, which is why its wrench-only toolbar falls out rather than being
> hand-built.

Everything the chrome does becomes derived rather than built:

- **Ring colour = f(source)**, not f(depth). Own content keeps depth shading;
  `shared` is green and `external` is yellow. The epic's two-tier ring stops being
  two new layers and becomes a property of a node.
- **Toolbar = f(capabilities)**. `children` adds a `+`; `ordered` adds
  move/delete; `fields` adds a wrench. The link layer's wrench-only bar _derives_
  from a node with only `fields`, instead of being hand-built.
- **A node with `children` and none renders an "add first child" affordance
  automatically**, at every depth. Defect 1 above is dissolved, not patched — and
  the page-level empty state stops being a special case too.
- **Suppression is generic deepest-wins over one attribute** — the 24 manual
  `clear*` calls collapse to one.

**Fields become a registry.** One `defineFieldType({ name, validate, editor,
inline, options? })`, consumed by both the section inspector and the settings
drawer. A new type is one registration instead of five edits, the two parallel
systems merge, and a type may declare an async options source — which is exactly
what #37's Square pickers need.

> **Amended while building A2 (see below).** The single call does not survive the
> server/client boundary. The schema facts (`validate`, `inline`) live in
> `core/content`; the editor is registered client-side against the same names.

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

### Resolved while building A1

Three questions surfaced once `resolve` had to be written against a real catalog.

**What a value node's wrench opens: just that field.** Pre-0010 a CTA's wrench
opened its whole owning section's inspector — live QA on 2026-07-28 showed
clicking one of HomeHero's CTAs surfacing a panel listing all four of its
link-ish fields. A value node's inspector scopes to the field it addresses. This
is a behaviour change, not only a refactor, and is what #38 was reaching for.

**How `tone` is chosen before Phase B: by depth, provisionally.** Depth 1 →
`section`, block depth → `block`, a leaf key → `value`, reproducing today's
orange/blue/violet exactly. Keying off capabilities was rejected: a section with
no `blocks` policy has no `children` and would come out blue. Phase B replaces
this wholesale with `source`, so it is deliberately a heuristic with a short life,
confined to the editor's `resolve` — the chrome already has no opinion.

**Which nodes carry a marker: the render decides, for now.** Two models exist:

- _render decides_ — the site stamps a marker only on things that should ring,
  and inline text stays on `data-louise-sfield`. Two marker families;
  the author knows which is which.
- _catalog decides_ — the render stamps ONE attribute on everything editable and
  the field TYPE declares whether it wants chrome, inline editing, or both.
  `data-louise-sfield` disappears.

The second is the end state and is what the Migration section below describes. It
is **deferred to Phase A2** for two reasons: "the type declares whether it wants
chrome" cannot exist before the field registry does, and it requires a real change
to hit-testing. Today `resolve → null` means _clear_, which is correct only while
solely ring-worthy things are marked; once every text span is a node, hovering a
CTA's label would resolve to "no chrome" and clear, instead of falling outward to
the anchor that should ring. Under the catalog-decides model `nodeAt` must walk
**outward** until something resolves. That is a change to the deepest-wins lookup,
not a flag.

### Resolved while building A2

**`defineFieldType` cannot carry its editor.** The single call above assumes one
registration holds validation _and_ the editor component. It doesn't survive the
boundary the registry sits on.

`core/content` is server-safe on purpose — `sections.ts` won't even import the
`./validation.js` barrel, because that half pulls in `drizzle-orm` and would drag
an optional peer into every consumer — and astroid imports this graph from
`schema/collections.ts`, inside a Worker. A Solid component in those objects puts
the client framework in that bundle.

So the registration splits by what each side can hold: the **schema** facts
(`validate`, `inline`) in `core/content`, read by the server validator and the
client alike so they cannot disagree; the **editor control** registered
client-side against the same names. A plain type is one registration, one with a
bespoke control is two — against five before, which is the claim that mattered.

Two predicates are copied into the registry rather than imported, each with a
test asserting it still agrees with its original: the link allowlist (from the
HTML sanitizer, as before) and `isMediaUrl`. The second is new and the reason is
the same boundary — it is three lines behind ~600 lines of image byte-sniffing,
and because registration is a module-scope side effect a bundler cannot shake
that back out. The editor would ship a JPEG header parser to answer a
string-prefix question.

**A runtime type still can't be authored.** `SectionFieldType` is a closed union,
so a type registered by a site widens the registry but not the type a catalog may
write. Closing that is the settings-drawer merge's business, when the two parallel
type sets become one.

### Amended after A1 shipped: the codemod

The Migration section below called for a codemod. Measured against all four
consuming sites once A1 was real, that is more machinery than the job needs:
**62 stamps across 27 files**, and every real one is a literal template expression
— one `{String(i)}`, three `blockAttr(j)`, seven `{edit ? … }`, the remainder test
fixtures and prose.

The rename is a `perl -pi -e`. Writing and verifying a codemod would cost more
than the rename it performs, and the ADR's own reason for wanting one — that the
stamps are "mechanical and regular" — is exactly why a one-liner suffices.

```sh
perl -pi -e 's/data-louise-(section(?!s)|block(?!s)|link|sfield)/data-louise-node/g' \
  $(git grep -lP 'data-louise-(section(?!s)|block(?!s)|link|sfield)' -- '*.astro' '*.ts' '*.tsx')
```

**Both negative lookaheads are load-bearing, and the second one was missed the
first time this was written down.** Three unrelated attributes share these
prefixes and must survive untouched:

- `data-louise-sections` / `-sections-host` / `-sections-realtime` / `-sections-initial`
  — the sections container and its wiring.
- **`data-louise-blocks`** — opts a rich-text field into the full builder block
  set (`client/index.ts:696`, stamped in `workers/site/src/pages/[...slug].astro`).
  Nothing to do with the block _marker_. Without `block(?!s)` the rename turns it
  into `data-louise-nodes` and the builder silently loses its block set — a
  failure that would survive review, because the diff looks exactly like every
  other line of the rename.

Read the diff before committing it. The guard is the whole reason this is a
one-liner and not a codemod; a one-liner with the wrong guard is worse than
either.

The lockstep claim also needs correcting. `0.21.0` shipped A1 before any site
migrated, so "sites land in lockstep with the release" did not happen as written.
It is recoverable rather than broken: the sites pin `^0.20.0`, and pre-1.0 caret
ranges do not admit `0.21.0`, so nothing upgraded by accident. They now move from
`0.20.0` to the A2 release, taking both marker changes in one pass.

### Amended after migrating the first site: what the rename actually is

Coracle went first, as the proving ground this ADR names. Two things it needed
are not "rename the stamps", and neither would be guessed from the text above.

**`louise-toolkit` and `astroidjs` must be bumped TOGETHER.** `astroidjs` depends
on an exact `louise-toolkit` version, not a range. Bump only the toolkit and pnpm
installs BOTH — the site's direct dependency and astroid's pinned one — side by
side. The two copies export structurally identical but nominally distinct types,
so a catalog built against one is not assignable to a function expecting the
other. Coracle got five errors of the form:

> Type `…louise-toolkit@0.22.0…` is not assignable to type `…louise-toolkit@0.20.0…`

in `astroid.config.ts`, `worker.ts` and `actions/index.ts` — files that have
nothing to do with markers, with nothing in the message pointing at the real
cause. Bumping both cleared all five. A site on astroid cannot take this release
by bumping one package.

**`data-louise-type` is deleted for SECTION fields and kept for PAGE fields.**
A2 folded the section field's type hint into the catalog, but the page-field
contract — `data-louise-field` + `data-louise-type="richtext"` — is untouched, and
`<Editable>` still emits it. A blanket delete silently downgrades a versioned
page's rich-text body to a plain contenteditable: nothing errors, the editor just
loses its formatting. Coracle had exactly one, in `[...slug].astro`, against
fourteen section-field ones.

So the migration is four renames, one conditional deletion, and a paired version
bump. The renames are still a one-liner — `data-louise-sfield` /
`data-louise-section` / `data-louise-block` / `data-louise-link` →
`data-louise-node`, guarded with `(?!s)` so `data-louise-sections` survives, which
in coracle protected eight host attributes against one real stamp. Test files
need the same pass: coracle's own assertions named the old attributes, and 12
tests failed until they were renamed too.

## Staging

Deliberately two arcs, because the evidence is not evenly distributed.

**Phase A1 — node model + generic chrome.** One marker, one grammar, one
re-stamper, capability-derived toolbars, generic deepest-wins suppression, and the
empty-container affordance. Markers stay render-decided (above), so
`data-louise-sfield` is untouched.

**Phase A2 — field registry.** `defineFieldType` shared by the section inspector
and the settings drawer, async options, and with it the catalog-decides marker
model: one attribute over every editable node, `data-louise-sfield` folded in, and
`nodeAt` walking outward on an unresolved node.

**Phase B — the source abstraction.** `page` / `shared` / `external`, and with it
#37. Deferred because it is the one piece with **no** implementation evidence
yet — Phase 3 has never been built, and its own spec has five unresolved
questions. Designing it blind is how we got here.

Corollary: **#37 is not built on the current chrome.** It is the forcing function
that exposed this ADR, and building it as spec'd would roughly double the layer
plumbing and add two grammars immediately before deleting all of it.

## Migration — a clean cut, renamed in one line

The marker attributes are the site-facing contract: every `.astro` render stamps
them by hand across four consuming sites. We take **one breaking change** rather
than carrying aliases.

- `data-louise-section="<i>"`, `data-louise-block="<i>.blocks.<j>"`, and
  `data-louise-link="<path>"` all become `data-louise-node="<path>"`, with `role`
  and `source` supplied by the catalog rather than inferred from the attribute
  name. `data-louise-sfield` is folded in as a `value` node.
- A **one-line rename** rewrites the stamps — the command and its two guards are
  in the amendment above. The codemod this originally called for is not worth
  writing.
- Sites land in lockstep with the release. Coracle is the proving ground; it is
  the only site currently exercising blocks and links. (Amended: `0.21.0` shipped
  A1 ahead of every site, so lockstep now happens at the A2 release — see above.)
- Rejected: an aliasing compat shim. It keeps two contracts alive indefinitely,
  and the aliasing is subtle precisely where the model is subtlest (a link nested
  in a block nested in a section). A single cut is smaller total work and leaves
  no ambiguity about which contract is real.

## Consequences

**Good.** New ring kinds, field types, and container kinds become registrations
rather than edits across five files. The empty-container class of bug cannot recur.
The render and editing layers finally describe containment the same way, so
`Section.astro` stops sniffing paths. #37 becomes expressible.

**Costs.** A breaking release with a coordinated four-site migration. A rewrite of
`client/chrome.ts` and the inspector's field rendering — both well covered by
tests (chrome-link-layer, sections-inspector, sections-blocks), which is what makes
this tractable. The rename itself is a one-liner, but its guards have to be right
and its diff has to be read.

**Risks.** The `source` model is designed in Phase B against real Phase 3
requirements, not now — if that proves wrong, ring colour keying is where it
surfaces. Nested containers are _enabled_ but should stay unused until something
asks for them; enabling is not the same as adopting.

**Unresolved (deliberately).** The five open questions in
`coracle.coffee/docs/phase-3-reference-rings.md` §9 gate Phase B and are not
pre-empted here.
