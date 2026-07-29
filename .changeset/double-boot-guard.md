---
"create-astroid": patch
---

**Fixed: the editor mounted twice on every page load.**

The scaffolded `LouiseEdit.astro` calls `boot()` at parse and again on
`astro:page-load` — which Astro's ClientRouter fires on the *initial* load, not
only on navigations. The second call landed while the first one's dynamic import
was still in flight, so both resolved and both mounted.

On a sections page that meant two on-canvas chromes, two toolbars, and **two
Publish buttons** over one store. Found on a live editor: two of everything
`mountSections` owns.

Each boot now claims a generation and only the newest one mounts. The template
also captures `mountSections`' disposer, which it was discarding entirely — so a
view-transition navigation left the previous page's flush and unsaved-changes
listeners attached.

`mountLouise` and `mountSettings` were unaffected: they are idempotent per page.
`mountSections` is not, which is why it was the one that showed.
