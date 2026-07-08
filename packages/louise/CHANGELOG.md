# louisecms

## 0.6.0

### Minor Changes

- Make the generic editor route handlers consumable from Astro (and other non-Worker hosts), plus panel/field fit-and-finish.

  - **build:** ship the `./editor` subpath — it was declared in `exports` but never built (missing from `vite.config.ts` `pack.entry`), so every generic handler (`settingsRoute`/`mediaRoute`/`inquiriesRoute`/…) was a dead import (#42).
  - **editor:** `runEditorRoute(route, request, env)` — supplies a no-op `ExecutionContext` + 404 fall-through so a composeWorker `WorkerRoute` runs from an Astro `APIRoute` via `resolveEditor: () => ctx.locals.editor` (#37).
  - **editor:** `blobSettingsRoute` (+ pure `mergeBlobPatch`) for sites that keep all config in one JSON blob column; `allow` is a `{ key: sanitize }` map with an optional `read` transform for GET seed-merge (#38).
  - **editor:** `listMediaRoute` — a media route variant with no `media` registry table (lists R2 via `listMedia`) that reads an allowlisted upload `scope` from the form (#41).
  - **client/drawer:** `ImageField` gains opt-in `upload` (upload-into-slot) and `transform(url)` (resize the preview, e.g. `cfImage`); defaults preserve pick/paste (#40).
  - **client/drawer:** the default `InquiriesPanel` row reads the framework `inquiriesColumns` (firstName/lastName/regarding), so a stock-schema site needs no custom `renderRow` (#39).

## 0.5.0

### Minor Changes

- 081a9c6: `mountDrawer` / `DrawerConfig` now thread a `settingsBaseGroups` option to the
  framework `SettingsPanel`. 0.4.0 added `baseGroups` to `SettingsPanel` but the
  drawer shell only forwarded `settingsExtension` / `settingsExtras`, so a site
  whose settings don't map to `siteSettingsColumns` (and keeps its own storage)
  still couldn't hide the empty framework base fields. Pass `settingsBaseGroups: []`
  (or a curated subset) so the Settings panel renders only the fields a site uses,
  with its own config in `settingsExtension`.

## 0.4.0

### Minor Changes

- 687747d: Make the drawer `SettingsPanel` flexible enough for sites whose settings diverge
  from the framework `siteSettingsColumns` (so a site isn't forced to show empty
  base fields or move everything into `settingsExtras`):

  - **`baseGroups` prop** — override which framework base groups render. Omit for
    all of the defaults (unchanged behavior); pass a subset (or reordered/edited
    copy) so only the framework fields a site actually uses appear.
  - **`SETTINGS_BASE_GROUPS` export** — the default framework groups, so a site can
    cherry-pick from them when composing its own `baseGroups`.
  - **`SettingsFieldDef.render`** — a custom field-UI escape hatch (a label/value
    row list, a microcopy grid, a per-page SEO editor, …) that persists to its
    `key` through the same load/save flow as a typed field. Overrides `type`;
    called once with the loaded value, so its internal state survives keystrokes.

  Backward compatible: omitting `baseGroups` and `render` keeps the previous fixed
  base groups + declarative extension behavior.

## 0.3.1

### Patch Changes

- ca97295: Make the subpath exports resolvable by CJS-based tools. The `exports` map only
  declared `types` + `import` conditions, so tools that resolve with Node's CJS
  algorithm — notably **drizzle-kit**, which loads a site's Drizzle `schema.ts` —
  failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` when a schema imported the shared
  column sets (`import { siteSettingsColumns, pagesColumns } from "louisecms/db"`).

  Each subpath now also carries a `default` condition pointing at the same ESM
  file. ESM consumers still match `import` first (unchanged); CJS-resolution tools
  fall through to `default` and resolve the module (then bundle it themselves).
  This unblocks importing the framework `louisecms/db` column sets into a site's
  Drizzle schema, which the site migrations rely on.

## 0.3.0

### Minor Changes

- 5c5396e: `louisecms/client/drawer` now ships the editor drawer **shell**, not just the
  data layer (#10 slice 2). `mountDrawer(config)` renders a registry-driven
  SolidJS overlay with a two-group layout whose split is first-class in the config
  type, so a site can't collapse it:

  - **Top strip — fixed framework panels:** `PagesPanel`, `MediaPanel`,
    `SettingsPanel`. Settings is extensible in-panel via declarative
    `settingsExtension` field groups (persisted to the `site_settings.custom`
    JSON) plus a `settingsExtras` escape-hatch slot.
  - **Bottom tabs — site-registered `CollectionTab`s:** a site's own collections
    plus Inquiries. The package ships a default `InquiriesPanel` a site registers
    and customizes via `renderRow`.

  The framework panels talk to the `louisecms/editor` endpoints. Also exports the
  shared field primitives (`Section`, `LinkListEditor`, `ImageField`,
  `MediaUrlPicker`, `SettingsField`) and the declarative `SettingsFieldGroup` /
  `SettingsFieldDef` types so sites build extension groups with the same editors.
  The `./client/drawer` data layer (`createDrawerQueryClient`, `apiGet`/`apiSend`,
  query keys) is unchanged and re-exported from the barrel.

- 5c5396e: Add `louisecms/editor` — framework-agnostic `api/louise/*` request→response
  handlers, each shaped as a `composeWorker` `WorkerRoute` (#10 slice 3). Ships
  `save`, `settings`, `pages`, `media`, `seed`, and `inquiries` routes built on
  `louisecms/db`, `louisecms/media`, and a site-supplied `resolveEditor` +
  `requireEditor` guard (same-origin enforced on mutations). Sites wrap them in
  thin framework routes and pass their own Drizzle tables; bespoke resource routes
  stay per-site. `settings` is extensible, not a closed set: it patches an
  allowlisted structured base (the framework `siteSettingsColumns`, incl. the new
  `custom` JSON column) and merges site-declared keys into `custom`, so a site adds
  its own settings without forking the handler. Security-sensitive logic
  (field allowlists, `sanitizeRichHtml`, the settings partition) is factored into
  pure, unit-tested functions.

## 0.2.0

### Minor Changes

- 4a4f6da: Add an auth-schema generator so sites regenerate their Better Auth migration
  from config instead of hand-rolling DDL (#15). `louisecms/auth` now exports
  `generateAuthSchemaSql` / `authSchemaOptions` (built on Better Auth's
  programmatic `getAuthTables`, no native `@better-auth/cli` dependency), and the
  package ships a `louise` CLI: `louise gen-auth-schema [--config <path>]
[--table-prefix <p>] [--out <file>]`. Supports a same-D1 auth namespace (Option
  B): pass `tablePrefix` (e.g. `"auth_"`) to render prefixed tables + foreign
  keys, and set the matching `LouiseAuthConfig.tablePrefix` so `getLouiseAuth`
  queries them. Prefix omitted → default table names (unchanged behavior).
- 6a99330: Add `louisecms/browser` — edge browser-automation helpers on Cloudflare Browser
  Run, shared across all Louise sites (#5). `ogImage` renders a per-page OG card
  only on a cache miss (content-hashed key via `ogCacheKey`, byte store injected),
  so the second request for unchanged content is served with no browser session;
  `createPuppeteerRenderer` is the thin edge binding (`@cloudflare/puppeteer`, an
  optional peer, dynamically imported). `checkLinks` is a scheduled, fetch-based
  link crawler. Bindings contract: `BROWSER` (`LouiseBrowserEnv`).
- 32022b3: Add the `louisecms/media` module: verified R2 uploads (`putMedia` with magic-byte
  sniffing that never trusts the client MIME), `listMedia`/`deleteMedia`, a
  parameterized delete-safety reference scan (`findMediaReferences`), and pure
  Cloudflare Image-Resizing URL transforms (`cfImage`/`circleImage`) plus a
  per-usage `Crop` + `cropStyle` helper. Ships the `media` asset-registry table
  (`mediaColumns` / `media`) in `louisecms/db` and a `LouiseMediaEnv` bindings
  contract (`MEDIA` R2 bucket + `MEDIA_URL`).
- 09e95c9: `louisecms/cms` patch: `diffDocuments` is now a `_key`-aware deep diff. A changed
  `blocks` array reports the specific sub-field that changed at a segmented path
  (`FieldChange.path` is now `PathSeg[]`, e.g. `["blocks", { key }, "heading"]`)
  instead of one opaque "blocks changed"; reordering blocks with unchanged content
  is a no-op; block add/remove is reported at the block's key path. Adds a
  `formatPath` display helper. The `computePatch`/`applyPatch` write path stays
  top-level field-level (unchanged) — path-addressed write ops remain a future
  Tier-2 concern.
- 430235d: Add stega (steganographic) auto-tagging for visual editing (#23), a companion to
  the manual `editAttr()` path. New `louisecms/stega` export: `stegaEncode` /
  `stegaDecode` / `encodeDocument` / `defaultStegaFilter` embed an invisible
  `EditRef` inside a field's rendered text, so prose becomes a click-to-edit
  target with no wrapper element (built on `@vercel/stega`, an optional peer).
  `mountVisualEditing` gains an injected `resolveStega` for text-node hit-testing
  (hybrid with `data-louise-edit` element targets). The client save path now
  `stegaClean()`s every value (via a dependency-free stripper) so invisible
  payload never round-trips into stored HTML / ProseMirror JSON. Encoding is
  preview-only.
- f89c615: Add `louisecms/worker` `composeWorker` (#10, Tier 2) — build a Cloudflare
  `ExportedHandler` from ordered Louise-owned routes plus a framework SSR fallback,
  with optional `queue`/`scheduled` handlers. On `fetch`, each route runs in order
  and the first `Response` short-circuits; otherwise the SSR fallback handles it.
  Lets a site's `worker.ts` declare `api/louise/*` + OG routes over its Astro
  handler instead of hand-rolling the compose per site.

## 0.1.0

### Minor Changes

- Add `louisecms/commerce/square` — a V8-native Square client (raw `fetch` +
  `crypto.subtle`, no Node SDK) over the Square `/v2` REST surface, pinned to
  `Square-Version: 2026-01-22`. Covers catalog read + mapping, price-verify
  batch retrieve, order creation, Web Payments card charges, customers
  (find-or-create), cards on file, loyalty balances, subscriptions, and
  `verifySquareSignature` for webhooks. Mirrors the existing
  `commerce` (Stripe) and `commerce/fourthwall` modules.
