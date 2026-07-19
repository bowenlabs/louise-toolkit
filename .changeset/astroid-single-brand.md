---
"astroidjs": minor
---

Collapse `defineAstroid` to a single brand. Every site Astroid targets
(coracle.coffee, ghostfire.coffee, themidwestartist.com, louise-web) serves one
brand from one deploy — none does host/tenant dispatch — so the `brands[]` array
was speculative complexity. The config now hoists `key`/`archetype`/`theme`/
`sections`/`modules`/`portal` to the top level, and the schema generator drops the
`brand` discriminator column + per-brand slug. The axis that genuinely multiplexes
is *editors* (the org plugin, #100) and *audiences* (a gated `portal`), both kept
as options on the one brand.

Breaking: `brands[]`, `BrandConfig`, `isMultiBrand`, and `commerce.sharedCatalog`
are removed; `BrandTheme`/`BrandPortal` are renamed to `Theme`/`Portal`. Added a
`"marketing"` archetype (the louise-web floor). Nothing consumes `astroidjs` yet,
so there is no downstream migration.
