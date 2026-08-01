---
"louise-toolkit": patch
---

feat(sections): warn when a richText field is rendered into a `<p>`

A `richText` value is HTML the editor produced — `<p>`, lists, blockquotes.
Rendering it into a `<p>` is invalid nesting, and the parser does not merely
tolerate it: it CLOSES the paragraph and hoists the block content out as a
following sibling. The `data-louise-node` marker stays on the now-empty `<p>`,
so the editor mounts on nothing while the prose sits outside it, unmarked and
uneditable — and every paragraph break the editor creates is hoisted straight
back out.

Nothing about that fails loudly. The page renders; the field is simply inert.
Two sites shipped it independently before anyone noticed, which is why this
belongs in the framework rather than in each site's conventions.

`wireInline` already knows the field is `richText` and holds the node, so it now
checks the tag and warns with the field's path and the remedy. Warning only —
the field still half-works, and breaking an owner's editing session over a
markup nit would be the worse failure. Plain-text fields in a `<p>` are correct
and say nothing.
