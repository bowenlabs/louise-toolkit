---
"louise-toolkit": minor
"astroidjs": minor
---

**Breaking (marker contract).** One attribute now marks every editable node:
`data-louise-node="<path>"`. It replaces `data-louise-section="<i>"`,
`data-louise-block="<i>.blocks.<j>"`, and `data-louise-link="<path>"` — three
attributes over four path grammars, parsed two different ways (ADR 0010, Phase A1).

Sites must rename their stamps. The value is unchanged in every case — only the
attribute name moves — so it is a rename, not a re-derivation:

```diff
- <div data-louise-section={i}>
+ <div data-louise-node={i}>

- <article data-louise-block={`${i}.blocks.${j}`}>
+ <article data-louise-node={`${i}.blocks.${j}`}>

- <a data-louise-link={`${i}.ctaHref`}>
+ <a data-louise-node={`${i}.ctaHref`}>
```

Astroid's `<Section>` stamps this for you and no longer sniffs `base` for
`".blocks."` to choose between two attribute names. `data-louise-sfield` is
untouched — inline text keeps its own marker until the field registry lands
(Phase A2).

**What the rename buys.** The chrome no longer knows a section from a block from
a link. It hands a parsed path to the editor and draws whatever capabilities come
back — `ordered` gives move/delete and a sibling `+`, `children` gives an add,
`fields` gives a wrench. Three consequences:

- **An empty container can be filled.** A block-capable section with no blocks
  offers its own `+`. Previously the only `+` for a block lived on a block's
  toolbar, so a freshly added section was a dead end with no way to add the first
  one.
- **A CTA's wrench opens the CTA.** A value node's inspector scopes to the field
  it addresses, instead of its owning section's whole panel — clicking one of four
  CTAs used to surface all four destinations at once.
- **Every toolbar is the same toolbar.** The link bar rendered orange because each
  layer hand-built its own chrome and one background rule was missed; there is now
  one bar, tone-keyed from the descriptor.

A new kind of node — a shared value, an external source (Phase B) — becomes a
change in the editor's `resolve` rather than another layer of chrome.
