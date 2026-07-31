---
"astroidjs": patch
---

**Declare the `astro` dependency astroid has always had.**

`astroidjs` imports `astro`, `astro/types` and `astro:actions`, and ships 25
`.astro` components — while declaring `astro` nowhere: not a dependency, not a
peer, not even a dev dependency. Its own typecheck passed only because `astro`
hoisted out of `louise-toolkit`'s devDependencies in the workspace.

That is invisible today and load-bearing tomorrow. In a scaffolded project it
happens to work, because `create-astroid`'s template pins `astro` itself and the
installer resolves it from there. What it costs is the two things a peer
dependency is for: nothing tells you which Astro versions this package actually
supports, and nothing complains when you install it somewhere Astro isn't. And
the moment astroid stops living beside louise in one workspace (#327), the hoist
disappears and its typecheck has no `astro` to resolve at all.

Now declared as an optional peer at `^7.0.9` — matched to what the template pins,
which is the version astroid is actually built and smoke-tested against — plus a
devDependency so the package typechecks on its own rather than on a neighbour's
graph.

Optional rather than required because `astroidjs` has a real non-Astro surface
(`defineAstroid`, the queue handler, the commerce and tenancy helpers) that runs
in a plain Worker, and a required peer would make that an install warning for no
reason.
