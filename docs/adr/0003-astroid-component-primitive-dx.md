# ADR 0003 — Astroid component-primitive DX: typed `.astro` props

- **Status:** Proposed (2026-07-17)
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0001 (opinionated Astro-on-Cloudflare, fully typed); astroid
  roadmap item #4 (`<Section>` / `<Editable>` / `<Collection>` primitives); epic
  #102
- **Scope:** `packages/astroid` — the component layer only. No runtime code ships
  with this ADR; it fixes the conventions the primitives are built to *before*
  they exist, so the four planned components land consistent instead of
  drifting.

## Context

ADR 0001 committed Astroid/Louise to *"everything as typed and structured as
possible,"* with types flowing schema → API → client. The **component layer** is
the last rung on that ladder and the only one still un-standardised: today every
site hand-writes its sections. The reference marketing site is representative —
`workers/site/src/sections/Hero.astro` and `FeatureGrid.astro` each declare an
ad-hoc `interface Props`, re-plumb the same `_editMode` / `_editIndex` pair, and
map their own tokens to Tailwind/daisyUI classes inline (`FeatureGrid`'s
`CARD_CLASS` / `colorway` cycle). It works, but nothing enforces a shape: prop
names, the edit-mode contract, and the token→class mapping are re-invented per
section and per repo.

Astroid roadmap item #4 turns that hand-work into four shipped primitives
(`<Section>`, `<Editable>`, `<Collection>`, and the section-library components
behind `SectionKind`). Those are a **public, opinionated API** — a solo
maintainer will live with their prop surface across coracle, ghostfire, and
themidwestartist. Astro `.astro` components plus TypeScript give real leverage
here (polymorphic elements, union-literal props, types derived from token maps,
typed attribute spreading), but only if applied deliberately. This ADR records
that DX standard so the primitives are self-documenting, autocompleting, and hard
to misuse, rather than each one making its own choices.

The prop-typing techniques below are the well-known Astro + TypeScript DX
patterns (polymorphic `as`, declarative props over class names, `keyof typeof`,
typed rest spreading); this ADR's contribution is *adopting them as the Astroid
convention* and binding them to Astroid's own vocabulary (`SectionKind`,
`BrandTheme`, the `data-louise-*` edit markers).

## Decision

Adopt the following conventions for every Astroid `.astro` primitive. Each is
paired with the concrete Astroid surface it governs.

### 1. Props are a named, exported `Props` interface — variants are unions, never `string`

Every literal-set prop is a union of string literals so the editor autocompletes
it and `astro check` rejects a typo before build. Astroid's vocabulary already
*is* these unions (`SectionKind`, `Archetype`, `CommerceProvider`), so props
reference them directly.

```ts
// astroid: the colorway is a closed set, not an open string.
type Colorway = "brand" | "secondary" | "tertiary" | "accent";
interface Props {
  kind: SectionKind;      // from config.ts — one source of truth
  colorway?: Colorway;
  align?: "start" | "center" | "end";
}
```

### 2. Declarative props map to tokens — components never take raw class names

Following ADR 0001's "opinionated where it's expensive": callers describe *intent*
(`colorway="brand"`), and the component owns the token→class mapping. This is
exactly `FeatureGrid`'s existing `CARD_CLASS` table, promoted to the shared
primitive and keyed to the `BrandTheme.colors` set (`brand`/`secondary`/
`tertiary`) so a brand re-theme flows through without touching markup.

```ts
const CARD_CLASS = {
  brand: "bg-primary text-primary-content",
  secondary: "bg-secondary text-secondary-content",
  tertiary: "bg-accent text-accent-content",
} as const;
```

### 3. Derive prop types from the token map with `keyof typeof`

The union and the implementation stay in lockstep from one definition — add a
colorway to the map and the prop type updates itself; there is no second list to
forget.

```ts
type Colorway = keyof typeof CARD_CLASS;   // "brand" | "secondary" | "tertiary"
```

### 4. Polymorphic elements via a typed `as`, with a typed `...rest` escape hatch

Primitives that render a variable tag (headings, `<Editable>` wrapping any
element) take `as`, and spread the remaining native attributes typed by that tag
via Astro's `HTMLAttributes` — so `<Editable as="a" href="…">` type-checks
`href`, and unknown attributes are a compile error, not silent HTML.

```ts
import type { HTMLTag, Polymorphic } from "astro/types";
type Props<Tag extends HTMLTag> = Polymorphic<{ as: Tag }> & {
  field: string;          // the data-louise-sfield path (see §5)
};
const { as: Tag = "div", field, ...rest } = Astro.props;
```

### 5. `<Editable>` owns the `data-louise-*` marker contract; edit-mode is context, not per-section props

The inline-edit markers the sites stamp by hand today —
`data-louise-sfield={edit ? \`${idx}.heading\` : undefined}`, plus
`data-louise-multiline` — become the single responsibility of `<Editable>`. The
`_editMode` / `_editIndex` pair stops being copy-pasted into every section's
`Props`: it moves to an Astro context/slot the section library reads, so authors
write `<Editable field="heading">` and the primitive emits the correct marker
(or plain output outside edit mode). This keeps the edit contract in one place
and typed, instead of restated in each `interface Props`.

### 6. `<Section>` is a discriminated union over `SectionKind`; `<Collection>` is typed by its Zod schema

`<Section>` dispatches on `kind` (the `SectionKind` catalog), each arm carrying
its own field shape — a discriminated union, so `<Section kind="hero">` requires
hero fields and rejects `productGrid` ones. `<Collection>` takes a Louise
collection and infers its item type from the collection's Zod schema (ADR 0001's
schema-is-the-source-of-truth), so `{item}` in its slot is fully typed with no
hand-written interface.

## Consequences

**Positive**
- The primitives ship with one consistent, autocompleting prop surface; a typo or
  a wrong `kind` fails at `astro check`, not in the browser.
- Formalises what the sites already do (`FeatureGrid` colorways, the
  `data-louise-sfield` markers, `_editMode` plumbing) instead of inventing a new
  model — low conceptual cost, and it pulls the reference site *up* to the
  standard (the same direction ADR 0001 set).
- Token→class indirection means a `BrandTheme` change re-skins every brand with no
  markup edits — the multi-brand premise in the README's `defineAstroid` example.
- Types are derived (`keyof typeof`, `z.infer`, `HTMLAttributes<Tag>`), so there
  is no parallel list to keep in sync.

**Negative / risks**
- Polymorphic + discriminated-union props are more type-machinery than a plain
  `interface`; kept in the primitives (`packages/astroid`), not pushed onto
  end-site authors, whose surface stays `<Section kind="…">`.
- A wholly generic `<Section>` risks becoming a config language. Mitigation:
  bespoke, site-owned sections stay first-class (as `Hero.astro` is today); the
  primitive is for the catalog sections, not a mandate to route everything
  through it.

**Non-goals**
- Not a component *framework* or a styling system — Tailwind + daisyUI + the
  `louise` theme stay the styling layer (ADR 0001). This standardises prop
  *shapes*, not the CSS.
- Not a retro-migration of `workers/site`'s bespoke sections. They adopt the
  primitives opportunistically; nothing forces a rewrite.

## Adoption checklist (when roadmap #4 lands)

- [ ] `<Editable>` — owns `data-louise-sfield` / `data-louise-multiline`; typed
      `field`; polymorphic `as` + typed `...rest`; edit-mode from context.
- [ ] `<Section>` — discriminated union over `SectionKind`; per-kind field types.
- [ ] `<Collection>` — item type inferred from the collection's Zod schema.
- [ ] Section-library components — declarative props → `BrandTheme` tokens via a
      `keyof typeof` class map; no raw class names in the prop surface.
- [ ] Convert one reference `workers/site` section (e.g. `FeatureGrid`) onto the
      primitives as the proving slice, mirroring ADR 0001's "ship with a slice"
      approach.
