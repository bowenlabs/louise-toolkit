---
title: editor
description: "louise-toolkit/editor—framework-generic api/louise/* route handlers for Louise Settings."
sidebar:
  order: 11
---

```ts
import {
  saveRoute,
  settingsRoute,
  blobSettingsRoute,
  pagesRoute,
  versionsRoute,
  searchRoute,
  mediaRoute,
  listMediaRoute,
  formRoute,
  inquiriesRoute,
  seedRoute,
  statusRoute,
  d1Check,
  ageCheck,
  runEditorRoute,
} from "louise-toolkit/editor";
```

The server-side counterpart to the [Louise Settings](/guide/settings/): framework-generic
`api/louise/*` request→response handlers. Each factory returns a
[`WorkerRoute`](/reference/client/)—`(request, env, ctx) => Response | undefined`—that [`composeWorker`](/reference/client/) composes, so a site wires the ones
it needs, passes its own Drizzle tables, and keeps bespoke resource routes
(products, artworks…) per-site. Sites not on `composeWorker` (Astro, Nitro…) run
the same handlers with [`runEditorRoute`](#adapting-to-astro-or-any-non-worker-host).
The framework panels (Pages/Media/Settings) and the default Inquiries panel
call these endpoints. Peer: `drizzle-orm`.

## Composing the routes

```ts
import { composeWorker } from "louise-toolkit/worker";
import {
  pagesRoute,
  mediaRoute,
  settingsRoute,
  saveRoute,
  inquiriesRoute,
} from "louise-toolkit/editor";
import { getLouiseAuth, resolveEditorSession } from "louise-toolkit/auth";
import { pages, media, siteSettings, inquiries } from "./db/schema";

// Bridge the site's auth once; every route reuses it. `getLouiseAuth` and
// `resolveEditorSession` come from louise-toolkit/auth — see the auth reference.
const resolveEditor = async (request: Request, env: Env) =>
  resolveEditorSession(await getLouiseAuth(env, request.url, authConfig), request);

export default composeWorker({
  routes: [
    pagesRoute({ table: pages, resolveEditor }),
    mediaRoute({
      table: media,
      resolveEditor,
      referenceSources: [/* … */],
    }),
    settingsRoute({
      table: siteSettings,
      resolveEditor,
      columns: ["siteName", "navLinks" /* … */],
    }),
    saveRoute({
      resolveEditor,
      collections: {/* … */},
    }),
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
each route calls `guardEditor`, which runs [`requireEditor`](/reference/auth/):
it verifies the session **and**, on mutations, enforces a same-origin (CSRF)
check. Reads skip the same-origin check; writes require it.

## Adapting to Astro (or any non-Worker host)

The handlers are `composeWorker` `WorkerRoute`s—`(request, env, ctx)`. A site on
an Astro (or Nitro/Nuxt/…) adapter resolves the editor session in middleware and
has no `ExecutionContext` to hand the route, so wrap it with **`runEditorRoute`**:
it supplies a no-op `ctx` and turns a path fall-through (`undefined`) into a 404.
Because the session is already resolved, `resolveEditor` just hands it back—no
second auth path:

```ts
// Astro: src/pages/api/louise/inquiries.ts
import { inquiriesRoute, runEditorRoute } from "louise-toolkit/editor";
import { inquiries } from "../../../db/schema";
import { env } from "cloudflare:workers";

export const ALL: APIRoute = (ctx) =>
  runEditorRoute(
    inquiriesRoute({ table: inquiries, resolveEditor: () => ctx.locals.editor }),
    ctx.request,
    env,
  );
```

`runEditorRoute(route, request, env): Promise<Response>`.

## Routes

| Factory             | Endpoint                             | Methods                                                                 |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `pagesRoute`        | `/api/louise/pages` (+ `/:id`)       | GET list · POST create · GET/PATCH/DELETE one                           |
| `versionsRoute`     | `/api/louise/pages/:id/…`            | GET/POST `versions` · POST `publish` · POST `unpublish`                 |
| `searchRoute`       | `/api/louise/pages/{search,reindex}` | GET `search?q=` · POST `reindex`                                        |
| `mediaRoute`        | `/api/louise/media`                  | GET list · POST upload · PATCH alt/caption · DELETE (reference-scanned) |
| `listMediaRoute`    | `/api/louise/media`                  | registry-less variant: lists R2 directly, per-request `scope`           |
| `settingsRoute`     | `/api/louise/settings`               | GET · POST/PATCH (structured base + `custom`)                           |
| `blobSettingsRoute` | `/api/louise/settings`               | GET · POST/PATCH—single-JSON-blob variant                               |
| `saveRoute`         | `/api/louise/save`                   | POST (inline field save)                                                |
| `formRoute`         | `/api/louise/forms/<name>`           | **public** POST capture (same-origin + spam guard)                      |
| `inquiriesRoute`    | `/api/louise/inquiries`              | GET list · DELETE one                                                   |
| `submissionsRoute`  | `/api/louise/submissions/<form>`     | GET list · DELETE one—a form's rows in the shared table                 |
| `seedRoute`         | `/api/louise/seed`                   | seeds the `site_settings` singleton (idempotent)                        |
| `statusRoute`       | `/api/louise/status`                 | **public** GET · HEAD: 200 or 503 from the site's checks                |

- **`pagesRoute`**—content pages CRUD. Create/update are allowlisted to
  `fields` (defaults `DEFAULT_PAGE_FIELDS`) and rich fields (`body`) are run
  through `sanitizeRichHtml` before store. An optional `validate(data, ctx)` hook
  runs after allowlisting and before the write—throw `LouiseValidationError`
  (for example, via [`assertValidSections`](/guide/sections/#validation)) to reject with a
  `422` carrying the per-field `violations`. An optional `afterWrite(editor,
{ operation, id })` hook runs after each create, update, and delete, and a
  throw from it never fails the write. Plain CRUD writes don't touch the search
  index, so pass `afterWrite: (_editor, { id }) => reindexDoc(db(env.DB), pages,
pagesCollection, id)` to keep that one row searchable, rather than rebuilding
  the whole index with `reindexSearch` after every edit.
- **`versionsRoute`**—the [draft/publish + version history](/guide/drafts/)
  surface for a `versions` collection: `GET/POST /api/louise/pages/:id/versions`
  (list / save a draft), `POST …/:id/publish` (`{ versionId? }`, default the latest
  draft), `POST …/:id/unpublish`. A save merges the edit over the current row and
  stores a full snapshot in `${slug}_versions`; publish promotes it onto the live
  row and sets `published_version_id`. Takes `{ table, versionsTable, config,
resolveEditor, validate? }`; **mount it before `pagesRoute`** so its
  `/:id/versions` paths aren't claimed by `pagesRoute`'s `/:id` matcher.
- **`searchRoute`**—full-text search over a collection with a `search` config:
  `GET /api/louise/pages/search?q=…&limit=…` returns ranked (published) rows from
  the FTS5 index; `POST …/reindex` rebuilds it from the table. A `json` field in
  `search.fields` is indexed by flattening every string leaf, so structured
  `sections` content is searchable. Also **mount before `pagesRoute`**. Pass
  `vector: { index, ai }` to add a semantic layer: the route embeds the query,
  queries Vectorize, and merges both result lists with
  [`fuseRankings`](/reference/ai/#rank-fusion). Without the bindings it stays
  FTS-only. `vector.minScore` drops semantic matches below a score floor before
  the merge; it has no default.
- **`mediaRoute`**—wraps [`louise-toolkit/media`](/guide/media/): magic-byte-
  sniffed uploads (recording intrinsic `width`/`height`), the registry list,
  `PATCH` to set an asset's [`alt`/`caption`](/guide/media/#asset-level-alt-caption-and-dimensions)
  (only those two columns are writable), and a delete-safety reference scan (a
  `409 in_use` unless `?force=1`). Its env widens `EditorRouteEnv` with the R2
  bindings (`MediaRouteEnv`: `MEDIA`, `MEDIA_URL`).
- **`listMediaRoute`**—the same GET/POST/DELETE contract as `mediaRoute` but
  with **no `media` registry table**: GET lists the R2 bucket directly via
  `listMedia`, and POST reads an allowlisted upload `scope` from the form
  (`scopes`, first is the default) rather than a fixed one. Same `MediaRouteEnv`
  (delete-safety still scans D1 content tables).
- **`formRoute`**—the **public** capture companion to `inquiriesRoute`, built
  from a [`defineForm`](/guide/forms/) definition. POST only, **same-origin-guarded
  but not session-gated** (anyone may submit): validates + coerces against the
  form's fields (`422` with per-field `violations`), enforces the declared spam
  guard (KV rate limit via `rateLimitKv`, Turnstile via `turnstileSecret`, and
  silent honeypot/timing heuristics), inserts the row, and fires the form's
  `notify` (webhook + email via a `mailer`) off the response path. Pass
  `genericTable` to store into the shared `submissions` table (`{ form, data }`)
  so an ad-hoc form needs no migration. Mounted at `/api/louise/forms/<name>`.
- **`submissionsRoute`**—the editor-gated review companion for a generic
  `formRoute` (`genericTable`): GET lists one `form`'s rows from the shared
  `submissions` table newest-first (parsing `data` back onto each row), DELETE
  removes one by `?id=`. Gives each catalog form its own review tab over one table.
- **`settingsRoute`**—GET/PATCH the `site_settings` singleton. **Extensible,
  not a closed set:** it patches an allowlisted structured base (`columns`, the
  framework [`siteSettingsColumns`](/reference/db/)) and merges site-declared
  `customKeys` into the `custom` JSON. A key in neither allowlist is ignored,
  never written—this is what backs the **Settings** panel's
  [extension groups](/guide/settings/#extending-settings). Declare `imageKeys`
  (with `mediaBase` = your `MEDIA_URL`) to reject an image setting (logo,
  favicon, share image…) that isn't a [media asset](/guide/media/#strict-media-every-image-from-the-library)—a `422`.
- **`blobSettingsRoute`**—the variant for sites that keep all config in a
  single JSON **blob** column (not the structured `siteSettingsColumns`), paired
  with the Settings' `settingsBaseGroups: []` + render fields. `allow` is a
  `{ key: sanitize }` map (only listed top-level keys are merged into the blob,
  each through its sanitizer; anything else is ignored); an optional `read`
  transforms the blob on GET (for example, seed-merge). GET returns `{ settings: <blob> }`.
- **`saveRoute`**—the inline edit-on-the-page save endpoint. Each collection
  declares its editable fields (`SaveCollectionConfig`); values are resolved and
  sanitized before write.
- **`inquiriesRoute`**—read-mostly: list submissions newest-first, delete one
  by `?id=`.
- **`statusRoute`**—the **public** route an outside probe reads. See
  [The status route](#the-status-route).

## The status route

`statusRoute` answers whether the site works, for something outside Cloudflare
to poll. It answers `GET` and `HEAD` at `/api/louise/status` with 200 when every
check passes and 503 when any check fails, throws, or times out. It's a
[`publicRoute`](/reference/worker/#the-editor-api-gate-gate-and-publicrouteroute),
so the API gate lets an anonymous probe through, and the
`@louise-toolkit/astro` middleware exempts its default path too.

```ts
import { ageCheck, d1Check, statusRoute } from "louise-toolkit/editor";
import { readHealthSummary } from "louise-toolkit/health";

const HOUR = 60 * 60 * 1000;

statusRoute<Env>({
  checks: {
    db: d1Check((env) => env.DB),
    // A daily scan, so 36 hours leaves room for one late run.
    healthScan: ageCheck(async (env) => (await readHealthSummary(env.KV))?.checkedAt, 36 * HOUR),
    // Anything else that means "working" for your site: return true or false.
    content: async (env) => !(await readsSeedContent(env)),
  },
  reuseMs: 10_000,
});
```

```json
{
  "ok": false,
  "checks": {
    "db": { "ok": true },
    "healthScan": { "ok": false, "ageMs": 190800000 },
    "content": { "ok": true }
  }
}
```

**You supply the checks.** Only your site knows what "working" means, so the
route has none of its own. A check is `(env, signal) => boolean | { ok, ageMs? }`,
sync or async, and anything other than `true` or `{ ok: true }` counts as a
failure. With no checks, the route answers 200 whenever the Worker runs. Two
builders cover the generic cases:

- **`d1Check(db)`** passes when the database answers `SELECT 1`. It reads no
  rows, so it costs next to nothing. A missing binding fails it.
- **`ageCheck(read, maxAgeMs)`** passes when the timestamp `read` returns (an
  ISO string, epoch milliseconds, or a `Date`) is no older than `maxAgeMs`, and
  reports the age: the last health scan, a catalog snapshot, any scheduled
  job's last success. A missing or unparseable timestamp fails with no age. A
  future one (clock skew) passes with an age of 0.

**The body carries booleans and ages, never an error's text.** A check that
throws is logged with `console.error` and reports `{ ok: false }`; the message
and stack stay in your logs. The check names appear in the body, so don't put
anything in a name you wouldn't publish. Every response, including a 405, has
`Cache-Control: no-store`, so no cache between the probe and the Worker can
answer for it.

**Every check has a timeout,** `timeoutMs` (default `STATUS_CHECK_TIMEOUT_MS`,
2 seconds). The checks run at once, so a hung dependency makes a 503 in about
that long, not a hung probe. The check's `signal` aborts at the timeout; pass
it to a `fetch` so the request stops too.

**Keep the checks cheap: anyone can make them run.** Set `reuseMs` to reuse a
finished result for that long, within one Worker isolate, so a burst of
requests costs one run of the checks per isolate. It defaults to `0`: every
request runs them.

`runStatusChecks(env, checks, { timeoutMs })` is the same run without the
route, for a scheduled job that wants the same answer. `path` changes the mount
from `/api/louise/status`. If you move it, a framework middleware gate no
longer exempts it by default: add the new path to `apiGate.isPublic`.

## Resuming a draft

`resumeDraft(d1, { versionsTable, collection, bufferKv? }, row)` returns the
editor's work-in-progress for a versioned row (`{ id, publishedVersionId }`), or
`null`: the KV buffer first, then the newest draft newer than the live pointer.
That is the same base `applySaveDraft` layers a save onto, so edit mode shows what
the next save builds on. See [Drafts → Rendering](/guide/drafts/#rendering).

## Pure helpers

The security-sensitive logic is factored into pure, testable functions you can
reuse or unit-test:

- `pickFields(input, fields, richFields, sanitize)`—allowlist + sanitize a
  create/update payload (`pagesRoute`).
- `partitionSettingsPatch(patch, columns, customKeys)`—split a settings patch
  into base-column updates, `custom` updates, and ignored keys (`settingsRoute`).
- `mergeBlobPatch(blob, patch, allow)`—merge an allowlisted `{ key: sanitize }`
  patch into a settings blob, returning `{ blob, ignored, changed }` without
  mutating the input (`blobSettingsRoute`).
- `resolveFieldValue(...)`—resolve one inline-save field against its collection
  config (`saveRoute`).

Also exported: `runEditorRoute`, `guardEditor`, `json`, `matchPath`, `ident`,
`tableMeta`, and the `EditorRouteEnv` / `ResolveEditor` types.

### Mounting a write on your own transport

Three helpers are the route-free cores of the write paths, for a host that mounts
its own endpoint rather than using the `WorkerRoute`s above—an Astro Action, say:

- `applyFieldSave(env, config, session, input)`—one inline field write, the body
  of `saveRoute`.
- `applySaveDraft(env, deps, session, id, snapshot)`—a versioned draft write, the
  body of the draft route. This is also what the realtime Durable Object calls, so
  there is exactly one write path rather than two that can drift.
- `applySettingsPatch(env, config, session, patch)`—a settings write, the body of
  `settingsRoute`.

They run the same validation, sanitization and access checks the routes do; the
route is only the transport. Reach for these when the transport is yours and the
behaviour should not be.
