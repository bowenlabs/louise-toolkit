---
"louise-toolkit": patch
---

Fix: edit mode no longer blocks the site's own navigation.

The edit-mode guard that keeps a stray click from losing an edit session was blocking **every** `a[href]` outside the editor's own chrome — which included the site's header nav, footer links, brand mark and skip link. An editor could not reach another page at all without first leaving edit mode.

The guard is now scoped to the **editing surfaces**: a link is inert only when it sits inside a marked node (`data-louise-node`), the sections host (`data-louise-sections`), or a legacy inline field (`data-louise-field`). Clicking a CTA you are editing still edits its label rather than navigating; everything else navigates normally.

The predicate is exported as `isEditableSurfaceLink` so both failure directions are pinned by test: blocking too little loses an edit to a stray click, blocking too much strands the editor on one page.
