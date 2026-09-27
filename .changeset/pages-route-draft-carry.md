---
"louise-toolkit": minor
---

`pagesRoute` can keep an update in the page's pending draft (#530). The Pages panel saves a page's title, slug, and SEO fields to the live row through `pagesRoute`, but publish copies the whole draft snapshot onto that row. So when a page had a pending draft, the next publish put the old values back: a rename came undone, and a changed slug moved the page back to its old URL.

Pass `drafts: { config, bufferKv? }` with the same collection config and KV buffer you give `versionsRoute`. An update then also saves the fields the snapshot holds into the page's pending work, the KV buffer or else the newest pending draft, so the change survives the next publish. It still goes live right away, as before.

What to know when you upgrade:

- It's opt-in, and it needs `versionsTable`, which `pagesRoute` already takes for the delete cascade. Without `drafts`, an update behaves as before.
- A page with no pending work gets no draft, and a field outside the snapshot, such as `status`, stays on the live row only.
- If the draft refuses the change, the live write stands and the route reports `editor.pages.draftCarry` through `reportDegraded`. Until the draft is saved again, the next publish puts the old values back.
- An editor with the page open keeps its own copy of a renamed field. If it then saves that field, it gets the `409` conflict from #572, not a silent overwrite.
