---
"louise-toolkit": minor
---

Link chrome layer — a ring and a wrench on any marked CTA.

Completes the toolkit half of coracle.coffee#38. The `link` field type gave a
destination a proper editor; this gives it an *affordance*, so an editor reaches
it by pointing at the button rather than hunting for the right container's wrench.

A render opts a CTA in with a third marker:

```astro
<a href={ctaHref} data-louise-link={edit ? `${idx}.ctaHref` : undefined}>
<a href={b.href} data-louise-link={edit ? `${idx}.blocks.${j}.href` : undefined}>
```

Wire it with `links` on `mountSectionChrome` (the sections editor does this for
you):

```ts
links: { onInspect: (ref) => openInspector(ref) }
```

**The marker points at a FIELD, not a container** — unlike section and block
markers. A link's identity is the destination it edits; where it sits and whether
it exists belong to whatever contains it. `parseLinkMarker` accepts
`"<i>.<key>"` and `"<i>.blocks.<j>.<key>"`, rejecting anything else rather than
crashing the chrome, matching the other two readers.

**Wrench-only toolbar**, deliberately. Offering move/delete would duplicate the
block's own buttons, or worse imply a CTA can be reordered independently of the
copy around it.

**Hit-testing stays deepest-boundary-wins**, now three deep: a link beats the
block it sits in, which beats the section around that. Exactly one layer lights at
a time — two rings at once would make it ambiguous which container's wrench you're
about to click.

**Violet ring** (`--louise-violet`), not green or yellow: those are reserved for
the reference rings (internal-shared / external-source) that Phase 3 introduces,
and a link is neither.

Additive — a chrome that passes no `links` mounts no link toolbar and behaves
exactly as before.
