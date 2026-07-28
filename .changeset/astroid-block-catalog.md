---
"astroidjs": minor
---

`AstroidConfig.blockCatalog` — thread the site's block types into the `pages` write contract.

**Why.** `validateSections` and `sanitizeSectionsRichText` have both taken a
`blockCatalog` since ADR 0005, but Astroid's write hooks passed neither and the
config had no key to put one in. So a site could declare `blocks: { allow: [...] }`
on a section, wire the on-canvas block toolbar, add a block — and have every save
422 with "unknown block type". The editor looked like it worked and nothing
persisted.

Unlike `sectionCatalog` there is no built-in vocabulary to fall back on: block
types are wholly site-defined. So the default is `{}`, which is correct for a
sections-only site (with no section declaring a `blocks` policy, no block is ever
reached) and load-bearing for everyone else.

**It gates sanitization too, not just validation.** A block's rich-text fields are
only scrubbed when its def is resolvable, so this is what makes a `richText` block
field go through `sanitizeRichHtml` on write.

Wired into both write paths — the collection's `beforeChange` hook (the
`versionsRoute` path) and `astroidPagesWriteHooks` (the raw `pagesRoute` path) —
so the two keep enforcing one contract.

Sites using the block layer must now set it:

```ts
export default defineAstroidConfig({
  sectionCatalog: SECTIONS,
  blockCatalog: BLOCKS, // ← required once any section declares `blocks`
});
```

Additive: a site that sets neither is unchanged.
