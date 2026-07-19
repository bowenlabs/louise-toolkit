---
"astroidjs": minor
---

Add the `<Section>` dispatcher + a starter section library (ADR 0003, items 2 &
4). `astroidjs/components/Section.astro` is a discriminated union over
`SectionKind` — `<Section kind="hero" heading="…" />` requires that kind's fields
and rejects another kind's — dispatching to typed section components (hero,
featureGrid, cta, contact). The typed model (`astroidjs/components/sections`)
follows the ADR conventions: variant props are unions not `string`, callers pass
intent (`colorway="brand"`) while the component owns the token→class mapping, and
those unions derive from the token maps via `keyof typeof` so type and
implementation can't drift.

Remaining ADR 0003 items: `<Collection>` (item 3) needs a Solid render-prop —
Astro slots can't type a per-item `{item}` — and the reference-site proving
conversion (item 5) needs a local `astro build` to verify the components compile;
both are deferred rather than shipped unverified.
