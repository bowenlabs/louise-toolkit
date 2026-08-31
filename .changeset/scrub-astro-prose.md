---
"louise-toolkit": patch
---

Remove the last Astro references from the library's source

Comments only — no behaviour change. `packages/louise/src` now contains **zero**
mentions of Astro, in code or in prose, which is what closes Phase 1 of #327 and
makes "framework-agnostic" a fact rather than an aspiration.

Included: references to **Astroid** by name. In library source those are the
dependency direction backwards — the floor naming the ceiling — which the epic
called out separately from the Astro coupling. The facts they carried are kept;
only the upward name is gone.

`scripts/ci/checks/no-astro-in-core.mjs` keeps it that way, and ships the
substitutions that kept coming up ("a dev server" for `astro dev`, "a soft
navigation" for a view transition) so a failure carries a fix rather than only a
complaint.
