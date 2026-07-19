---
"astroidjs": minor
"create-astroid": minor
---

Put Astroid's section library on Louise's actual section/block model (ADR 0005), replacing the parallel one it had (#260, part 1).

**The problem.** Astroid's `<Section>` dispatched on a `kind` prop with `colorway`/`align` as component props and a `SectionProps` union. Louise's model — the one the on-canvas editor and the write-time validator both read — differs in every particular: a section is a stored `SectionItem` (`{ _type, blocks?, _layout?, _settings?, ...fields }`), its shape is declared once as a `SectionDef` in a `SectionCatalog`, and presentation choices are `_settings`/`_layout` **tokens** that Louise stores and the site maps to CSS. Two models meant Astroid's sections could not be edited on canvas at all: nothing called `mountSections`, and no component emitted a `data-louise-sfield` marker.

**`astroidSectionCatalog`** is now the single declaration of what a section is — the same object `mountSections` edits with and `assertValidSections` validates writes against, so a field can't be editable-but-invalid or validated-but-uneditable. `colorway`/`align` become `_settings` tokens; `COLORWAY_CLASS`/`ALIGN_CLASS` stay as the site-owned half of that contract, so a re-theme still needs no content rewrite. Repeatables stay real arrays (`featureGrid.items`) rather than the `card1…card6` flattening — `base` makes the marker path positional, and the client's path parser is already depth-agnostic.

**The marker contract splits the way ADR 0005 §2 splits it.** `<Section>` stamps the *boundary* (`data-louise-section` / `data-louise-block`), because only the dispatcher knows an item's position; components stamp *fields* via `<Editable base={base} field="…">`, because only the component knows which of its text nodes are editable. A component never learns its own depth, which is what lets the same component render as a section or as a block — blocks recurse through `<Section>` with a deeper `base`.

**One media lookup per page, not per image.** A section stores an image as a URL, but the `alt`/`caption` an editor typed live on the media asset — so rendering images correctly means joining back to the registry, and doing it per image is thirty D1 round-trips for one gallery. `<Sections>` resolves the whole page in one bounded `IN (...)` (chunked under SQLite's parameter ceiling) and threads the result down. The collection step is schema-driven: it walks the catalog for `type: "image"` fields, including inside arrays and discriminated variants, so a new section with an image is picked up because it *declared* one — not because someone remembered to update a list.

The scaffold is wired end to end: the home page renders `<Sections>` from the page's `sections` column (draft-aware in edit mode), `LouiseEdit.astro` mounts the on-canvas editor against the catalog, the seed ships three real sections, and the pages collection sanitizes + validates `sections` on write.

Two notes on things that bit during this work, both recorded in code:

- The pages hook loads `assertValidSections` / `sanitizeSectionsRichText` via a **dynamic** import. `louise-toolkit/content`'s sections module reaches drizzle-orm for real (sections → validation → `import { and, eq, ne }`), and drizzle is an *optional* peer — a static import would put it back in the graph of every caller that only describes content, which is exactly what shipped a broken `create-astroid` to the registry once and why `content/define` exists. Deferring it keeps the CLI drizzle-free while the running site gets real validation. The proper fix is to split the Rule evaluator out of `validation.ts`.
- `.astro` files are invisible to `tsgo` and vitest, so before this the entire section library compiled nowhere. Now that the scaffold renders sections, CI's `astro check` reads them — and it immediately caught two real errors (`mountSections` takes `(el, opts)`, and `querySelector` returns `Element`, not `HTMLElement`).

The 11 new section types (Gallery, Media, SplitImage, Steps, Banner, FAQ, PricingTiers, Testimonial, AboutIntro, ProductGrid, LocationHours) land next, on this contract.
