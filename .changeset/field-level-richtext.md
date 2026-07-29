---
"louise-toolkit": minor
---

**Rich-text options are declared on the field.** A `richText` field carries its own
editor options in the catalog:

```ts
fields: {
  heading: { type: "richText", richText: { inline: true, image: false } },
  body:    { type: "richText", richText: { minimal: false, grammar: true } },
}
```

`richTextModes` shipped as a mount-level map keyed by a `data-louise-rt` name the
render stamped — a rendezvous between two files to establish something the catalog
already knew. ADR 0010 called it out as a symptom: editor options were mount-level
when they always belonged to the field.

Resolution order is most-specific-first: the field's own `richText`, then a
stamped `data-louise-rt` mode, then the site-wide `richText`, then the light
inline bubble. **Nothing is removed** — `richText` and `richTextModes` keep
working, and a render that stamps `data-louise-rt` is unaffected.

**Also fixed: a block field's placeholder was ignored.** Resolving a
`data-louise-sfield` path back to its field handled `<i>.<key>` and
`<i>.<key>.<j>.<sub>` but not `<i>.blocks.<j>.<key>` — the path starts with
`blocks`, which is not a field, so the lookup found nothing and every block field
fell back to a humanised key. A block field declaring `placeholder: "Feature name"`
showed "Name". Both lookups now share one resolver.
