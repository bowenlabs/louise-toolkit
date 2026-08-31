---
"louise-toolkit": minor
"@louise-toolkit/astro": minor
"create-astroid": minor
---

Astro support moves to `@louise-toolkit/astro`

**Breaking.** The `louise-toolkit/astro` subpath is gone. Its contents —
`createLouiseMiddleware`, the Action factories, `louiseLoader`,
`defineCatalogLoader`, `formToAstroSchema` — now live in a new package, and
`louise-toolkit` no longer declares Astro at all: no peer, no devDependency, no
export, no keyword.

```diff
-import { louiseLoader } from "louise-toolkit/astro";
+import { louiseLoader } from "@louise-toolkit/astro";
```

```sh
pnpm add @louise-toolkit/astro
```

Nothing else changes: same functions, same signatures, same behaviour. A
scaffolded project gets the new dependency automatically — `create-astroid`
derives its version the same way it derives the other two, and the generated
worker and Actions import from the new specifier.

**Why.** `louise-toolkit` is described as framework-agnostic and shipped an
`astro` peer dependency with an `./astro` export (#327). That claim should be
true rather than aspirational, and the practical cost was real: the toolkit could
not be published, versioned or reasoned about without Astro in the picture, and
Astro's own release cadence dragged the whole workspace.

Keeping the adapter as its own package rather than folding it into `astroidjs`
preserves the naming slot for a future host — a `/remix`, `/nuxt` or plain-Hono
adapter has somewhere obvious to go — and keeps the opinionated layer separate
from the thin binding.

The adapter versions independently of both core and `astroidjs`. It depends on
`louise-toolkit` through the public export map only, which is what
`scripts/ci/checks/export-map.mjs` now guards: the three symbols it needed that
were reachable only from `src/` were promoted to public in the preceding release.
