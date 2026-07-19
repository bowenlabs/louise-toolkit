---
"astroidjs": minor
---

Add the `<Collection>` primitive (ADR 0003, item 3) — `astroidjs/components/Collection`.
A Solid render-prop that renders a typed list: the item type is inferred from
`items`, so `item` in the render slot is fully typed with no hand-written
interface. It's a Solid component (not `.astro`) because only a children-as-function
can type a per-item `{item}`; server-render it by using it inside a Solid island
with no `client:*` directive (static HTML, no JS shipped). `solid-js` is an optional
peer dependency.

The item type comes from the `items` you pass (typed from your data, per ADR 0001's
Zod-as-source-of-truth) rather than from the collection config — Louise's
`CollectionConfig` is type-erased (`fields: Record<string, FieldConfig>`), so the
shape can't be recovered from the collection value itself.

Also fixes packaging for the source-shipped component layer: `sections.ts` no
longer imports `../config.js` (it ships as source next to the `.astro`, so it must
not reach into astroid's built `src/*`), and `src/components/*` is excluded from the
built `dist/` — the whole component layer ships as source via the `./components/*`
exports.
