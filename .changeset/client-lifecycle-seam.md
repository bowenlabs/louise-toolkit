---
"louise-toolkit": minor
---

client: a framework-neutral page-lifecycle seam, replacing the Astro event listeners

**Breaking for hosts with soft navigation.** The client no longer listens for
`astro:before-swap` / `astro:after-swap` itself. Those names are the host's now:
it calls `louiseNavigation.beforeSwap()` and `.afterSwap()`, and Louise never
learns what produced the signal.

```ts
import { louiseNavigation } from "louise-toolkit/client";

document.addEventListener("astro:before-swap", louiseNavigation.beforeSwap);
document.addEventListener("astro:after-swap", louiseNavigation.afterSwap);
```

**Wire this if your site uses view transitions, or a soft navigation will silently
drop pending edits.** That is the whole reason the listeners existed (#74): a
router-driven nav fires none of `pagehide`, `beforeunload` or `visibilitychange`,
so without a flush hung off the swap the last edit is lost. Nothing errors if you
forget — it just stops saving on soft navs, which is why it is called out here
rather than left to a type error. Hard navigations are unaffected; Louise still
wires those browser events itself.

Sites with no soft navigation need no change at all.

**Why.** `louise-toolkit` is described as framework-agnostic and shipped the name
of one specific framework's events in its client (#327 Phase 1). It also meant the
editor could only ever integrate with Astro's router: any other host had the same
need and no way to express it. The seam is the smaller and more honest surface —
two functions a host calls, and a `onLouiseNavigate(phase, handler)` subscription
the client's own modules use internally.

Behaviour is otherwise unchanged: the page editor still flushes and guards, the
section dock still flushes its pending draft, the settings drawer still disposes
before the DOM is replaced, and the realtime socket still closes so it cannot leak
across a navigation. An `ast-grep` rule now fails the build if an `astro:` event
name reappears under `src/client`.
