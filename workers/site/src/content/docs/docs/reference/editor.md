---
title: editor
description: "louisecms/editor — framework-generic api/louise/* route handlers for the drawer."
sidebar:
  order: 11
---

```ts
import {
  saveRoute,
  settingsRoute,
  pagesRoute,
  mediaRoute,
  inquiriesRoute,
  seedRoute,
} from "louisecms/editor";
```

The server-side counterpart to the [drawer](/docs/guide/drawer/): framework-generic
`api/louise/*` request→response handlers. Each factory returns a
[`WorkerRoute`](/docs/reference/client/) that [`composeWorker`](/docs/reference/client/)
composes — so a site wires the ones it needs, passes its own Drizzle tables, and
keeps bespoke resource routes (products, artworks…) per-site. The framework
drawer panels (Pages/Media/Settings) and the default Inquiries panel call these
endpoints. Peer: `drizzle-orm`.

## Composing the routes

```ts
import { composeWorker } from "louisecms/worker";
import { pagesRoute, mediaRoute, settingsRoute, saveRoute, inquiriesRoute } from "louisecms/editor";
import { getLouiseAuth, resolveEditorSession } from "louisecms/auth";
import { pages, media, siteSettings, inquiries } from "./db/schema";

// Bridge the site's auth once; every route reuses it. `getLouiseAuth` and
// `resolveEditorSession` come from louisecms/auth — see the auth reference.
const resolveEditor = async (request: Request, env: Env) =>
  resolveEditorSession(await getLouiseAuth(env, request.url, authConfig), request);

export default composeWorker({
  routes: [
    pagesRoute({ table: pages, resolveEditor }),
    mediaRoute({ table: media, resolveEditor, referenceSources: [/* … */] }),
    settingsRoute({ table: siteSettings, resolveEditor, columns: ["siteName", "navLinks", /* … */] }),
    saveRoute({ resolveEditor, collections: { /* … */ } }),
    inquiriesRoute({ table: inquiries, resolveEditor }),
  ],
  // …your bespoke routes + SSR fallthrough.
});
```

## Auth: `resolveEditor` + the guard

Every route is decoupled from any one auth wiring by a site-supplied
`ResolveEditor`:

```ts
type ResolveEditor<Env> = (
  request: Request,
  env: Env,
) => EditorSession | null | Promise<EditorSession | null>;
```

Returning `null` means "not an editor" and the route answers 401/403. Internally
each route calls `guardEditor`, which runs [`requireEditor`](/docs/reference/auth/):
it verifies the session **and**, on mutations, enforces a same-origin (CSRF)
check. Reads skip the same-origin check; writes require it.

## Routes

| Factory | Endpoint | Methods |
| --- | --- | --- |
| `pagesRoute` | `/api/louise/pages` (+ `/:id`) | GET list · POST create · GET/PATCH/DELETE one |
| `mediaRoute` | `/api/louise/media` | GET list · POST upload · DELETE (reference-scanned) |
| `settingsRoute` | `/api/louise/settings` | GET · POST/PATCH |
| `saveRoute` | `/api/louise/save` | POST (inline field save) |
| `inquiriesRoute` | `/api/louise/inquiries` | GET list · DELETE one |
| `seedRoute` | `/api/louise/seed` | seeds the `site_settings` singleton (idempotent) |

- **`pagesRoute`** — CMS pages CRUD. Create/update are allowlisted to
  `fields` (defaults `DEFAULT_PAGE_FIELDS`) and rich fields (`body`) are run
  through `sanitizeRichHtml` before store.
- **`mediaRoute`** — wraps [`louisecms/media`](/docs/guide/media/): magic-byte-
  sniffed uploads, the registry list, and a delete-safety reference scan (a
  `409 in_use` unless `?force=1`). Its env widens `EditorRouteEnv` with the R2
  bindings (`MediaRouteEnv`: `MEDIA`, `MEDIA_URL`).
- **`settingsRoute`** — GET/PATCH the `site_settings` singleton. **Extensible,
  not a closed set:** it patches an allowlisted structured base (`columns`, the
  framework [`siteSettingsColumns`](/docs/reference/db/)) and merges site-declared
  `customKeys` into the `custom` JSON. A key in neither allowlist is ignored,
  never written — this is what backs the drawer's Settings
  [extension groups](/docs/guide/drawer/#extending-settings).
- **`saveRoute`** — the inline edit-on-the-page save endpoint. Each collection
  declares its editable fields (`SaveCollectionConfig`); values are resolved and
  sanitized before write.
- **`inquiriesRoute`** — read-mostly: list submissions newest-first, delete one
  by `?id=`.

## Pure helpers

The security-sensitive logic is factored into pure, testable functions you can
reuse or unit-test:

- `pickFields(input, fields, richFields, sanitize)` — allowlist + sanitize a
  create/update payload (`pagesRoute`).
- `partitionSettingsPatch(patch, columns, customKeys)` — split a settings patch
  into base-column updates, `custom` updates, and ignored keys (`settingsRoute`).
- `resolveFieldValue(...)` — resolve one inline-save field against its collection
  config (`saveRoute`).

Also exported: `guardEditor`, `json`, `matchPath`, `ident`, `tableMeta`, and the
`EditorRouteEnv` / `ResolveEditor` types.
