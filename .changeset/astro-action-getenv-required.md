---
"louise-toolkit": minor
---

Editor Actions (`louiseSaveAction` / `louiseSaveDraftAction` / `louiseSettingsAction`) now require an injected `getEnv` and no longer default to `locals.runtime.env`.

Astro v6+ removed `Astro.locals.runtime.env`, so the old default (`ctx.locals.runtime?.env`) resolved to `undefined` under the library's own supported peer (`astro ^7`) — every consumer relying on it 500-ed ("Astro.locals.runtime.env has been removed in Astro v6"). Rather than have the library reach for `cloudflare:workers` itself (the core primitives take their bindings by dependency injection — the library never imports the CF runtime as a value), `getEnv` is now a required dep. Inject the Worker env explicitly, the same way the site reads its bindings:

```ts
import { env } from "cloudflare:workers";
import { louiseSaveAction } from "louise-toolkit/astro";

louiseSaveAction({ collections, ActionError, getEnv: () => env });
```

A missing `getEnv` is now a compile error (it's a required field) and, for untyped callers, throws a clear error at action-construction time instead of a per-request 500. `getEditor` still defaults to `locals.editor`, and `EditorActionContext` no longer carries `locals.runtime` since the toolkit doesn't read it.
