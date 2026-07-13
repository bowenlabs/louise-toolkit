# louise-toolkit

## 0.12.0

### Major Changes

- 2f41e28: Rebrand: **Louise CMS → Louise Toolkit**. The project is now positioned as a
  V8-native toolkit for building editable sites on Cloudflare Workers, not just a CMS.

  Breaking changes:

  - **Package renamed** `louisecms` → `louise-toolkit`. Update every import specifier
    (`louisecms/client` → `louise-toolkit/client`, etc.) and your dependency entry.
  - **Editing terminology standardized.** The back-office surface formerly called the
    "studio" / "drawer" is now **Louise Settings**; the authoring experience is
    **Louise Editor**.
    - Subpath `louise-toolkit/client/drawer` → `louise-toolkit/client/settings`.
    - `mountDrawer` → `mountSettings`, `Drawer` → `Settings`, `DrawerConfig` →
      `SettingsConfig`, `OPEN_DRAWER_EVENT` → `OPEN_SETTINGS_EVENT`
      (`"louise:open-drawer"` → `"louise:open-settings"`), `onOpenDrawer` →
      `onOpenSettings`, `createDrawerQueryClient` → `createSettingsQueryClient`.
    - `buildStudioStructure` → `buildEditorStructure`, `StudioStructureItem` →
      `EditorStructureItem`, `StudioStructureGroup` → `EditorStructureGroup`,
      `BuildStudioStructureOptions` → `BuildEditorStructureOptions`,
      `DEFAULT_STUDIO_GROUP` → `DEFAULT_EDITOR_GROUP`.

  Internal `louise-drawer-*` CSS class names and the `#louise-drawer-root` id are
  unchanged (implementation detail).

- 7f6b77d: Rename the `cms` subsystem to **`content`** so the structured-content engine has
  one name everywhere (docs, exports, and identifiers previously drifted between
  "cms" and "content").

  Breaking changes:

  - **Subpath renamed** `cms` → `content` — import from `louise-toolkit/content`.
    Update every import specifier.
  - **Identifiers renamed**: `defineCmsConfig` → `defineContentConfig`, `CmsConfig`
    → `ContentConfig`, `CmsRegistry` → `ContentRegistry`, `cmsConfigToSchema` →
    `contentConfigToSchema`, `CmsRoutesOptions` → `ContentRoutesOptions`.
  - **Error renamed** (`louise-toolkit/errors`): `LouiseCmsError` → `LouiseContentError`,
    and its `code` string `"CMS_ERROR"` → `"CONTENT_ERROR"`. Subclasses
    (`LouiseAccessDeniedError`, `LouiseValidationError`) still extend it, so
    `instanceof LouiseContentError` catches them.

  The `louise-toolkit/stega` subpath is unchanged. Editing-surface names were also
  standardized in the docs: the block/slash-menu builder is **Louise Builder**
  (was "Page builder") and the component-rendered model is **Louise Sections**
  (was "Structured sections").

## 0.11.0

### Minor Changes

- d8ba9d1: feat(client): multi-line textarea for `textarea`-typed dock fields

  Section fields declared `type: "textarea"` but edited in the dock (i.e.
  `inline: false` — card bodies, FAQ answers, packaging step/tier bodies) were
  rendered with a single-line `<input>`, so they couldn't hold line breaks. They
  now render a resizable `<textarea>`, and the entered newlines are saved as `\n`
  (the site renders them with `white-space: pre-line`). Inline (in-place) text
  fields are unchanged.

### Patch Changes

- 8cbbc99: fix(client): make the inline editor chrome usable on mobile

  - The structured-sections dock becomes a full-width bottom sheet on phones
    instead of a fixed 300px card that overflowed the viewport and sat under the
    edit bar.
  - The shared edit bar docks to the top on mobile so the two floating bars no
    longer collide (the sheet owns the bottom thumb zone).
  - The caret formatting toolbar is kept within the viewport (CSS `max-width`
    plus a left clamp in `ToolbarDock`) instead of bleeding off the right edge.
  - Comfortable touch targets on coarse pointers (toolbar buttons, swatches,
    section-row ops, inputs, disclosure toggles), and a persistent
    ring + focus-revealed pencil on editable regions so they stay discoverable
    where there is no `:hover`.

## 0.10.0

### Minor Changes

- c8e4111: **Auto-save for on-page editing.** Inline fields (`mountLouise`) and the sections
  editor (`mountSections`) now persist edits automatically on a short idle debounce,
  reusing each surface's existing save — a live field write, or a **draft** on a
  versioned page. Publishing stays a manual, explicit action; auto-save never
  publishes.

  - On by default. Opt out with `autoSave: false`, or tune the delay with
    `autoSave: { debounceMs }` (default `800ms`). New `AutoSaveOption` export.
  - With auto-save on, the manual **Save** / **Save draft** button is dropped in
    favour of the live status line; **Publish** is unchanged.
  - Pending edits flush on blur, tab-hide, and navigation (the save `fetch` uses
    `keepalive` so it survives unload), with a browser warning while a save is still
    in flight. A failed save leaves the field dirty and retries on the next edit;
    overlapping saves are serialized so an edit made mid-save is never dropped.

## 0.9.0

### Minor Changes

- 4510439: Convergence features toward the commerce/ordering use case:

  - **`louisecms/astro`: `defineCatalogLoader`** — shared plumbing for an Astro
    Live Content Collection backed by a commerce catalog. Maps items to keyed
    entries, stamps a `cacheHint` (tag + snapshot age), and wraps read failures
    as loader errors. Sites inject only the domain-specific bits (how to read/
    resolve items, each item's slug), so different providers share one loader.
  - **`louisecms/cms` media: `cfImageSrcset`** — a width-descriptor `srcset` (+
    default `src`) for rectangular renders, so the browser picks the smallest
    derivative covering the rendered width at the device DPR. Optional `ratio`
    derives each step's height to match a CSS `object-fit` cover crop. Mirrors
    `circleImage` for non-square frames.
  - **Editor `pagesRoute`: `versionsTable`** — an optional version-snapshot table
    so a page DELETE cascades to its draft/publish snapshots (which have no FK to
    the page row and would otherwise orphan). Omit for unversioned collections.
  - **Forms: typed derived columns** — `deriveFormColumns` and
    `FormDefinition.columns` are now typed as `SQLiteColumnBuilderBase`, dropping
    the internal cast and letting consumers spread the columns into their own
    `sqliteTable` with extra fields.

## 0.8.0

### Minor Changes

- a5b3a7a: Declarative form builder (`louisecms/forms`) — define a form's fields once and
  derive the submission table, the public capture route, validation, and the review
  columns from that single definition (#46, Tier 1). `inquiries` is now the
  **built-in default form**.

  - **`defineForm({ name, fields, spam?, notify? })`** → `{ columns, table,
reviewColumns }`. Field `type` is `text | email | tel | url | textarea | number
| select | checkbox | date`; `required` drives both a `NOT NULL` column and a
    required check; `validation` reuses the shared `Rule`/`validateValue` engine, so
    there is one validation definition. `validateSubmission` / `coerceFormValue` run
    it (per-type format checks, select allowlist, number coercion).
  - **`formRoute(config)`** (`louisecms/editor`) — the **public** capture companion
    to `inquiriesRoute`: same-origin-guarded (not session-gated), validates + coerces
    (`422` with per-field violations), enforces an opt-in spam guard (KV rate limit +
    Turnstile via `verifyTurnstileToken`), and inserts the row. Mounted at
    `/api/louise/forms/<name>`.
  - **Folded inquiries.** `inquiries`/`inquiriesColumns` are now derived from a
    built-in `inquiriesForm` (`louisecms/db`) — same table shape as before, so no
    base migration. The review route + Inquiries panel were already form-agnostic.
  - **Dogfood.** The marketing site gains a contact section that POSTs to
    `formRoute`; a submission lands in the Inquiries tab with no hand-rolled handler,
    columns, or validation.

  `json()` (`louisecms/editor`) now accepts optional response headers.

- ffa7572: Forms Tier 3 (#46) — notifications, a shared submissions catalog, and silent spam
  heuristics.

  - **Notifications.** A form's `notify` fires after a successful insert, **off the
    response path** (`waitUntil`): `notify.webhook` POSTs `{ form, values }`;
    `notify.email` sends via a `mailer` passed to `formRoute` (wrap your `EMAIL`
    binding — Louise stays decoupled from any transport). A notification failure
    never fails the submission. New `notifySubmission` / `renderSubmissionText`.
  - **Silent heuristics.** `spam.honeypot` (a decoy field) and `spam.minSeconds` (a
    too-fast-submit check against the render helper's `louise_ts`) reject a likely
    bot with a fake success and no insert. New `looksLikeSpam`; the `<Form>` helper
    emits the honeypot + timestamp.
  - **Form catalog (no new table each time).** New shared `submissions` table
    (`louisecms/db`). `formRoute`'s `genericTable` stores an ad-hoc form as
    `{ form, data }` (no migration per form); the new `submissionsRoute`
    (`louisecms/editor`) reviews one form's rows for a drawer tab.
  - Dogfood: the marketing site's contact form gains the honeypot + a 2s minimum.

- 406158a: Forms Tier 2 (#46) — a headless `<Form>` render helper, a `file` field type, and
  an optional TanStack Form adapter.

  - **`<Form>` / `mountForm`** (`louisecms/client`) — renders accessible inputs from
    a `defineForm` catalog and **mirrors the server validation client-side** (reuses
    `validateSubmission` → the shared `Rule` engine, no second definition), then
    POSTs to the form's `formRoute`. Unstyled by default (`louise-form*` class
    hooks); maps a server `422` back onto the fields.
  - **`file` field type** — renders a file input that uploads through the `media`
    route and stores the returned URL.
  - **Optional TanStack Form adapter** — `tanstackFormValidators(config)` /
    `tanstackFieldValidator(key, field)` (`louisecms/forms`) return validators in
    `@tanstack/solid-form`'s shape, backed by the same `Rule` engine, so a complex
    hand-built form keeps one validation definition. Dependency-free (the consumer
    brings the peer). `validateField` is now exported for reuse.

- 8b90a24: Media assets now carry first-class **alt/caption** and intrinsic **dimensions**,
  so the media library is a described set of assets rather than a wall of
  filenames (#16).

  - **Dimensions on upload.** `putMedia` reads intrinsic `width`/`height` from the
    image header (new `imageDimensions` — PNG/GIF/JPEG/WebP, no pixel decode; `null`
    for formats it can't read), and `mediaRoute`'s upload records them. `PutMediaResult`
    gains `width`/`height`.
  - **Edit alt/caption.** `mediaRoute` gains `PATCH /api/louise/media` (`{ key, alt,
caption }`) — only those two columns are writable, editor-guarded and
    same-origin-checked. The drawer Media panel gets an inline alt/caption editor per
    asset and shows the real alt (not the filename) on the thumbnail.
  - **Alt flows to rendered images.** New `mediaMetaByUrl(db, table, base)` returns a
    `url → { alt, caption, width, height }` map so a render pass can fill an image's
    alt from its asset-level default when no per-usage alt is set (a per-usage value
    always wins). Wired into the dogfood's public section render.

  Additive and back-compatible: `width`/`height`/`alt`/`caption` are optional
  columns that stay `NULL` until set.

- 8b0068a: Extract logic that Louise sites were duplicating into the package, and add
  generic multi-role auth primitives so sites converge on maintained code.

  **New**

  - `louisecms/email` — themed transactional template shell: `renderEmailShell`,
    `mailButton`, `mailFallbackLink`, and a `MailTheme` (palette + fonts + layout
    tokens). Sites keep only their palette and copy.
  - `louisecms/client/drawer` + `louisecms/editor` — a first-class **Users** panel
    (opt-in top strip, `user` icon) for managing CMS editors, paired with the new
    `editorsRoute` factory.
  - `louisecms/auth` — `requireEditorFromContext` (framework-agnostic
    Astro-context guard); and generic dynamic-role primitives `hasRole` /
    `requireRole` (arbitrary, site-defined role strings) + `resolveSession`
    (returns the role for any signed-in user, no gating), so a site can build its
    own multi-role auth layer. Louise's own CMS auth stays binary and no role
    names are baked in.
  - `louisecms/editor` — `pagesRoute` gains `transform`, `reservedSlugs`, and
    `afterWrite` hooks so sites can drop their hand-rolled pages CRUD.
  - `louisecms/commerce/fourthwall` — `mapFourthwallOrder` plus
    `fourthwallMoneyToCents` / `mapFourthwallOrderStatus` for mapping order
    webhooks to a normalized, storage-ready shape.
  - `louisecms/astro` — a new **optional** subpath (`astro` is an optional peer)
    with `createLouiseMiddleware`, the shared site middleware (rate-limit →
    editor session + sticky `?louise` edit mode → CMS-freshness cache/CSP/security
    headers) as a config-driven factory.

  **Migration (required on upgrade)**

  `getLouiseAuth` now declares standard `firstName` / `lastName` fields on the user
  table (used by the Users panel). Because Better Auth references declared fields,
  you **must** add the columns when upgrading: regenerate the auth schema
  (`generateAuthSchemaSql`) and apply the migration. Both columns are nullable and
  additive — no data loss, no `NOT NULL` — but they are not optional to apply.

### Patch Changes

- c661493: Fix `commerce/square` `listCatalogItems` hitting a non-existent endpoint. It
  POSTed to `/v2/catalog/search-catalog-objects`, which Square returns `404
Resource not found` for — the SearchCatalogObjects endpoint is `/v2/catalog/
search`. Because the call threw, consumers that guard on "is Square configured"
  could silently fall back to seed/empty data with a valid token, misdiagnosed as a
  bad token. Request/response shapes are unchanged; only the URL path was wrong.
  Adds a regression test pinning the endpoint path and cursor paging. (#58)
- f4e9cfa: Production-readiness pass from the package audit:

  - `mediaMetaByUrl(db, table, base, urls?)` now takes an optional `urls` list and
    scopes the lookup to just those assets (a bounded `IN (…)` query) instead of
    scanning the whole `media` table — so the render-time asset-alt fallback stays
    cheap on a large library. Omitting `urls` keeps the previous full-table load.
  - Declare `engines.node >= 20`.

## 0.7.1

### Patch Changes

- dca936f: Make concurrent versioned surfaces on one page draft-safe. `POST /:id/versions`
  now merges a partial draft save over the newest _pending_ draft's snapshot
  (falling back to the live row) instead of always over the live row, so a second
  editing surface (e.g. a sections dock alongside an inline body) no longer reverts
  the other's pending work; publishing with no explicit `versionId` targets the
  newest pending draft, so a superseded draft can't silently go live. The edit bar
  no longer shows duplicate Save-draft/Publish actions when both surfaces mount.

## 0.7.0

### Minor Changes

- 64ed92e: `mountLouise` can stage inline edits as drafts (body pages join the versioned
  workflow).

  `mountLouise({ versionedPageId })` opts a page into the draft/publish workflow:
  its inline `data-louise-field` edits are collected into a single **draft**
  (`POST /api/louise/pages/:id/versions`) — the live row is untouched — and a
  **Publish** button (yellow, beside a green **Save draft**) promotes it
  (`POST …/publish`). Without `versionedPageId` the bar keeps its previous
  behavior (a single live **Save** via `/save`). This brings rich-text body pages
  to parity with the sections/home surface, which already staged drafts; the site
  resumes the latest draft's field values in edit mode and moves rich-text
  sanitizing onto the collection's `beforeChange` hook so it covers the
  draft/publish paths (not just the old live `/save`).

- c7436ba: Draft/publish + version history for pages (full-CMS convergence, step 1).

  - **`versionsRoute`** (`louisecms/editor`): exposes a versioned collection's
    `createVersionedLocalApi` over HTTP — `GET/POST /api/louise/pages/:id/versions`
    (list / save a draft), `POST …/:id/publish` (`{ versionId? }`, default the
    latest draft), `POST …/:id/unpublish`. A save merges the edit over the current
    live row (config fields only) and stores a complete, publishable snapshot in
    `${slug}_versions`; publish promotes it onto the live row and sets
    `published_version_id`. Mount **before `pagesRoute`** (its `/:id` matcher would
    otherwise claim the `/:id/versions` paths).
  - **Sections dock** (`louisecms/client`): **Save** now stages a **draft** — the
    live page is untouched until **Publish**. Adds a **Publish** action and a
    **version history** list that restores (publishes) any earlier version; the
    status line reflects draft vs published.

  Model a collection with `defineCollection({ …, versions: { drafts: true } })`,
  generate its snapshot table with `collectionVersionsTable`, and render the latest
  draft in edit mode (published main row in view mode). See the new **Drafts &
  publishing** guide.

- a6aa887: Grid page-builder + editor packaging fixes.

  - **Adjustable grid blocks** (`louisecms/client`): a new `rowBlock` → `columnBlock`
    layout primitive whose column widths are freely adjustable. Rows serialize their
    track list to a sanitizer-validated inline `grid-template-columns` (fr weights),
    and the row node view offers preset layouts (1:1, 6:4, 1:1:1, 4:4:2, …),
    per-column width steppers, and add/remove column + add row. The legacy fixed
    two-column block still parses for back-compat.
  - **Gallery block**: a responsive image grid (`data-block="grid"`) with a 2/3/4
    column switch.
  - **Consistent iconography**: the grid row controls and the sections dock now use
    the shared Phosphor `Icon` set instead of ad-hoc text glyphs; two new names
    (`caretRight`, `minus`) are added to the exported `icons`/`IconName`.
  - **Page templates**: `PageTemplate` + a `pageTemplates` option on the drawer
    config surfaces "start from a template" starter layouts in the Pages panel.
  - **Structured sections** (`louisecms/client`): `mountSections` — a visual block
    builder for bespoke, component-rendered pages. Pages store an ordered array of
    typed section items (`{ _type, ...fields }`); the site renders each with its own
    component, so the design stays bespoke. Editing is **hybrid**: text is edited
    **in place on the live render** — components stamp `data-louise-sfield` markers
    on their text nodes and `mountSections` makes them contenteditable, writing
    straight into a fine-grained `createStore` (so typing never rebuilds a row) — and
    a floating **control dock** handles what you can't point at: add / reorder /
    remove sections, array-item add/remove, and non-visible fields (a field can opt
    out of inline editing with `SectionField.inline: false`, e.g. a link URL). Text
    saves in place; structural changes persist then reload so the server re-renders
    the new shape.
  - **Sections validation** (`louisecms/cms`): the section schema types now live in
    core, and `validateSections` / `assertValidSections` validate a `sections` write
    against the catalog — the value is an array, every item's `_type` is known, and
    each field matches its declared shape (with optional per-field `validation` Rule
    chains reused from the collection validator). `pagesRoute` gains a `validate`
    hook; a failed validation is a `422 { error, violations }` the dock surfaces.
  - **`image` section fields**: a new field type edited via a dock upload / clear
    control (POSTs to the site's media route); the bespoke component renders the
    uploaded URL (e.g. a hero logo) or its own fallback. The dock also moved
    **Add section** beside **Save** under the footer divider.
  - **Type**: brand type is now **Roboto Flex** throughout (`theme/fonts.css` +
    client chrome); headings are the same family at a heavier weight (no Hepta Slab).
  - **Sanitizer** (`louisecms/security`): the inline-`style` allowlist now accepts a
    value-validated `grid-template-columns` (numeric `%`/`fr`/`px`/`auto` tracks, no
    functions/urls) in addition to `color`, so adjustable-grid markup round-trips.
  - **Fix**: `louisecms/editor` was declared in `exports` but missing from the build
    entry list, so `dist/core/editor/*` was never emitted — the subpath is now built.

- 1c62f7d: Full-text search over pages (full-CMS convergence, step 2).

  - **`searchRoute`** (`louisecms/editor`): `GET /api/louise/pages/search?q=…&limit=…`
    returns ranked (published) matches from a collection's FTS5 index; `POST
…/reindex` rebuilds it from the table. Free input is quoted + prefix-matched into
    a safe FTS5 query. Mount **before `pagesRoute`**.
  - **Searchable `json` fields**: `search.fields` now accepts `json` fields, indexed
    by flattening every string leaf — so structured `sections` content (headings,
    feature text…) is full-text searchable, not just `text`/`richText`. Adds
    `createLocalApi.reindexSearch()` to rebuild an index (backfill after first
    creating the FTS table).
  - **Drawer Pages panel** (`louisecms/client`): a search box that swaps the page
    list for ranked matches.

- f567909: Strict media: every editor image comes from the media collection (#47).

  Image controls no longer accept an external URL — an editor uploads to the media
  library or picks from it, so images are stable R2 assets, never a hotlink that
  breaks or vanishes. This is enforced in the UI **and** on write, and every knob
  is optional + back-compatible.

  - **Selector consistency** (`louisecms/client`): the section `image` control now
    offers **Choose from media** alongside **Upload** (via a new query-free
    `MediaPicker`, for surfaces mounted outside the drawer's TanStack Query
    provider). The drawer `ImageField` is now strict by default — the free-form URL
    input is gone unless you opt in with the new **`allowUrl`** prop — and settings
    image fields (logo, favicon, share image) gained the upload button so both
    paths are available everywhere.
  - **`sanitizeRichHtml(html, { mediaBase })`** (`louisecms/security`): with
    `mediaBase` set, an `<img>` whose `src` isn't served from that base is dropped
    (a pasted remote hotlink is removed; media-hosted images are kept). Exposed as
    the new `SanitizeOptions`.
  - **`validateSections(catalog, value, { mediaBase })`** /
    `assertValidSections` (`louisecms/cms`): an `image` field whose value is a
    non-empty, non-media URL is a `422` violation.
  - **`settingsRoute({ imageKeys, mediaBase })`** (`louisecms/editor`): a patched
    image setting that isn't a media URL is rejected `422`. The check is the pure,
    exported `validateSettingsImages`.
  - **`isMediaUrl(base, value)`** (`louisecms/media`): the one definition of
    "media-backed" all of the above enforce with.

  Each `mediaBase` argument is optional — omit it and the prior behavior (any safe
  `http(s)`/relative image) is unchanged. The dogfood site wires all of them to its
  `MEDIA_URL`.

- 63b33ad: Version-history UX in the sections dock: mark the live version, and discard drafts.

  - **Flag the live version.** Publishing sets a version's `status` to
    "published" but never demotes the prior one, so multiple history rows read
    "Published" identically. `GET /api/louise/pages/:id/versions` now also returns
    the page's `publishedVersionId`, and the dock marks that row "Live" (accented,
    disabled "Current" button) — others keep "Published" / "Restore".
  - **Discard drafts.** New `POST /api/louise/pages/:id/discard` (body
    `{ versionId }`) deletes a draft version from history, backed by a new
    `VersionedLocalApi.discardVersion(context, versionId)` that refuses to delete
    the currently-live version.
  - **Edit drafts.** Draft rows now offer **Edit** (resume that draft's snapshot as
    the working copy and reload for inline editing) plus a delete button, instead of
    publishing straight from history. Published versions keep **Restore**; the live
    one is **Current**.

  History stays newest-first (unchanged: `findVersions` orders by version id
  descending).

### Patch Changes

- 4f7fd15: Unify the editor's save controls onto one bar, and tidy the sections dock.

  - **One action bar.** The sections editor now renders its **Save draft** (green)
    and **Publish** (yellow) onto the shared edit bar (`.louise-bar`) — as text
    buttons matching Settings/Done — instead of a second set of buttons in the
    dock, so there's a single row of actions rather than two competing Save
    controls. The bar's own inline-field **Save** is omitted on pages that have no
    `data-louise-field`s (e.g. sections-only pages), where it was permanently dead.
  - **Dock cleanup.** **Add section** moves above the version history and spans the
    full dock width, matching the section rows. The Save/Publish actions stay on the
    bar even when the dock is collapsed.
  - **Movable dock.** Drag the dock by its header to move it off whatever it covers;
    the position is clamped to the viewport and persisted (localStorage) so it
    survives the reloads structural edits trigger.

- e5068ca: Fix the rich-text editor failing to render (blank field, no editor).

  `ToolbarDock`'s caret memo (via `useEditorDerivedValue`) is evaluated eagerly by
  Solid during render — before `RichText`'s `onMount` calls `editor.mount(host)`.
  Reading `editor.view` before then threw "Editor is not mounted", and that
  synchronous throw aborted the entire `render()`, leaving the field cleared with
  no editor and no visible error. The memo now bails while `!editor.mounted` (it
  re-runs once mounted). Also surfaces future editor-boot failures: `mountLouise`
  wraps each `mountRichText` in try/catch, and the site editor bootstrap adds a
  `.catch`, so a swallowed throw no longer silently blanks the field.

- 5dde96a: Pre-publish security hardening (audit follow-ups).

  - **`getSessionSecret`** now treats an empty stored secret as a failure — a
    misprovisioned Secrets Store returning `""` would silently weaken session
    signing. Dev still falls back to the dev secret; any deployed host fails closed.
  - **`verifyStripeSignature`** accepts a header carrying multiple `v1=`
    signatures (Stripe dual-signs during an endpoint-secret rotation) and passes if
    any match — the previous last-wins parse could reject a validly-signed event.
  - **`generateAuthSchemaSql`** validates `tablePrefix` against the same
    identifier shape the runtime SQL guards enforce (`/^[A-Za-z_][A-Za-z0-9_]*$/`),
    so a stray character can't produce broken/injected DDL.
  - **Search route** clamps `?limit=` to a sane ceiling (100) so a client can't
    request an unbounded result set.
  - **Publish safety:** a `prepublishOnly` build hook ensures `dist/` is rebuilt
    before the package is published, so a stale build can't ship.
  - **Smaller tarball:** the published package no longer ships `.js.map`
    sourcemaps (they roughly doubled its size and only re-shipped the already-public
    source) — the tarball drops from ~386 kB to ~164 kB.

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
