# @louise-toolkit/astro

**Astro adapter for [Louise Toolkit](https://github.com/bowenlabs/louise-toolkit)** —
middleware, Actions, content-layer loaders, and the forms schema bridge.

> **Status: pre-1.0, experimental.** The API changes between minor versions —
> pin an exact version if you depend on it.

## Why this is a separate package

`louise-toolkit` is framework-agnostic, and that claim is enforced rather than
merely stated: CI fails if the string "astro" appears anywhere in the library's
source, in code or in prose. Everything that has to import Astro's types lives
here instead.

So the dependency runs one way — this package depends on `louise-toolkit`, never
the reverse — and `astro` is an **optional peer**, pulled in only by sites that
actually import this adapter.

## Install

```sh
pnpm add @louise-toolkit/astro louise-toolkit astro
```

Building a whole site rather than wiring one by hand? Use
[`astroidjs`](https://www.npmjs.com/package/astroidjs), the opinionated preset on
top of both, or scaffold one with `pnpm create astroid`.

## What it gives you

**Middleware** — one factory that mounts Louise's editor routes, session handling
and optional rate limiting into an Astro site.

```ts
// src/middleware.ts
import { createLouiseMiddleware } from "@louise-toolkit/astro";

export const onRequest = createLouiseMiddleware({/* ... */});
```

**Actions** — the editor write path as Astro Actions, so a save is a typed call
rather than a hand-rolled endpoint. `louiseSaveAction`, `louiseSaveDraftAction`
and `louiseSettingsAction` wrap the same primitives the framework exposes, which
is why an agent writing over MCP and a human clicking in the editor take the
identical code path.

**Content-layer loaders** — `louiseLoader` feeds Louise-managed rows into Astro's
content layer, and `collectionToAstroSchema` derives the Zod schema from the same
`CollectionConfig` that drives codegen and the editor. One definition, not two
that drift.

**Catalog loader** — `defineCatalogLoader`, for commerce catalogs.

**Forms bridge** — `formToAstroSchema`, deriving an Astro-shaped schema from a
Louise `FormConfig`.

## Full exports

| export                                                                | what it is                                    |
| --------------------------------------------------------------------- | --------------------------------------------- |
| `createLouiseMiddleware`                                              | mounts editor routes, sessions, rate limiting |
| `louiseSaveAction` · `louiseSaveDraftAction` · `louiseSettingsAction` | the editor write path as Astro Actions        |
| `louiseLoader` · `collectionToAstroSchema`                            | content-layer loader and its derived schema   |
| `defineCatalogLoader`                                                 | commerce catalog loader                       |
| `formToAstroSchema`                                                   | `FormConfig` → Astro schema                   |

Types ship alongside each: `LouiseMiddlewareConfig`, `LouiseMiddlewareRateLimit`,
`EditorActionContext`, `EditorActionDeps`, `LouiseSaveActionConfig`,
`LouiseSaveDraftActionConfig`, `LouiseSettingsActionConfig`, `SaveActionInput`,
`SaveDraftActionInput`, `ActionErrorCtor`, `LouiseLoaderConfig`, `LouiseRow`,
`CatalogLoaderConfig`.

## License

MIT © BowenLabs. See [LICENSE](./LICENSE).
