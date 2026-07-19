---
"louise-toolkit": minor
"astroidjs": minor
---

Add `select` — a closed-choice `SectionField` type (#272).

`_settings` and `_layout` store **tokens** the site maps to CSS (ADR 0005 §5), and a token set is closed by definition. But `SectionFieldType` had no way to say "one of these", so a four-value setting like a colorway had to be declared as `text`. Three things followed from that, all bad: the inspector rendered a free-text box for a picker's job, the valid values could only be documented in `placeholder`, and a typo was **not a validation error at all** — it degraded silently at render time, where the site fell back to a default and quietly produced the wrong design.

The asymmetry is what makes it a gap rather than a decision: `_layout` already worked this way. `validateLayout` rejects a token that isn't a declared layout. Settings and regular fields simply had no equivalent.

`SectionField` now takes `options: { value, label? }[]` plus an opaque `display` hint (`"swatch"`, passed through untouched like `SectionDef.icon` — the schema layer has no business knowing what a swatch looks like). The validator rejects a value outside the set with a message naming what was expected, mirroring `validateLayout`'s shape. Absent stays a no-op, and empty string means *cleared* — the picker's blank option, which hands the choice back to the component's own default.

On the client, the inspector's field group and its settings rail each carried their own nested `<Show>` ladder for text-vs-textarea, so a third shape would have meant a third level of nesting in both. They now share one `ScalarField`, and a new field type is added once.

Astroid's `SECTION_SETTINGS` declares `colorway`/`align` as `select`, with options **derived from `COLORWAY_CLASS` / `ALIGN_CLASS`** — so the set a picker offers and the set the site can actually render are the same list by construction, and adding a colorway stays one edit instead of an edit plus a remembered second edit that would otherwise offer a token nothing maps.
