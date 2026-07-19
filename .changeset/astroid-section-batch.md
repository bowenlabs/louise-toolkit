---
"astroidjs": minor
---

Add the 11 section types #260 called for, on the ADR 0005 contract: `gallery`, `media`, `splitImage`, `steps`, `banner`, `faq`, `pricingTiers`, `testimonial`, `aboutIntro`, `productGrid`, `locationHours`.

Each is a catalog entry (schema the editor and the validator share) plus a render component that owns its markup. Settings are `select` tokens, so colorway and alignment are pickers rather than free text. A few choices worth naming:

- **The asset-level alt fallback is now live.** `<Sections>` resolved media metadata in one query but nothing consumed it. Every image-bearing section takes its `alt` from the section row when set, and otherwise from the media library — so fixing alt text once propagates to every page showing that asset. When neither exists the alt is `""` (decorative), never a missing attribute, which is what makes a screen reader read the filename.
- **`splitImage` puts the image side in `_layout`**, not `_settings` — it's a named arrangement of the same content, which is what layouts are for.
- **`faq` uses native `<details>`**: keyboard- and screen-reader-correct with no script, works before hydration, and browser find-in-page can open a collapsed answer, which a div accordion silently breaks. It renders `open` in edit mode, since a collapsed answer can't be edited in place.
- **`productGrid` is authored content, not a live catalog read.** The commerce mirror has its own loader and freshness story; wiring it into a section would mean the editor edits a value that isn't what renders.
- **`locationHours` uses a `<dl>`** — each day is a term and its hours the description, which is what the pairing is.

**Dispatch became data.** `<Section>` now resolves `_type` through a `COMPONENTS` map instead of a ladder of comparisons, and a test asserts that map's keys and the catalog's are the same set — in both directions. A catalog entry with no component renders nothing (a silent hole, no error anywhere); a component with no catalog entry can never be added or edited, since the palette and the validator both read the catalog.

**A correction to what #270 claimed.** That PR said wiring the scaffold meant CI's `astro check` covered the section library. Only half true: `astro check` diagnoses files *inside the project*, so components imported from `node_modules/astroidjs` are invisible to it. It caught the `mountSections` bug because that lived in a scaffold file. Verified by putting a deliberate type error in a component — it passed straight through.

CI now copies the library's components under `src/` for one extra check pass. That immediately found three real defects that had been shipping unchecked: two in `Editable.astro`, where a ternary widened to a union carrying `"data-louise-type"?: undefined` and wasn't assignable to `Record<string, string>`, and one in `<Section>`, where `isRenderableSection` narrows to `string` (because `SectionCatalog` is `Record<string, SectionDef>`) and so could not index the component map at all.
