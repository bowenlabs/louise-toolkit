---
"louise-toolkit": minor
"astroidjs": minor
---

**Breaking (marker contract).** One attribute now marks everything editable.
`data-louise-sfield` folds into `data-louise-node`, and `data-louise-type="richtext"`
and `data-louise-multiline` are gone — the catalog already says what a field is.

```diff
- <h1 data-louise-sfield={`${i}.heading`}>{heading}</h1>
+ <h1 data-louise-node={`${i}.heading`}>{heading}</h1>

- <p data-louise-sfield={`${i}.tagline`} data-louise-multiline>{tagline}</p>
+ <p data-louise-node={`${i}.tagline`}>{tagline}</p>

- <div data-louise-sfield={`${i}.body`} data-louise-type="richtext" />
+ <div data-louise-node={`${i}.body`} />
```

The path values are unchanged, so this is a rename plus two deletions. Astroid's
`<Editable>` emits it for you; its `type` and `multiline` props are accepted and
ignored for section fields.

**What the catalog decides.** A `text`, `textarea` or `richText` field is edited
in place — contenteditable, the right editor, spellcheck on multiline — and gets
no chrome of its own. Anything else rings and gets a wrench. The render says only
*where* a node is; it no longer describes what it is in three attributes the
schema already carried.

**Hit-testing changed.** An unresolved node used to mean "clear", which was right
while only ring-worthy things were marked. Now the tightest marker under the
pointer is usually an inline field with no chrome by design, so the hit-test walks
**outward** to the nearest node that has some. Hovering a CTA's label rings the
anchor around it rather than clearing — without this the page would feel dead
wherever text sits.

Also: a value node's wrench is now named after its field. It was "Layout &
settings", which describes a container's panel — but a value node's wrench is its
entire toolbar and opens one field.
