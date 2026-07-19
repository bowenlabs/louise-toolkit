---
"astroidjs": minor
---

Fix `<Editable>` so it type-checks in a real consumer, and add its section-field
mode (ADR 0003 §5). The previous generic-`Polymorphic` `Props<Tag>` resolved to
`IntrinsicAttributes` under `astro check` — the component looked like it accepted no
props, so any `<Editable …>` failed to type-check. It's now a concrete
`HTMLAttributes<"div">`-based interface with `as` for the element.

New section-field mode: pass `sfield` (the `<index>.<path>` marker) — plus optional
`multiline` — to emit `data-louise-sfield` for the structured `<Section>` editor,
alongside the existing page-field mode (`collection`/`key`/`field` →
`data-louise-field`). This completes ADR 0003 item 5's proving slice: the reference
site's `FeatureGrid` section now stamps its inline-edit markers through `<Editable>`
instead of by hand, verified to compile + build with `astro check` + `astro build`.
