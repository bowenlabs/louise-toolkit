---
"louise-toolkit": minor
---

The add-section and add-block pickers now show each type's icon and a one-line description under its label (#546). Before, an owner picked from names such as "Split image" with no idea what each looked like.

`SectionDef` and `BlockDef` gain an optional `description`, one short sentence. The picker draws `icon` when it's inline SVG markup, such as a Phosphor icon imported with `?raw`, sized to the text and drawn in `currentColor`. It leaves any other `icon` string out, as it did before, because a bare name like `grid` could match a site's own CSS on the page.

To adopt, give each catalog entry a `description`, and switch `icon` from a name to SVG markup. Nothing breaks if you don't: a type with neither shows its label, as before.
