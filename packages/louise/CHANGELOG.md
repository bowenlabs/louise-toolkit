# louise-toolkit

## 0.25.3

### Patch Changes

- 67189d1: feat(sections): warn when a richText field is rendered into a `<p>`

  A `richText` value is HTML the editor produced — `<p>`, lists, blockquotes.
  Rendering it into a `<p>` is invalid nesting, and the parser does not merely
  tolerate it: it CLOSES the paragraph and hoists the block content out as a
  following sibling. The `data-louise-node` marker stays on the now-empty `<p>`,
  so the editor mounts on nothing while the prose sits outside it, unmarked and
  uneditable — and every paragraph break the editor creates is hoisted straight
  back out.

  Nothing about that fails loudly. The page renders; the field is simply inert.
  Two sites shipped it independently before anyone noticed, which is why this
  belongs in the framework rather than in each site's conventions.

  `wireInline` already knows the field is `richText` and holds the node, so it now
  checks the tag and warns with the field's path and the remedy. Warning only —
  the field still half-works, and breaking an owner's editing session over a
  markup nit would be the worse failure. Plain-text fields in a `<p>` are correct
  and say nothing.

- 9137487: fix(settings): the drawer's link lists lost focus after every keystroke

  `LinkListEditor` rendered its rows with `<For>`, which is keyed by REFERENCE.
  Its `update` helper replaces the edited row with a new object
  (`rows.map((r, j) => (j === i ? { ...r, ...patch } : r))`), so every keystroke
  made that row a new item — `<For>` tore the row's DOM down and rebuilt it, the
  `<input>` being typed into was destroyed mid-edit, and focus fell to `<body>`.

  The visible symptom is that typing a nav label or URL in the Settings drawer
  accepts one character and then deselects, so the owner has to click back in for
  every letter.

  Now `<Index>`, which keys by POSITION: the row's elements are created once and
  only the values update, so the focused input survives. The rows are positional
  anyway — reorder moves values between fixed slots rather than moving DOM.

  Field editors that iterate a STABLE list (a constant, or `Object.keys()`
  captured once) were never affected: nothing re-keys them, so their inputs are
  never recreated.

## 0.25.2

### Patch Changes

- c1c7b0f: Fix: edit mode no longer blocks the site's own navigation.

  The edit-mode guard that keeps a stray click from losing an edit session was blocking **every** `a[href]` outside the editor's own chrome — which included the site's header nav, footer links, brand mark and skip link. An editor could not reach another page at all without first leaving edit mode.

  The guard is now scoped to the **editing surfaces**: a link is inert only when it sits inside a marked node (`data-louise-node`), the sections host (`data-louise-sections`), or a legacy inline field (`data-louise-field`). Clicking a CTA you are editing still edits its label rather than navigating; everything else navigates normally.

  The predicate is exported as `isEditableSurfaceLink` so both failure directions are pinned by test: blocking too little loses an edit to a stray click, blocking too much strands the editor on one page.

## 0.25.1

### Patch Changes

- 2a16348: **`extend` now survives an auth failure — and vice versa.**

  `createLouiseMiddleware` wrapped editor-session resolution and the `extend`
  hook in one `try/catch`. When `resolveEditor` threw — which it does on every
  request while `SESSION_SECRET` is still the `DUMMY_REPLACE_ME` sentinel, i.e.
  the dormant-until-provisioned state every module is supposed to survive —
  `extend` was silently skipped along with it. Everything `extend` feeds died
  too: `locals.tenant` was never written, so astroid's host dispatch quietly
  served the ordinary site on every tenant subdomain, with no error anywhere.

  The two now get separate catches. An unprovisioned editor secret degrades to
  "signed out"; a broken tenant lookup degrades to "no tenant"; neither cancels
  the other. Found live on themidwestartist.com's Wave 4 storefront work, where
  the symptom — merchant hosts rendering the marketing homepage — pointed at
  everything except the auth secret.

- 3bae09a: **`louise-toolkit/content` re-exports `FieldOption` / `FieldOptions` /
  `FieldOptionsResolver`.**

  `SectionField.options` is typed with `FieldOptions`, but the option types
  themselves live in `core/content/field-types.ts` — a module the content barrel
  doesn't include, and which `sections.ts` only type-_imported_. The published
  entry therefore shipped a field whose type could not be named: a site declaring
  a resolver-backed picker had to redeclare a structural stand-in
  (`type FieldOption = { value: string; label?: string }`) to annotate its own
  resolver.

  They're now re-exported from `sections.ts`, alongside the existing
  `isSafeLinkUrl` re-export, which covers both entries at once — the
  `louise-toolkit/content` barrel and the drizzle-free
  `louise-toolkit/content/sections`. Also un-dangles the
  `{@link FieldOptionsResolver}` in `SectionField.options`'s doc comment, which
  pointed at a symbol the module didn't export.

  Types only — no runtime change.

## 0.25.0

### Minor Changes

- 50ecd8d: **The green ring works: shared site-settings values are editable on-canvas.**

  ADR 0010 Phase B, slice B5 (#376) — the last reference-ring slice. A site
  declares its on-canvas-editable settings keys at mount:

  ```ts
  mountSections(el, {
    …,
    shared: {
      phone: { type: "text", label: "Phone number", surfaces: ["the header"] },
    },
  })
  ```

  and stamps `data-louise-node="settings.<key>"` wherever the value renders —
  the Nav, the Footer, a location panel; outside the sections host is fine
  (#377 made the lookups document-wide for exactly this). A declared key
  resolves to a **green, wrench-only** node named after the value. Its
  inspector is the one panel whose writes do NOT stage into the page draft:

  - **The warning band is persistent**, not a `confirm()`: _"Used in the header
    and 3 pages — saves immediately, everywhere."_ The count is assembled from
    the def's static chrome `surfaces` plus the pages whose stored sections
    include a type whose catalog def `consumes` the key (spec §3, approach A —
    the declaration doubles as documentation of a coupling that was invisible).
  - **Saves PATCH `/api/louise/settings` on commit** — immediate and
    unversioned by decision (spec §4); a failed save keeps the optimistic value
    on screen with the error.
  - **Every marker syncs after a save**: the Nav renders a value twice
    (desktop + mobile), and updating one would leave the page lying about the
    other. Plain-text values only; richer renders get their truth next load.

  `InspectTarget` gains the `{ kind: "shared"; key }` arm; an undeclared
  settings key stays unmarked, the same stale-marker rule as every other path.

## 0.24.0

### Minor Changes

- 934676d: **The link picker can map a page slug to its real path, and dedupes by path.**

  The picker turned every `pages` row into `/${slug}`, which is wrong for exactly
  one row on most sites: the one served at `/`. Coracle's `home` row produced a
  second "Home" entry pointing at `/home` — a duplicate-content alias offered to
  editors as if it were a page (found in the #348 live QA).

  `mountSections` accepts `pagePathForSlug?: (slug: string) => string` and the
  picker's choice list now dedupes by path, built-ins first — so a DB row mapped
  onto a built-in's path collapses into the hand-authored entry rather than
  appearing twice.

- eb6ff81: **The yellow wrench works: an external section's inspector gains its source-settings group.**

  ADR 0010 Phase B, slice B4 (#375). A section declaring the object form of
  `source` now opens a two-group inspector:

  - **Source settings first** — the mirror's knobs (which category, which items
    hidden), declared as `SectionField`s under `source.settings` and stored in
    the site-settings `custom` JSON under `source.settingsKey`. They PATCH
    `/api/louise/settings` the moment a value commits — shared by every page,
    so they cannot ride the page draft — and the group's caption says so:
    "Save immediately, everywhere this content appears." A failed save keeps the
    optimistic value on screen **with** the error, so the editor knows the page
    and the store disagree. After a save the section re-renders through the
    fragment route, so the canvas reflects the new source config.
  - **Everything else unchanged** — the section's own fields, arrays, and layout
    keep staging into the draft exactly as before.

  Supporting pieces:

  - `SectionDef.source` widens to `"external" | ExternalSource` (`kind`,
    `label`, `settingsKey`, `settings`); `externalSourceOf` normalizes the two
    forms. A section whose _only_ knobs are source settings still gets its
    wrench.
  - `SectionField.multiple` (select only): the value is a string array, rendered
    as a checkbox list over the same literal-or-fetched options, validated
    member-wise with the same resolver exemption as single selects — the shape a
    mirror's filter lists need.

- 24335e9: **A node's source is now a first-class property — ring colour becomes f(source).**

  ADR 0010 Phase B, slice B2 (#373). Two declarations and one resolver change,
  exactly at the seam A1 reserved for them:

  - `SectionDef.source?: "external"` marks a section whose content mirrors a
    system the site doesn't own (a Square-backed grid). `describeNode`'s section
    arm tones it `external` (yellow) instead of `section`; its position, layout,
    and inspector capabilities are untouched — the page still owns those.
  - `SectionDef.consumes?: string[]` names the site-settings keys a section reads
    when it renders — a coupling that was invisible inside the site's Astro
    components, and the input to the "used in N surfaces" count the shared-value
    editor will show (slice B5).
  - `describeNode` gains the `["settings", key]` arm: a
    `data-louise-node="settings.<key>"` marker resolves to a wrench-only node
    toned `shared` (green) when the key is declared in the new
    `DescribeContext.shared` map — and to `null` (unmarked) when it isn't, the
    same stale-marker rule as every other path.

  Nothing passes `shared` or declares `source` yet, so no editor behaviour
  changes until the inspector arms land (B4/B5). The chrome needs no change at
  all — which was the point of the seam.

- fa9e636: **The chrome palette now covers every `NodeTone`, and an unknown tone degrades visibly.**

  `NodeTone` has reserved `shared` (green) and `external` (yellow) since A1, but
  `TONE_CSS` only styled the three depth-derived tones. Returning one of the
  reserved tones from `describeNode` rendered an _invisible_ selection: the base
  active rule set only `border-radius` (no ring), and the toolbar had no
  background under its white glyphs. That failure reads as a resolver bug and
  sends you debugging the wrong file — found while re-checking the Phase B
  premises on #347.

  Three changes, no behaviour change for the existing tones:

  - **`shared` and `external` get ring + bar rules.** Each uses one value for
    both roles: `--louise-shared` (`#15803d`, 5.02:1 against white) and
    `--louise-external` (`#a16207`, 4.92:1) both clear the toolbar's 4.5:1
    (WCAG 1.4.3) without a darker `-strong` variant. External is deliberately
    NOT `--louise-yellow` — `#ca8a04` measures 2.94:1, failing the ring's 3:1
    as well as the bar's 4.5:1, and the token already carries save/publish
    semantics. Same reasoning gives `shared` its own token.
  - **The base rules carry a slate fallback** (ring `#64748b`, bar `#475569`),
    so a tone the palette doesn't know paints a neutral ring and a legible bar
    instead of nothing.
  - **The palette is one overridable block.** `--louise-violet` and the three
    `--louise-*-strong` values node-chrome reads were never declared anywhere —
    every reference fell through to its literal, so overriding a base colour
    recoloured the ring but not the toolbar. All are now declared in the
    `:root` block in `styles.ts` next to the tokens that already existed.

### Patch Changes

- cc5cc4b: **Markers outside the sections host now resolve everywhere the editor looks.**

  The chrome has always hovered every `data-louise-node` in the document, but the
  editor's own lookups were host-scoped: the wireInline scan and `nodeEl` — the
  inspector popover's anchor — both queried under `props.host`. A marker rendered
  outside the host was silently inert for in-place editing, and its inspector
  popover fell back to the viewport-origin default position instead of anchoring
  to the element.

  No site stamps such a marker today, which is why nothing ever failed loudly —
  but ADR 0010 Phase B stamps `settings.*` paths in the Nav and Footer, which
  render outside the host by construction (#374). Both lookups now query the
  host's document; host-owned operations (inserting sections, sibling order) stay
  host-scoped, since sections really do live there.

## 0.23.0

### Minor Changes

- 71cc1d7: **One flag turns AI generation off, separately from the binding.**

  AI was gated by binding presence and nothing else: if `env.AI` was provisioned the
  assists were live, and the only way to turn them off was to unprovision it. That
  is a real switch, and for "this site never uses AI" arguably the right one. It
  stops working the moment you want to keep the binding and still disable
  _generation_ — an embeddings-backed search that must keep running while alt-text
  and SEO suggestions go quiet, a client whose contract forbids generated copy, or a
  temporary kill after a bad model swap.

  `LOUISE_AI=off` in `vars`, plus `aiRunner(env)` in place of `(env) => env.AI`:

  ```ts
  aiRoute({ resolveEditor, ai: aiRunner });
  ```

  **One exported definition, not four.** Every consumer reached the runner through
  its own accessor, so a flag written at each call site would be four chances to
  drift — and a kill switch you don't trust is worse than none. Astroid's generated
  worker and `workers/site` both wire it now.

  **Two decisions the issue left open, resolved:**

  **Scope — generation only.** Embeddings power site search and generate nothing, so
  gating them would mean disabling "AI content" silently breaks search: a
  consequence nobody predicts from the flag's name, surfacing as "search returns
  nothing" long after the flag was flipped. `vector.ai` deliberately stays on the
  binding. Unprovisioning `AI` still turns off everything.

  **"Off by choice" vs "not configured" — distinguished now, not later.** Both
  answer `503` and both hide the control, which is correct for an unprovisioned
  binding but wrong for a deliberate opt-out, where the honest answer is "AI assists
  are turned off for this site". The 503 body carries `reason: "disabled" |
"unconfigured"`. Shipped together because a kill switch whose state is invisible
  is exactly what the flag is trying to fix.

  `LOUISE_AI` **cannot turn AI on** — with no binding there is nothing to enable, so
  the var stays a ceiling rather than a second source of truth. `off`, `false`, `0`,
  `no`, and `disabled` all mean off, case-insensitively; every other value means on,
  so no typo can accidentally disable AI, only spell "off" more than one way.

- e56d546: **`getLouiseAuth` takes an explicit `rpID`, so one passkey can cover an apex and
  its admin subdomain.**

  The passkey relying-party ID was derived from the request origin. That is right
  for a single-origin site and wrong the moment an admin app lives on its own
  subdomain: `example.com` and `studio.example.com` become two relying parties, so
  the same person enrols **two separate passkeys** and then picks the right one from
  a list on every sign-in.

  ```ts
  getLouiseAuth(env, baseURL, {
    rpName: "My Studio",
    rpID: "example.com", // both origins, one credential
    cookiePrefix: "louise-studio", // …but its own session
  });
  ```

  Additive — omit it and behaviour is byte-for-byte what it was.

  **The sessions stay separate, and that is the desirable half.** A shared
  credential is not a shared login. Pair `rpID` with **host-only cookies** (no
  `Domain` attribute, `crossSubDomainCookies` off — the default) and a distinct
  `cookiePrefix` per instance. Widening the cookie to the parent domain would
  broadcast the admin session to every sibling subdomain, including untrusted tenant
  storefronts — the failure this option exists to avoid rather than cause.

  `rpID` must be the origin's own domain or a parent of it; a browser rejects a
  registration whose rpID is neither, so a typo fails at enrolment rather than
  silently. It is a bare domain — no scheme, no port.

- 1cf8d2e: **New: `louise-toolkit/commerce/fourthwall-platform` — the Fourthwall Platform
  API (Open API v1.0).**

  At-cost fulfillment orders and product creation. Raw `fetch` + HTTP Basic, no
  SDK, V8-native, matching the other three provider clients.

  A separate subpath from `/commerce/fourthwall`, and the split is the point.
  Different base URL and different auth, yes — but the reason it is a hard split is
  the **trust boundary**. The storefront `storefront_token` is public-safe by
  design and shipping it to a browser is the intended use; these are credentials
  that place orders and create products, and they must never leave a Worker. One
  module holding both is how the wrong one ends up in a client bundle: a component
  imports it for `lowestPrice`, the bundler pulls the whole graph, and the order
  client lands in the browser's source map. Two modules make that a build error
  rather than a leak.

  **External orders** — `validateExternalOrder`, `createExternalOrder`,
  `listExternalOrders`, `getExternalOrder`, `cancelExternalOrder`, plus a local
  `isCancellable` so a UI can hide the button instead of offering an action that
  throws.

  `validateExternalOrder` is the only place the at-cost breakdown
  (`manufacturingCost`, `fulfillmentFee`, `shippingCost`, `totalCreatorCost`) is
  available before money is committed. **Fourthwall answers 200 for a validation
  that FAILED**, with the reasons in the body — so `res.ok` is not the verdict, and
  the client reads `valid`/`errors` instead. Treating the status as the answer
  submits an order that was just told it wouldn't work.

  **`createExternalOrder` never retries, even when `config.retry` is set.**
  Fourthwall has no idempotency-key header, so unlike Square a retried create that
  actually succeeded server-side is a second order and a second charge. A sync job
  that enabled retries globally must not silently inherit that on the one call that
  spends money.

  **Products** — `createProduct`, `deleteProduct`, `setProductAvailability`,
  `setProductState`, `addProductImages`, and read-only `getProductInventory`.

  **There is no product update, and there never will be — the API has none.** No
  endpoint changes a product's name, description, price, or variants after
  creation. The only remedy is delete and re-create, which mints a new id, so
  anything keyed on the old one has to be reconciled. That is documented at
  `createProduct` rather than in a release note, because it is where someone
  looking for `updateProduct` will actually land.

  `createProduct` takes a discriminated input: physical products carry
  `profitMargin` (Fourthwall derives the price), digital products carry an absolute
  `price`. The type makes the wrong one unspellable rather than silently ignored.

  `getProductInventory` returns `quantity: null` for an untracked variant, distinct
  from `0` — collapsing them hides a sellable variant. There is also no inventory
  webhook, so stock drift is only detectable by polling.

  **Rate limiting, on by default.** A token bucket per shop honouring the two
  published limits — 100 requests/10s globally and 5 `POST /products`/minute — both
  counted per shop, so adding API users buys no budget. Continuous refill rather
  than a fixed window, since a fixed window lets 2× the limit through across a
  boundary. Product creates spend from both buckets, and acquisition is serialized
  so N concurrent callers can't all observe the same empty bucket and burst
  together.

  The buckets are per **isolate**, and the module says so plainly: two Workers
  isolates, or a cron and a queue consumer running concurrently, each get a full
  bucket. This prevents the failure that actually happens — one loop hammering an
  endpoint it could have paced itself under — and does not pretend to be
  distributed coordination. Put the calls behind a Durable Object if you need that.

  `rateLimitKey` groups clients that share a shop; it defaults to `username`, which
  is right for one user per shop and wrong for several.

- 2164d91: **`mountStudio` — the Louise editor as a full-page admin app.**

  The drawer shell was drawer-shaped: summoned over a live page, dismissed, gone.
  Right for editing in place, wrong for the back-office half of the job — a session
  spent in Media and Pages, deep-linked and bookmarked. A site wanting that had to
  rebuild the shell even though every panel it needed already existed.

  ```ts
  import { mountStudio } from "louise-toolkit/client/studio";
  mountStudio({ title: "Acme Studio", users: true });
  ```

  **A second presentation, not a second implementation.** Both render the same
  panels through a shared `surface` module, so they cannot drift about which panels
  exist or how a dashboard card deep-links to one. The drawer adds a scrim, a dialog
  role, a focus trap and a close button; the studio adds none of them because it is
  always open. Its own subpath (`louise-toolkit/client/studio`) keeps each out of
  the other's bundle.

  **Two constraints are built in rather than left to the caller:**

  - **The shell renders no data and no session-specific markup**, so it stays
    precacheable by a service worker — pair with `PwaConfig.offlineFallback`. Every
    panel fetches through `/api/*` on mount, and `title` is a site name rather than
    an editor name for exactly this reason.
  - **A 401 becomes a navigation.** A full-page app can't degrade to "render the
    public page" — there is no page underneath — so an expired session sends the
    browser to `signInPath` (default `/signin`). Handled centrally, because the one
    panel that forgot would render an empty list that reads as "no data" rather than
    "signed out".

  Two supporting changes fall out of that:

  - `apiGet` / `apiSend` now throw a **`LouiseApiError` carrying `status`**, with an
    `isApiStatus(error, 401)` helper. Callers genuinely branch on status, and
    matching it by parsing an error string would break the first time the message
    was reworded.
  - **401s are no longer retried** (both presentations). An expired session fails
    again a second later by definition, so the retry only delayed the response to it
    by the length of the backoff. A 403 — a permissions answer, not an expired
    session — is still retried once.

- 71cc1d7: **Catalog writes can now carry imagery and taxonomy, and locations can be created.**

  The read path already mapped `image_ids` and `categories` / `reporting_category`;
  the write body emitted neither, so `mapCatalogItem` after a write always came back
  with `imageUrl: null` and a pushed item landed in no category at all. Both are now
  on `CatalogPresentationInput`, shared by `upsertCatalogItem` and
  `batchUpsertCatalogObjects`:

  - `imageIds` — display order, first is primary
  - `categoryIds`
  - `reportingCategoryId` — the single category Square attributes sales to

  **`reportingCategoryId` must appear in `categoryIds`, and that now throws if it
  doesn't.** Square reports against it regardless of membership, so the mismatch
  costs you a product that is missing from every sales breakdown while looking
  correct in the dashboard — findable only by someone who already suspects it.

  Unset keys are omitted rather than sent empty. An absent key means "leave it
  alone" and `[]` means "clear it", so defaulting to `[]` would strip every item's
  imagery on the first price update.

  **`createCatalogImage`** uploads the bytes and returns the id those `imageIds`
  take — the catalog write accepts ids, never bytes. It is multipart, and
  deliberately not built on the JSON verbs: `content-type` has to carry the boundary
  `fetch` generates, and setting it by hand breaks the upload in a way that surfaces
  as a Square-side rejection. Pass `objectId` to attach during upload, or omit it
  and attach later — which is what you want for many items sharing one picture,
  since re-uploading the same bytes bills and stores per item.

  **`createLocation` / `updateLocation`** complete the Locations API. `updateLocation`
  is sparse, so an omitted field is never cleared — but note that `address` is a
  nested object Square replaces wholesale, so a partial address replaces the whole
  one. Currency is deliberately not settable: Square derives it from the seller
  account, so all locations under one account share it. A merchant needing a
  different currency needs a different account, which is an onboarding constraint
  worth knowing before designing around it.

- 71cc1d7: **Fixed: order search broke on the eleventh location.** `searchOrders` and
  `searchOrdersByCustomer` passed `locationIds` straight through to
  `/v2/orders/search`, where Square caps `location_ids` at **10 per call** — a
  documented hard ceiling that answers an eleventh id with a 400, not a truncation.

  Both now chunk at 10 and merge, sequentially rather than in parallel: a
  300-location account is 30 searches, and firing those at once is the surest way
  to meet the rate limit this client only retries when asked to.

  Merging needs one thing more than concatenation. **Square sorts within a
  response, not across our chunks**, so above 10 locations the result was ordered
  per chunk and unordered overall — which spot-checks fine and puts the wrong rows
  in any "top N" or "most recent" that trusts the order. Results are re-sorted on
  the same axis the search used, with orders missing that timestamp sorted last in
  both directions (an `OPEN` order has no `closed_at`, and unguarded it lands where
  "newest" should be). `searchOrdersByCustomer` also trims to `limit` after
  merging, since `limit` is per request and N chunks otherwise return N×limit.

  An empty `locationIds` now throws instead of asking Square to reject it. Not
  returning `[]` deliberately: a reporting call that silently yields no rows reads
  as "no sales", which is worse than an error.

  Also adds **`calculateOrder`** (`POST /v2/orders/calculate`) — preview a cart's
  totals including auto-applied taxes through the same pricing engine checkout
  uses, without persisting an order to clean up if the customer walks away. It
  shares `orderLineItemBody` with `createOrder` and `createPaymentLink`, so the
  preview cannot drift from the charge.

- 71cc1d7: **`readModifyWriteCatalog` — edit a catalog object without silently erasing it.**

  Square documents this hazard verbatim: _"If a client reads an object at an older
  API version and writes it back at a newer version, fields that were introduced
  between those two versions will be absent from the request, and the server will
  interpret that absence"_ — as an intentional clear. `SQUARE_VERSION` was pinned,
  but nothing enforced read/write symmetry at the call site and there was no helper,
  so every consumer hand-rolled one and any of them could get it wrong.

  The generalised form is worse than the version-skew case: _any_ read-modify-write
  that rebuilds the object from the fields it models erases whatever it doesn't.
  `location_overrides` is the one that hurts, because per-location pricing is
  invisible in a naive round trip and its loss looks like a pricing decision.

  So the helper never rebuilds. It reads the raw object, hands _that object_ to the
  mutator, and writes back what it got — with the version from that read (a
  concurrent write then makes yours fail rather than clobber) and the same pinned
  `Square-Version` on both calls. `SquareCatalogObject` is deliberately an open type
  with an index signature: a closed interface would invite exactly the
  reconstruct-from-parts bug this exists to prevent.

  **Two write-path guards**, folded in from the multi-location work:

  - **A variation's locations must be a subset of its parent item's.** Square
    documents the rule and does not enforce it — violating it yields a silent
    partial state where the item renders at a location with no purchasable
    variation beneath it. Now a thrown `Error` before the request rather than a
    puzzle in production.
  - **250 variations per item**, Square's cap and the first ceiling a
    per-merchant-variation design meets. Thrown before the write instead of arriving
    as a 400 partway through a catalog push.

  Both apply to `upsertCatalogItem` and `batchUpsertCatalogObjects`.

- 89a9afb: **Wildcard host dispatch: a `rewrite` hook, and the `tenancy` config that uses it.**

  Serving `*.example.com` from one Worker — scoped views of one brand's data, a
  per-merchant storefront — had no seam. `AstroidConfig.hosts` is consumed only by
  the wrangler generator, which emits `{ pattern, custom_domain: true }`; a wildcard
  needs `{ pattern, zone_name }` and explicitly **not** `custom_domain`, so `hosts`
  cannot express it. And there was nowhere to put the dispatch: `src/middleware.ts`
  is generated, Astro permits exactly one middleware file, `extend` returns `void`
  and `guard` returns only a `Response` — so **neither existing hook could rewrite**.

  **`createLouiseMiddleware` gains `rewrite?: (context) => string | undefined`**
  (louise-toolkit), called before `next()` and **after `guard`** — so route policy
  stays written against the URL a visitor actually asked for rather than an internal
  one. It sits outside the `extend` try/catch for the same reason `guard` does: a
  rewrite that throws must not degrade into rendering the _unrewritten_ path, which
  under host dispatch is another tenant's page.

  **`AstroidConfig.tenancy`** (astroidjs) wires it up: the wrangler generator emits
  the wildcard zone route alongside the apex custom domain, the generated middleware
  resolves a label and rewrites, and a scaffold-once `src/tenancy.ts` holds the
  lookup.

  ```ts
  tenancy: { hostPattern: "*.example.com", reserved: ["www", "studio"] },
  hosts: ["example.com"],
  ```

  **The site keeps every decision.** What a label maps to, whether the lookup is
  cached, and what an unknown host means all live in `src/tenancy.ts` — with the
  last stated as a decision rather than defaulted quietly, since falling through to
  the ordinary site means a stranger's CNAME renders your homepage.

  **Two config-time refusals.** A non-wildcard `hostPattern` (that is a custom
  domain — put it in `hosts`), and an apex missing from `hosts`: a wildcard route
  does not match its own apex, so `example.com` would 404 the moment tenancy was
  switched on, with a symptom that reads as unrelated to the feature that caused it.

  `tenantLabel(host, tenancy)` is exported and pure so a site can unit-test its own
  reserved list. It returns `null` for the apex, off-pattern hosts, reserved labels,
  and dotted labels — Cloudflare's wildcard matches one level, and a dotted slug
  would put a `/` in the rewrite path.

  This does not weaken the one-brand-per-project rule; that note in `config.ts` is
  clarified rather than contradicted.

### Patch Changes

- 71cc1d7: **The editor and settings chrome stopped loading full-size originals.**

  Published pages render through `<MediaSlot>`, which is what it exists for. The
  chrome had no equivalent: every `<img>` in `src/client` pointed at the raw
  media-library URL, so a 6 MB camera original was fetched at full resolution to
  fill a 120 px thumbnail. The media picker was the worst case — open it against a
  library of 200 assets and the browser is asked for 200 full-size masters.
  `loading="lazy"` bounds how many arrive at once; it doesn't make any of them
  smaller.

  Edit-mode-only, so it never touched published-page metrics — most likely why it
  went unnoticed. It was still the slowest surface in the product, and slow for the
  people using it most.

  A new internal `thumb(url, px)` wraps `cfImage` at 2× the display box, applied at
  all six chrome call sites: both picker grids, the media-library tile, the image
  field's selected-value preview, the sections image preview, and the ProseKit
  image node view. Each renders at a known size, which is what makes this cheap —
  the caller passes the box rather than guessing.

  `ImageField`'s `transform` prop had been designed and left unwired — its own doc
  comment named `cfImage` as the intended use and no caller ever passed one. It now
  **defaults** to a sized derivative and remains available as an override.

  Two things preserved deliberately:

  - **The ProseKit node view transforms for display only.** `attrs().src` is what
    serializes into stored content and what the site renders via `set:html`, so
    rewriting it would bake a fixed width and crop into the document and defeat
    re-cropping later. A test asserts both halves — the rendered `<img>` carries a
    `/cdn-cgi/image/` URL, the serialized HTML does not — because asserting only
    the stored side would still pass if the node view stopped transforming at all.
  - **The zone dependency.** `/cdn-cgi/image/` requires Image Resizing on the
    serving zone; a site whose `MEDIA_URL` is a plain R2 bucket domain gets the
    original back — correct, just not smaller. Documented on the helper so nobody
    debugs it twice.

- 7a08f74: **Fixed docs: the TanStack validator bridge must be wired to `onChangeAsync`, not
  `onChange`.**

  `tanstackFieldValidator` returns an async function — deliberately, so DB-backed
  custom rules can be awaited. TanStack Form keys its validator slots on exactly
  that distinction, and the toolkit's own doc comment and both docs pages showed the
  **sync** slot.

  Verified against `@tanstack/solid-form@1.33.2`: a promise-returning function in
  `onChange` is stored **as the promise**, so `meta.errors` holds a pending
  `Promise` instead of a string. Nothing throws. The message never renders and the
  submit button never disables — which reads exactly like "validation isn't
  running", and sends you looking upstream rather than at the wiring.

  ```diff
  - <form.Field name="email" validators={{ onChange: v.email }}>
  + <form.Field name="email" validators={{ onChangeAsync: v.email }}>
  ```

  `onBlurAsync` and `onSubmitAsync` take the same function; pair with
  `onChangeAsyncDebounceMs` when a rule hits the network.

  Docs-only for the runtime — no behaviour changed — but the previous instructions
  produced a form that silently didn't validate.

  Also documents that the validator map is **flat**: `defineForm` has no array or
  nested field type, because each field is one column. A form with repeating rows
  builds its array with TanStack's own API and attaches these validators to the
  leaves.

  **Removed a doc comment pointing at an export that does not exist.**
  `client/forms.tsx` advertised an opt-in solid-form scaffold at
  `louise-toolkit/client/tanstack-form`. There is no such subpath, no such module,
  and `@tanstack/solid-form` is not a peer dependency — following the comment gets
  you a resolution error. It now says what is actually true: build a complex form
  yourself with TanStack and keep one validation definition through
  `tanstackFormValidators`. No scaffold is planned, and the docs say why.

- 7a08f74: **Documented: a routed app inside an Astro `client:only` island.**

  `@tanstack/solid-router` mounted in a `client:only="solid-js"` island is
  undocumented anywhere upstream — the Router repo's Solid examples are all
  standalone Vite or Start-based. Spiked (#317) against `astro@7.1.6` +
  `@tanstack/solid-router@1.170.18` and verified in a real browser: deep-link
  refresh through an Astro catch-all, `basepath`, history across island
  navigations, and that navigation genuinely stays client-side.

  Both router configurations work — literal prefixed route paths, or
  `basepath: "/app"` with root-relative ones. Router #4888 is filed against
  `@tanstack/solid-start` and doesn't apply.

  **One caveat, documented rather than smoothed over:** Astro's static build emits
  directory-style URLs (`/app/orders/` → `index.html`) while the router writes
  history entries _without_ a trailing slash. `astro preview` serves both, but
  that's the preview server being lenient — confirm it on a real deploy, since this
  is the class of thing that works in dev and 404s in production. Serving the app
  from its own subdomain sidesteps it entirely: the browser only sees root paths, so
  `basepath` is `/`.

  Docs only. ADR 0011 moves Router from "unproven, spike before committing" to
  adopted, and records the #316 form findings alongside it.

## 0.22.0

### Minor Changes

- 8725ab4: **A field's choices can now be fetched.** `SectionField.options` accepts an async
  resolver — `() => Promise<FieldOption[]>` — as well as a literal array, so a
  picker whose values come from an API can be declared in a section catalog:

  ```ts
  colorway: { type: "select", options: [{ value: "blue" }] },        // as before
  location: { type: "select", options: () => listSquareLocations() }, // new
  ```

  This is what the settings drawer's `render` escape hatch was doing by hand, and
  the section inspector had no equivalent of. It is the piece coracle.coffee#37's
  Square pickers were blocked on.

  The picker draws three states, not one: the choices, the wait, and the failure. A
  picker that renders empty when its fetch failed is indistinguishable from one
  whose source genuinely has nothing, so a failure now says so and the select is
  disabled rather than appearing to have lost the stored value while loading.

  One fetch per resolver is shared by every field using it — the promise is cached,
  not just the result, so an inspector opening ten fields at once makes one request
  rather than ten. A failed fetch is not cached, so the next attempt is fresh.

  **The trade, stated plainly:** a RESOLVED option set is not checked on write. A
  literal set still is. Validating a fetched set would put a network call on the
  save path, and a page failing to save because an external API is down is a worse
  failure than an unrecognised token — it also hands that service the ability to
  block publishing. A field wanting the closed-set guarantee back declares it with
  its own `validation` chain. ADR 0010's Phase B is where this gets a real answer:
  an `external` source is mirrored by definition, and a local mirror is something
  the write path can check without leaving the Worker.

  **Type-level breaking change:** code that reads `field.options` as an array must
  narrow first (`Array.isArray(field.options)`). Catalogs that only _declare_
  options are unaffected.

- a684acc: **Breaking (marker contract).** One attribute now marks everything editable.
  `data-louise-sfield` folds into `data-louise-node`, and `data-louise-type="richtext"`
  and `data-louise-multiline` are gone — the catalog already says what a field is.

  ```diff
  - <h1 data-louise-sfield={`${i}.heading`}>{heading}</h1>
  + <h1 data-louise-node={`${i}.heading`}>{heading}</h1>

  - <p data-louise-sfield={`${i}.tagline`} data-louise-multiline>{tagline}</p>
  + <p data-louise-node={`${i}.tagline`}>{tagline}</p>

  - <div data-louise-sfield={`${i}.body`} data-louise-type="richtext" />
  + <div data-louise-node={`${i}.body`} />
  ```

  The path values are unchanged, so this is a rename plus two deletions. Astroid's
  `<Editable>` emits it for you; its `type` and `multiline` props are accepted and
  ignored for section fields.

  **What the catalog decides.** A `text`, `textarea` or `richText` field is edited
  in place — contenteditable, the right editor, spellcheck on multiline — and gets
  no chrome of its own. Anything else rings and gets a wrench. The render says only
  _where_ a node is; it no longer describes what it is in three attributes the
  schema already carried.

  **Hit-testing changed.** An unresolved node used to mean "clear", which was right
  while only ring-worthy things were marked. Now the tightest marker under the
  pointer is usually an inline field with no chrome by design, so the hit-test walks
  **outward** to the nearest node that has some. Hovering a CTA's label rings the
  anchor around it rather than clearing — without this the page would feel dead
  wherever text sits.

  Also: a value node's wrench is now named after its field. It was "Layout &
  settings", which describes a container's panel — but a value node's wrench is its
  entire toolbar and opens one field.

- 2e6ebe3: **Rich-text options are declared on the field.** A `richText` field carries its own
  editor options in the catalog:

  ```ts
  fields: {
    heading: { type: "richText", richText: { inline: true, image: false } },
    body:    { type: "richText", richText: { minimal: false, grammar: true } },
  }
  ```

  `richTextModes` shipped as a mount-level map keyed by a `data-louise-rt` name the
  render stamped — a rendezvous between two files to establish something the catalog
  already knew. ADR 0010 called it out as a symptom: editor options were mount-level
  when they always belonged to the field.

  Resolution order is most-specific-first: the field's own `richText`, then a
  stamped `data-louise-rt` mode, then the site-wide `richText`, then the light
  inline bubble. **Nothing is removed** — `richText` and `richTextModes` keep
  working, and a render that stamps `data-louise-rt` is unaffected.

  **Also fixed: a block field's placeholder was ignored.** Resolving a
  `data-louise-sfield` path back to its field handled `<i>.<key>` and
  `<i>.<key>.<j>.<sub>` but not `<i>.blocks.<j>.<key>` — the path starts with
  `blocks`, which is not a field, so the lookup found nothing and every block field
  fell back to a humanised key. A block field declaring `placeholder: "Feature name"`
  showed "Name". Both lookups now share one resolver.

- f02c87a: **One field-type system.** `SectionFieldType` (8 types) and `SettingsFieldType`
  (6) were parallel, overlapping on four and disagreeing on the rest, so a type
  added to one surface was silently missing from the other. Both are now aliases of
  one `FieldTypeName`, backed by the `defineFieldType` registry.

  That asymmetry was not only duplication. Settings had a `links` type and no `link`
  type, so there was nowhere for a scheme check to live — which is why stored nav
  destinations went unvalidated until the XSS fix. `links` now validates each row's
  `href` against the same allowlist as a section's `link`.

  `color` and `links` were settings-only and are now registered types a section
  catalog can declare. `richText`, `array`, `select` and `link` were sections-only
  and are now available to settings.

  **Field types are extensible.** `SectionFieldType` was a closed union, so a type
  registered via `defineFieldType` widened the runtime but not the type a catalog
  could write. It now admits any string alongside the built-ins, keeping editor
  completion for the ten known names while letting a site's own registered type be
  authored.

  The trade is that a typo — `"txet"` — is no longer a compile error; it validates
  as nothing rather than failing. `unknownFieldTypes(fields)` is the check that gets
  back, opt-in and covering site-registered types, which the closed union never
  could.

### Patch Changes

- 153c5ba: **Security.** Settings link rows are now scheme-validated on write.

  `navLinks` and `socialLinks` are stored as `{ label, href }` arrays and rendered
  straight into `<a href={…}>` in a site's chrome — on every page. Nothing checked
  the scheme, so an authenticated editor could store `javascript:alert(1)` as a nav
  destination and it would persist and render as a working link for every visitor.

  Sections closed exactly this hole with the `link` field type, whose comment spells
  out the vector: a destination is rendered by the site's own component and never
  passes through the HTML sanitizer, which only ever sees rich-text markup. Settings
  never got the same treatment.

  `PATCH /api/louise/settings` now rejects an unsafe `href` with `422`, against the
  same allowlist sections use — http(s), `mailto:`, or a site-relative path.

  The check is shape-driven rather than key-driven: any patched value that is an
  array of objects carrying an `href` is treated as a link list. An `imageKeys`-style
  opt-in would mean every site has to remember to configure it, and the site that
  forgets is the one that gets hit.

  No action needed on upgrade unless a site has already stored a non-conforming
  destination, in which case the next settings save of that field returns `422` with
  the offending row's path.

## 0.21.0

### Minor Changes

- 5c64e11: **Breaking (marker contract).** One attribute now marks every editable node:
  `data-louise-node="<path>"`. It replaces `data-louise-section="<i>"`,
  `data-louise-block="<i>.blocks.<j>"`, and `data-louise-link="<path>"` — three
  attributes over four path grammars, parsed two different ways (ADR 0010, Phase A1).

  Sites must rename their stamps. The value is unchanged in every case — only the
  attribute name moves — so it is a rename, not a re-derivation:

  ```diff
  - <div data-louise-section={i}>
  + <div data-louise-node={i}>

  - <article data-louise-block={`${i}.blocks.${j}`}>
  + <article data-louise-node={`${i}.blocks.${j}`}>

  - <a data-louise-link={`${i}.ctaHref`}>
  + <a data-louise-node={`${i}.ctaHref`}>
  ```

  Astroid's `<Section>` stamps this for you and no longer sniffs `base` for
  `".blocks."` to choose between two attribute names. `data-louise-sfield` is
  untouched — inline text keeps its own marker until the field registry lands
  (Phase A2).

  **What the rename buys.** The chrome no longer knows a section from a block from
  a link. It hands a parsed path to the editor and draws whatever capabilities come
  back — `ordered` gives move/delete and a sibling `+`, `children` gives an add,
  `fields` gives a wrench. Three consequences:

  - **An empty container can be filled.** A block-capable section with no blocks
    offers its own `+`. Previously the only `+` for a block lived on a block's
    toolbar, so a freshly added section was a dead end with no way to add the first
    one.
  - **A CTA's wrench opens the CTA.** A value node's inspector scopes to the field
    it addresses, instead of its owning section's whole panel — clicking one of four
    CTAs used to surface all four destinations at once.
  - **Every toolbar is the same toolbar.** The link bar rendered orange because each
    layer hand-built its own chrome and one background rule was missed; there is now
    one bar, tone-keyed from the descriptor.

  A new kind of node — a shared value, an external source (Phase B) — becomes a
  change in the editor's `resolve` rather than another layer of chrome.

## 0.20.0

### Minor Changes

- 53afba9: Link chrome layer — a ring and a wrench on any marked CTA.

  Completes the toolkit half of coracle.coffee#38. The `link` field type gave a
  destination a proper editor; this gives it an _affordance_, so an editor reaches
  it by pointing at the button rather than hunting for the right container's wrench.

  A render opts a CTA in with a third marker:

  ```astro
  <a href={ctaHref} data-louise-link={edit ? `${idx}.ctaHref` : undefined}>
  <a href={b.href} data-louise-link={edit ? `${idx}.blocks.${j}.href` : undefined}>
  ```

  Wire it with `links` on `mountSectionChrome` (the sections editor does this for
  you):

  ```ts
  links: {
    onInspect: (ref) => openInspector(ref);
  }
  ```

  **The marker points at a FIELD, not a container** — unlike section and block
  markers. A link's identity is the destination it edits; where it sits and whether
  it exists belong to whatever contains it. `parseLinkMarker` accepts
  `"<i>.<key>"` and `"<i>.blocks.<j>.<key>"`, rejecting anything else rather than
  crashing the chrome, matching the other two readers.

  **Wrench-only toolbar**, deliberately. Offering move/delete would duplicate the
  block's own buttons, or worse imply a CTA can be reordered independently of the
  copy around it.

  **Hit-testing stays deepest-boundary-wins**, now three deep: a link beats the
  block it sits in, which beats the section around that. Exactly one layer lights at
  a time — two rings at once would make it ambiguous which container's wrench you're
  about to click.

  **Violet ring** (`--louise-violet`), not green or yellow: those are reserved for
  the reference rings (internal-shared / external-source) that Phase 3 introduces,
  and a link is neither.

  Additive — a chrome that passes no `links` mounts no link toolbar and behaves
  exactly as before.

- a57e375: `link` and `toggle` section field types — a real destination editor, and a URL allowlist.

  ## `link`

  A destination has no visible text node to click, so it has always been wrench-edited
  — but as `{ type: "text", inline: false }`, which renders a bare text box. `link`
  gives it a proper editor: a page picker plus a free URL field, lifted out of the
  rich-text builder (where it already existed) so both hosts share one control.

  The value stays a **plain string href**, so adopting it is a pure schema change —
  `{ type: "text", inline: false }` → `{ type: "link" }` with no data migration.

  ```ts
  ctaHref: { type: "link", label: "Button link" },
  ```

  ### 🔒 It closes a real hole

  `validateSectionField` had no branch for these fields, so they fell through to
  "must be a string" — and a site component renders the value straight into
  `href={…}`, which never passes through the HTML sanitizer (that only ever sees
  rich-text markup). A `ctaHref` of `javascript:alert(1)` would validate, persist,
  and render as a working XSS vector for every visitor of the published page.

  `link` fields are now checked against the **same scheme allowlist the sanitizer
  applies to markup hrefs** — `http(s):`, `mailto:`, `/`, `#`, `.` — with a test that
  pins the two together by outcome, so they can't drift.

  **This can reject writes that previously succeeded.** If a site stored a
  destination with an unusual scheme (`tel:` is the likely one — neither allowlist
  permits it), switching that field to `link` will 422 until the value changes.
  Audit stored hrefs before adopting the type on an existing field.

  ### `builtInRoutes`

  `SectionsEditorProps.builtInRoutes` feeds code-defined routes into the picker.
  Its page list comes from `/api/louise/pages`, which only knows DB-backed pages —
  a site's hand-authored routes (`/shop`, `/contact`) have no row, so without this
  the picker is missing exactly the destinations most CTAs point at.

  ```ts
  mountSections(el, {
    builtInRoutes: [{ path: "/shop", title: "Shop" }],
  });
  ```

  A failed page fetch degrades to the URL field alone rather than breaking the wrench.

  ## `toggle`

  A real boolean field, so "open in new tab" stores `true`/`false` rather than a
  yes/no `select` whose `"false"` would read truthy in a site render. Validation is
  deliberately strict about this — coercing a stringly value would turn a bad write
  into a wrong page instead of an error.

  Both types are additive; existing catalogs are unaffected.

## 0.19.0

### Minor Changes

- e7e0f56: Editor: the block toolbar's `+` opens a type-picker when a section accepts more than one block type.

  **Why.** `addBlock` resolved the new block's type as `blocks.allow[0]` — the first
  allowed type — so a section declaring `allow: ["image", "text", "button"]` could
  only ever grow `image` blocks, and the other two were unreachable from the canvas.
  That made the block layer usable for single-type sections only, which is not what
  ADR 0005 §4 promises and is what blocked a block-capable Content section.

  **What changed.** `+` now resolves the section's full allowed set and:

  - **one type** — inserts it straight away, unchanged from before (no prompt for a
    choice that isn't a choice);
  - **several types** — opens the same palette the section `+` uses, anchored under
    the block, labelled `Add a block`, dismissed on outside-press / Escape.

  Insertion stays **after** the hovered block. That is deliberately the opposite of
  the section `+` (which inserts _above_): a section list is navigated as a page you
  push things down in, whereas a section's blocks read as a list you extend
  downward.

  **`allow` omitted now means "any block type".** ADR 0005 §4 always defined it that
  way, but `allow?.[0]` on an absent `allow` yielded `undefined`, so `blocks: {}`
  silently produced a dead `+`. Those sections now offer the whole `BlockCatalog`.
  A section with no `blocks` policy at all is unaffected — it is not opted into the
  block layer and gets no add affordance.

  Block types listed in `allow` that have no `BlockCatalog` entry are dropped from
  the picker rather than offered: without a field shape there is no blank to seed.

- e7e0f56: Editor: History moves into the Settings drawer, and the bar's "Done" becomes a real "Sign out".

  Phase 2 of the editor overhaul (coracle.coffee#36) — declutter the bar and stop
  splitting account actions across two surfaces.

  ## History

  The version-history **trigger** moved into the Settings drawer's top strip, next
  to Pages/Media/Settings. The **drawer itself did not move** and is still not a
  Settings panel: versions are per-**page**, Settings is global, and the sections
  surface mounts independently of `mountSettings`. Making history a panel would have
  meant threading a page context into a global shell and losing history entirely on
  sections-only hosts.

  So the two surfaces hand off through window events, and each degrades on its own:

  - A mounted sections surface sets `data-louise-history` on `<html>`. Settings only
    renders the History icon when it's there, so the icon is never a dead button on
    a host that mounts Settings but no sections.
  - Clicking History closes the Settings drawer before opening the history one —
    two stacked modals would fight over the focus trap.
  - Sections keeps its own bar History button **only** when Settings isn't mounted.
    It detects `#louise-drawer-root` on mount and also listens for
    `SETTINGS_READY_EVENT`, so either mount order resolves correctly.

  New exports from `louise-toolkit/editor` settings: `OPEN_HISTORY_EVENT`,
  `SETTINGS_READY_EVENT`, `HISTORY_READY_ATTR`.

  ## Sign out

  ⚠️ **The bar's rightmost action now ends the session.** "Done" was an `<a>` to
  `?louise=off`, which cleared the edit-mode cookie and left the session fully
  open — so on a shared machine the control that _looks_ like leaving didn't log
  anyone out, and the only real sign-out was buried in the Settings drawer. It is
  now a `<button>` labelled **Sign out** that POSTs `/api/auth/sign-out` and _then_
  drops edit mode. The sign-out call is best-effort: if it fails, edit mode is still
  dropped, so a user can't be stranded in an editor they asked to leave.

  The duplicate **Session → Sign out** group is gone from the Settings panel.
  `settingsExtras` is unaffected. No CSS change — `.louise-exit` already shared its
  rule block with `.louise-settings`, which was already a button.

- e7e0f56: Editor overhaul, Phase 0 (correctness) + Phase 1 (chrome and the add flow).

  Backfills the changeset for #323, which merged without one.

  ## Correctness

  **Grammar checker latches off when `harper.js` is missing.** A missing or broken
  optional peer made the editor re-import — and re-fail — the linter on every typing
  pause, flooding the console and doing repeated rejected-promise work on the hot
  path, which could intermittently break a section save. The first load failure now
  latches a module-scoped flag: log once, stop scheduling. Teardown gained a
  `.catch` so a pending load can't surface as an unhandled rejection.

  **Page links, CTAs and forms are inert while editing.** A stray click on a link
  used to navigate away mid-session; a form could submit. Both are now suppressed in
  edit mode, so the click lands on the label as an inline edit instead. Implemented
  as capture-phase `preventDefault` only — no `stopPropagation` — so inline-edit
  focus still arrives and site CSS/hover is untouched. The editor's own chrome is
  exempt.

  **Rich text gained an `inline` single-line mode.** Editing a heading or tagline
  used to be able to turn it into a `<p>`/`<h2>` nested _inside_ the site's own
  heading element, silently losing the brand style. `inline` restricts to inline
  formatting, suppresses block-splitting keys, and serializes the value as inline
  HTML with no block wrapper. An `image` toggle controls the insert-image button.
  Threaded through `mountRichText`.

  ## Chrome and the add flow

  **Toolbar glyphs are phosphor SVGs** (arrow-up/down, x, plus, wrench) rather than
  unicode/emoji — monochrome, `currentColor`, consistent across platforms.

  ⚠️ **This changes how toolbar buttons are located.** They no longer carry glyph
  text, so any selector or test matching on `textContent` (`"⚙"`, `"+"`, `"✕"`)
  stops matching. Use the `aria-label` instead — e.g. `"Layout & settings"`,
  `"Add block after"`, `"Add section above"`.

  **`SectionChromeActions.onAdd`** is new (optional): supplying it gives the section
  toolbar a `+`.

  **The `+` opens a type-picker that inserts ABOVE the clicked section.** The
  floating "Add section" control is gone, replaced by an in-flow trailing add — and
  a single centred `+` on an empty page. `addSection(type, atIndex)` takes the
  insert index.

  **`inline: false` array fields render an editable input per item** in the
  inspector, so array content (marquee words, contact topics) is finally typeable
  rather than read-only.

  Additive and backwards-compatible throughout — existing behavior is unchanged
  unless a site opts in via `richText` or `onAdd`. The glyph-to-SVG change is the
  one thing that can break a downstream selector.

- 5b4d17b: `richTextModes` — per-field rich-text presets for section fields.

  **Why.** `SectionsEditorProps.richText` applied one options object to _every_
  `data-louise-type="richtext"` field on the page, which falls apart as soon as a
  site has both kinds of rich text. A site whose headings need `inline` (so editing
  an `<h1>` can't produce a nested `<p>` that loses the brand style) was forcing that
  same single-line mode onto prose bodies, where it suppresses exactly the block
  formatting — paragraphs, lists — that a body needs.

  A render now opts an individual field into a named preset by stamping
  `data-louise-rt` beside the type marker:

  ```ts
  mountSections(el, {
    richText: { inline: true }, // every heading
    richTextModes: { prose: { minimal: false, grammar: true } }, // opted-in bodies
  });
  ```

  ```astro
  <div data-louise-type="richtext" data-louise-rt="prose" set:html={body} />
  ```

  Resolution is per field: the named mode, else `richText`, else the light-inline
  bubble. An **unknown** mode name falls back to the site default rather than
  throwing — a render stamped for a mode the mount doesn't declare should degrade to
  the default, not lose its editor.

  Fully additive: a mount that sets no `richTextModes` behaves exactly as before.

- 977a2de: Square multi-location: per-merchant pricing, presence, batch catalog + inventory writes, and reporting.

  **Why.** A multi-merchant site maps each merchant to a Square **Location**, which
  is what buys per-merchant pricing and per-merchant stock off one shared catalog at
  no extra cost (Locations are free; the cap is 300). The client had none of the
  location surface, so every one of those reads and writes was unavailable.

  **`listLocations` / `retrieveLocation`.** `retrieveLocation` returns `null` on a
  404 rather than throwing: "this merchant has no Square location yet" is a
  legitimate state, not an exception the caller should have to catch.

  **Per-location pricing and presence, on read and write.** `SquareVariation` gains
  `locationOverrides`, and both it and `SquareCatalogItem` carry the three presence
  fields. Two helpers hold the logic so no caller re-derives it:

  - `presentAt(presence, locationId)` — Square's two lists are **not** symmetric:
    `present_at_location_ids` is a whitelist used when `present_at_all_locations` is
    false, `absent_at_location_ids` a blacklist used when it is true. Inverting that
    silently shows a merchant products they do not carry.
  - `priceAtLocation(variation, locationId)` — the location's override price where
    one is set, else the base price. An override that adjusts availability without
    setting a price correctly falls back rather than reading as free.

  `upsertCatalogItem` and `CatalogVariationInput` accept `presence` and
  `locationOverrides`; unset keys are omitted from the request body so a write never
  clobbers Square-side presence with an accidental default. An override that sets a
  price also sends `pricing_type: FIXED_PRICING`, without which Square keeps
  inheriting `VARIABLE_PRICING` from the parent.

  **`retrieveVariationPricesAt`** — the multi-merchant checkout guard. Verifying a
  cart against base prices would let a customer pay the cheapest merchant's price at
  the dearest merchant's storefront, so re-price against the location the order is
  actually placed at. A variation absent at that location is **omitted** from the
  result, so a caller requiring every id to resolve fails closed instead of selling
  stock the merchant does not carry.

  **`batchUpsertCatalogObjects`** — one request instead of one per item, which is
  what keeps a full catalog push from becoming a rate-limit problem. Splits across
  Square's 10-batch limit. The call is atomic: one stale `version` fails the whole
  batch, which is the right trade for a price push (no half-applied change).

  **`batchChangeInventory` / `setPhysicalCount`.** Note the direction of truth —
  D1 owns price, presence and placement; **Square owns inventory counts**. These
  exist for the reconcile path (a physical recount, seeding a new merchant's opening
  stock), not for mirroring a D1 number over Square's. Prefer `PHYSICAL_COUNT`: it
  sets an absolute quantity, so a replayed message lands on the same number, whereas
  a replayed `ADJUSTMENT` double-counts.

  **`searchOrders`** — the reporting rail (best-sellers, per-merchant totals,
  reorder suggestions), following the cursor. Defaults to `COMPLETED` only: leaving
  the state filter open counts `OPEN` and `CANCELED` orders as revenue and quietly
  inflates every downstream report. The sort field is derived from the date field,
  because Square rejects a search where the two disagree.

  **`SquareConfig.retry`** — opt-in transient-failure retry with `Retry-After`
  support and jittered exponential backoff, for unattended paths (cron sync, queue
  consumers). **Off by default**, so existing callers are unchanged. Retries 429 and
  5xx only — a 400/401 is our bug and will stay wrong. Retrying POSTs is safe here
  precisely because every mutating endpoint already takes an `idempotency_key`.

  `mapCatalogItem`'s return value gains fields (additive; only exact-equality
  assertions are affected).

- 977a2de: Square hosted checkout links, a QR encoder, and two silent-failure fixes.

  **`louise-toolkit/commerce/square`** — `createPaymentLink` / `retrievePaymentLink` /
  `deletePaymentLink` over `/v2/online-checkout/payment-links`, plus the `sqDelete`
  helper they need. Prefer the `order` form over `quickPay`: it is the only one that
  carries a `referenceId` onto the resulting Order, which is how an in-person sale
  stays attributable — the reference survives into the merchant's own Square
  dashboard and the Transactions export. Its line items may be ad-hoc, so a site can
  sell from its own catalog without mirroring anything into Square first. The
  alternative rail (`commerce/square-web`) mounts a card field only; a hosted link
  gets Apple Pay / Google Pay / Cash App Pay from a config flag, which is what a
  shopper standing in a shop with a phone actually wants. Order line-item
  serialization is now shared with `createOrder` so the two cannot drift.

  **`louise-toolkit/qr`** — a new subpath: a vendored ISO/IEC 18004 byte-mode
  encoder (`encodeQr`) and SVG rendering (`qrSvg`, `qrDataUri`). Vendored rather
  than depended on because the package ships with zero runtime dependencies and QR
  is a frozen spec — the same call already made for hand-rolled SVG in
  `core/browser/og-card.ts`. Byte mode only: the payloads are URLs, so alphanumeric
  mode could never apply. Full 8-mask penalty evaluation (fixing a mask produces
  codes some scanners refuse), a 4-module quiet zone by default, and dark modules
  emitted as ONE run-merged `<path>` rather than a rect per module — roughly 4x
  smaller, which is what keeps a code inlineable. Pure string generation, no
  bindings, so a QR route works with every commerce secret still a placeholder.
  Hand `qrSvg()` to `core/browser/resvg.ts` for a PNG.

  **`astroidjs` — `SQUARE_ENVIRONMENT` was withheld from invoicing-only sites.**
  Both Square vars were gated on `usesCardCheckout` (storefront === `"square"`), but
  `SQUARE_ENVIRONMENT` selects the API host for _every_ Square call and
  `SquareConfig.environment` defaults to `"sandbox"`. A project running
  `{ storefront: "fourthwall", invoicing: "square" }` therefore got no var and
  created every **production** invoice against the sandbox — no error, no warning.
  The two vars are now gated separately: `SQUARE_APP_ID` for the browser card field,
  `SQUARE_ENVIRONMENT` whenever Square holds any role. Same fix in
  `generateAstroidCheckoutEnv`.

  **`astroidjs` — per-provider dormancy gating.** `CommerceStatus.configured` is an
  all-or-nothing `every()`, correct for "is the module ready" and wrong for gating a
  single call site: with Fourthwall live and Square dormant it reads `false`, so
  gating on it would have simulated the _working_ Fourthwall checkout. Adds
  `providerConfigured(status, provider)` and `roleConfigured(status, role)`;
  `ProviderStatus.roles` widens to `CommerceRole[]`. The aggregate is unchanged, so
  this is additive.

## 0.18.0

### Minor Changes

- fc5a156: **`core/email` `sendEmail` degrades gracefully with no binding, instead of throwing.** The "no binding ⇒ loudly simulate, don't throw" safety lived only in astroid's mailer (`sendTransactional`), so a consumer that called the lower-level `sendEmail(env.EMAIL, …)` directly — a hand-rolled contact route — crashed when `env.EMAIL` was absent: a dead form in local dev, and a 500 on a production misconfig. The guard now lives in the primitive.

  `sendEmail(binding, input, options?)` gains a third argument. When `binding` is absent it logs a simulated send and returns `{ simulated: true }` rather than throwing — but only where it's safe: `simulateWhenUnconfigured` defaults to dev-detection (`import.meta.env.DEV` / `NODE_ENV !== "production"`), so a missing binding under `wrangler dev`/`astro dev` keeps the magic-link loop working, while a missing binding in production still throws `LouiseEmailError` unless the caller opts in. The logged body is withheld outside dev (it can carry a single-use sign-in link, and `console.info` is `wrangler tail` + Logpush).

  Additive and backwards-compatible: a real binding still returns `{ messageId }` and still throws on a genuine send failure. The return type widens from `{ messageId: string }` to `{ messageId?: string; simulated?: boolean }`. Astroid's richer `MailerStatus` layer is unchanged — this is the floor, not the ceiling.

## 0.17.1

### Patch Changes

- 73b70ec: client: warn when a section marker has `display: contents`. The on-canvas chrome
  attaches the ring (a box-shadow on the marker) and its toolbar (measured from the
  marker's `getBoundingClientRect`) to the real `[data-louise-section]` element — so
  a site that wraps sections in `display: contents` (to keep the wrapper out of
  layout) gives the marker no box: the ring can't paint and the toolbar mis-places
  to the viewport origin. This was a silent, hard-to-diagnose failure; the chrome now
  emits a one-time `console.warn` naming the cause and the fix (give the marker a real
  box). Behavior is otherwise unchanged.

## 0.17.0

### Minor Changes

- feat(commerce/square): detailed catalog extraction. Add `listCatalogDetailed`
  (items + per-item category refs, `reporting_category`, and enabled modifier-list
  bounds), `listCategories` (REGULAR categories, MENU_CATEGORY filtered), and
  `listModifierLists`, plus the `SquareCategory` / `SquareModifier` /
  `SquareModifierList` / `ItemModifierRef` / `DetailedCatalog` types. Additive —
  the existing `listCatalogItems` is unchanged, so current consumers are unaffected.

## 0.16.0

### Minor Changes

- f4c33d8: Gate the generated `/api/checkout` route to same-origin, so the one public POST that moves money has the CSRF protection every other public write already had.

  Serving a scaffolded storefront turned this up: a cross-origin, correct-price POST to `/api/checkout` returned 200 and processed (re-priced, and in a provisioned store would charge), while the contact form (`formRoute`) and the vitals beacon both refuse a cross-origin POST with a 403. Checkout — the only endpoint that takes a card — was the only ungated one. The single-use Square card token limits the practical CSRF risk, but the inconsistency is real and a money-moving endpoint should not be reachable cross-origin, if only to stop cross-origin price-probing and rate-budget abuse.

  The generated checkout route now calls `isSameOrigin(request)` first — before parsing the body, re-pricing, or charging — and returns 403 on a cross-origin (or header-stripped) request. `isSameOrigin` is now re-exported from `louise-toolkit/security` (it already lived in `auth/guard`, where the editor gates use it) so a commerce route can import the CSRF check without pulling in the whole auth barrel. Verified served: cross-origin → 403, header-stripped → 403, same-origin → passes (the contact form still 201s, unaffected).

  The route is scaffold-once, so if you deliberately serve checkout from another origin, the gate is one line to relax — it's yours.

- 6d99c52: Wire edge caching for published pages — shipped wrapped, and shipped off.

  The generated worker now wraps Astro's SSR fallback in `withEdgeCache`, Louise's cookie-aware Worker Cache API layer (ADR 0004), with `bypass: isEditRequest`. The scaffold gets the `cacheCloudflare()` provider, a page-level opt-in on the home route, and an `ASTROID_EDGE_CACHE` var that defaults to `"false"`.

  **The default is the safe state, not merely the off state.** With the var off every render calls `Astro.cache.set(false)` → `no-store` → `withEdgeCache` stores nothing and is a transparent pass-through. Wrapping unconditionally is therefore inert; the wrap only becomes live when a page emits a cacheable directive, which requires both the var _and_ a request that isn't in edit mode.

  Why this layer rather than Cloudflare's automatic edge cache: the automatic one is keyed by URL and runs **before** the Worker, so it cannot see the edit cookie and will serve a cached public page — drafts and inline-edit hooks and all — to a signed-in editor. `withEdgeCache` runs inside the Worker, decides cacheability after inspecting the request, and strips the CDN directive from every response so the automatic cache never engages. That distinction is what got this feature reverted twice, and it is why activation stays gated on the preview-deploy runbook in `docs/adr/0004-edge-caching.md`: `caches.default` is not cleared by Cloudflare Dev Mode or "Purge Everything", so a bad production flip is hard to walk back.

  **`louise-toolkit` gains `isEditRequest` and `LOUISE_EDIT_COOKIE`** (from `louise-toolkit/worker`). The edit-cookie predicate was hand-rolled in the reference site, and Astroid would have hand-rolled it a second time — against a cookie name that lives as a default inside `createLouiseMiddleware`. Now the middleware that _sets_ the cookie and the predicate that _looks for_ it read one constant, so they cannot drift. Drift there is not a cosmetic bug: it means an editor served a cached public page, which is precisely the failure this layer exists to prevent and the hardest one to notice. The predicate matches at a cookie-name boundary, so `x_louise_edit=1` can't false-positive into a permanent cache bypass.

- cad8084: Add the portal concept (#249): a second, fully isolated auth boundary for customers/members, a declarative route guard, and the chrome to hang an account area on.

  coracle and ghostfire **independently** arrived at the same design — two Better Auth instances on one origin and one D1 — which is what makes it worth owning. The studio instance keeps Better Auth's defaults (`/api/auth`, unprefixed tables) because the Louise editor client hardcodes them, so the portal is the one that moves: `/api/portal-auth`, a `portal` cookie prefix, and `portal_*` tables. Those three are fixed by Astroid rather than configurable, because getting any of them wrong means two instances fighting over one origin's cookies — a failure that is intermittent, looks like a session bug rather than a config one, and only shows up once both are in use.

  **The guard is a table, not a call.** `routes` maps a path prefix to the roles allowed through, matched first-wins. Declarative because a guard you have to remember to write in each page is a guard someone eventually forgets, and the page that forgets is the one that leaks. Three answers, each chosen for what it does to the caller:

  - signed out + HTML → redirect to login carrying `next`
  - signed out + `/api/*` → **401 JSON**, never a redirect: redirecting `fetch()` to an HTML login page returns 200 and a page of markup, which client code reads as success and then fails somewhere far less obvious
  - wrong role + HTML → bounce to the area this user _does_ have, not back to login, which would claim their credentials failed when they worked fine

  Prefix matching is on a segment boundary, so `/portal` guards `/portal/orders` but not the public `/portalling`.

  **One session lookup per request.** The middleware resolves it to gate, and the handler that runs next resolves it to know who's asking — two D1 round-trips on every authenticated request otherwise. `resolvePortalSession` shares the in-flight _promise_ via a `WeakMap` keyed on the `Request`, so entries disappear with the request rather than needing eviction.

  `requireCustomer` adds what a session alone doesn't: a same-origin check on mutations. The cookie proves identity, the origin proves intent — a browser attaches that cookie to a request a third-party page triggered too. It's checked _before_ the session lookup, so a cross-origin attempt costs nothing.

  `PortalShell` + `definePortalNav()` ship the chrome: theme-tokened (daisyUI tokens, restyled via the theme rather than a fork), role-filtered before render so an unreachable item is never drawn as a dead link, and the mobile menu is a `<details>` element — no island, no hydration wait, and keyboard/Escape behaviour from the browser.

  `louise-toolkit` gains the mechanism this needs: `basePath` and `cookiePrefix` on `LouiseAuthConfig` (a second instance is impossible without them), `disableSignUp` / `sendResetPassword` / `revokeSessionsOnPasswordReset` for a credential portal, and a `guard` hook on `createLouiseMiddleware` that runs after `extend` populates locals and **outside** its try/catch — a guard exists to refuse, so an error inside it must fail closed rather than be swallowed into "render the protected page".

  `create-astroid --portal` scaffolds the instance, its mounted catch-all, the `App.Locals` type, and a second prefixed auth migration. That migration matters: without it a portal scaffold looks complete, type-checks, builds, and fails on the first sign-in with a missing table — so it's emitted on both the generated and the fallback path.

  Verified in a clean room: a `--portal` scaffold type-checks with 0 errors, builds, and its two auth table sets are fully disjoint (`user`/`session`/… vs `portal_user`/`portal_session`/…).

- b54e39f: Generate the composed worker entrypoint and the verify→enqueue→consume webhook pipeline (#251).

  All three consuming sites hand-write the same `worker.ts`: Astro's SSR `fetch` composed with a queue consumer and a cron re-sync. ghostfire's even documents where the `queue`/`scheduled` handlers "would" go. Configure `commerce` (or set `queues.enabled`) and Astroid emits it — plus, in the scaffold, a provider webhook receiver and a consumer seam. `npm create astroid --commerce square|stripe|fourthwall` wires the whole thing.

  **Ordering, in `handleWebhook`.** The HMAC is verified over the **raw body before anything parses it**. Not style: parsing first lets an unauthenticated caller reach the JSON parser and everything downstream of it, and re-serializing a parsed body to check the signature is how signature checks quietly stop checking anything.

  **Status codes as backpressure.** Every provider retries on non-2xx, which makes the response the only signal available — return the wrong one and you either lose the event permanently or pin the provider in a retry loop. Unprovisioned secret → **503** (dormant is temporary; events delivered before you set the secret still land). Bad signature → **401**, terminal, because it won't verify on retry and retrying turns a misconfiguration into a self-inflicted flood. Unparseable body → **400**, same reasoning. Enqueue failure → **503**, since the signature checked out and the event is worth keeping. Success → **202**, not 200: accepted, not done.

  **Consumer dispatch.** `astroidQueueHandler` covers what every site wrote: a periodic refresh re-syncs, a webhook re-syncs only if it touched the catalog, everything else acks as a no-op. That last case is the load-bearing one — order and payment events arrive in volume and have nothing local to update, so treating them as actionable turns a busy sales day into a refresh storm. Catalog matching is by event-type prefix per provider, since the cost of one redundant refresh is far below that of a storefront serving a price that no longer exists.

  The cron **enqueues** rather than running inline, so the safety net takes the same retry + DLQ path as everything else. `wrangler.jsonc` gains the producer, consumer, DLQ, and cron trigger — in the scaffold-once path, so provisioned ids are never clobbered — and `astroid deploy` now creates the queues.

  `composeWorker` in `louise-toolkit` gains a queue-message type parameter (`composeWorker<Env, QMessage>`), so a consumer receives a typed `MessageBatch` instead of casting every body. Purely additive — the parameter defaults to `unknown`.

  ### Fixes found by type-checking and building a real scaffold
  - `QueueProducer.send` was typed `Promise<void>`; Cloudflare's `Queue.send` resolves to a `QueueSendResponse`, so the real binding **wasn't assignable**.
  - `astroidSecurity` returned `directives: string[]`, but Astro's `security.csp.directives` is a union of template-literal types — so every scaffold running `astro check` saw an error. Astroid now mirrors that union, which additionally makes a typo like `"img-srcs 'self'"` a compile error inside astroid.
  - The generated `onSubmit` returned delivery results into a `void | Promise<void>` slot.
  - The scaffold typed `EMAIL` as workers-types' `SendEmail` — the **legacy** `cloudflare:email` binding, which routes through Email Routing and only delivers to _verified_ addresses — rather than the toolkit's `EmailSender` object-form API.
  - The scaffold never declared `prosekit`, `@prosekit/pm`, or `@tanstack/solid-query`, all of which `louise-toolkit/client` imports. In-workspace they resolve from the hoisted tree, so this only surfaces where it matters: a real `npm create astroid` install, where `astro build` failed on `defineBasicExtension is not exported`.

  Verified in a true clean room (packed tarballs, installed outside the workspace): `astro check` reports 0 errors, `astro build` completes, and against a live `wrangler dev` the receiver answers 503 while dormant, 202 for a correctly-signed event, and 401 for a tampered or absent signature.

- 0a93ce6: Add a drizzle-free `louise-toolkit/content/sections` entry, and split the content validator so importing the structured-sections validators no longer drags in `drizzle-orm`.

  `content/validation.ts` imported `drizzle-orm` (`and`/`eq`/`ne`) as real values for its uniqueness/reference query path. Because ESM is eager, anything importing it pulled drizzle in — and `content/sections.ts` (`validateSections`/`assertValidSections`/`sanitizeSectionsRichText`) imported `validateValue` from it, so the section validators couldn't be used without the optional `drizzle-orm` peer installed. That's the same class of bug `content/define` was carved out to fix.

  The pure Rule engine (the `Rule` builder, `validateValue`, and the synchronous check evaluation) now lives in a new drizzle-free `content/rule.ts`; `validation.ts` keeps only the document-level `validateDocument`/`assertValid` and the two DB-backed checks, injecting them into the shared evaluator, and re-exports the pure API so `louise-toolkit/content` is unchanged. `content/sections.ts` imports the pure engine directly and is exposed at the new `louise-toolkit/content/sections` subpath, so a consumer can validate a page's `sections` without installing drizzle.

  With that entry in place, Astroid's `pages` collection (`astroidPagesCollection`) now imports `assertValidSections`/`sanitizeSectionsRichText` **statically** from `louise-toolkit/content/sections` in its `beforeChange` hook, replacing the dynamic `import("louise-toolkit/content")` it needed to keep create-astroid's schema-generation graph off the optional `drizzle-orm` peer — the seam that entry was built to remove.

- b93d6d1: Add the **dormant-until-provisioned** secret convention (#252): a feature whose secrets aren't set up yet should be _off_, not _broken_.

  **`louise-toolkit/security` gains `readSecret(source, options?)`** — the mechanism. It returns `null` for every flavour of "not really configured": the binding is absent, the Secrets Store isn't provisioned (a declared-but-unset binding _throws_ on `.get()`), the value is empty, or it still holds a placeholder sentinel the caller names. Values are trimmed before the sentinel compare, so whitespace can't smuggle one through. There is no built-in sentinel — the placeholder is the caller's convention, not the package's. `louise-toolkit/auth`'s Turnstile gate, which hand-rolled exactly this read, now sits on it.

  **`astroidjs` gains the convention over it**: `ASTROID_SECRET_PLACEHOLDER` (`DUMMY_REPLACE_ME`), `readModuleSecret`, `resolveModuleSecrets`, and `describeModuleStatus`. `resolveModuleSecrets` collapses a module's whole secret set into one `configured` gate plus the list of what's still missing, so a module's `isConfigured()` and its "why not" message come from the same read. Partial provisioning counts as dormant — a half-configured integration fails mid-checkout rather than at boot, which is the failure this exists to prevent. The upshot is that a fresh `npm create astroid` clone builds and runs with zero external accounts, and the scaffold now ships one worked example: Turnstile captcha, seeded with the sentinel secret plus Cloudflare's always-passing test site key, enforcing only once _both_ halves are real.

  Two type widenings fall out, both `minor` because code that reads these off a `LouiseEnv`/`LouiseAuthEnv` as a binding must now narrow:

  - `SESSION_SECRET` is `SecretBinding | string` — `getSessionSecret` reads either shape, so a site picks whichever it provisioned rather than the one Louise happened to name. It also takes an optional `placeholder`, and fails closed on a deployed host when the secret is still one. Without that, a scaffold that seeds placeholders everywhere could reach production signing sessions with a publicly-known constant.
  - `TURNSTILE_SECRET` is optional. Captcha was always opt-in; requiring the binding to _declare_ it was a type-level lie.

  **The modules now actually use it.** The helpers above were the mechanism; on their own they left every module deciding dormancy by hand, which is the drift the convention exists to remove. Each opt-in module now declares its secrets in one place and derives its gate from that declaration:

  - **`commerce`** gains `COMMERCE_PROVIDER_SECRETS` — per provider, the API credentials its `louise-toolkit/commerce/*` client needs and the webhook signing secret its receiver verifies with, kept separate because they're provisioned separately (a brand-new integration normally has one and not the other). `resolveCommerceStatus` reads them into a per-provider, per-role gate; `commerceSecretNames` is the flat list. Square requires `SQUARE_LOCATION_ID` alongside the access token deliberately: orders and payments refuse a request without one, so a token alone leaves checkout _broken_ rather than dormant. Dormant commerce still serves — the D1 mirror returns whatever it last synced, the webhook receiver answers 503 so the provider retries instead of dropping events, and nothing calls upstream with a placeholder.
  - **`email`** gains `resolveMailerStatus` / `resolveMailer`, replacing two ad-hoc `!binding` / `!from` checks. Both halves are required for the same reason: a binding with no sender can't build an envelope, and a sender with no binding has nothing to send through. A placeholder `MAIL_FROM` now counts as unconfigured rather than being handed to the Email API as an envelope. `AstroidMailEnv.MAIL_FROM` widens from `string` to `SecretSource` so a Secrets Store binding works there too.
  - **`astroidModuleStatus` / `describeAstroidStatus`** compose every enabled module's gate into one report, and `astroidSecretNames` is the single declaration the scaffold seeds, the `env.d.ts` types, and the runtime gate all read — so they cannot drift.

  **Dormant is fine; dormant and silent is not.** `astroid doctor` now reports which modules will run simulated locally and names the unset secrets. It is scoped to secrets read from `.dev.vars`: doctor is a static CLI and can't see runtime bindings, so claiming "email is dormant" would report its own blindness as the project's state. A dormant module is never an error — a fresh scaffold is _expected_ to report everything dormant.

  `create-astroid` seeds every module secret its config implies into `.env.example` with the sentinel, plus a one-line "where to get this" per provider, and `wrangler.jsonc` lists the names to provision (as comments — a committed file never carries a value, not even a placeholder). The point of seeding rather than omitting: the binding set is _complete_, so each module takes its dormant path deliberately instead of tripping over an undefined binding.

  Fixed while wiring this: `queues/scaffold.ts` carried its own copy of each provider's webhook-secret name, so renaming one left the generated receiver reading a binding that no longer existed. It now reads the shared declaration, with a test pinning the two together.

  Also adds a vitest suite to `packages/astroid` (it had none), wired into CI and `pnpm test`.

- ff5ab79: Add `select` — a closed-choice `SectionField` type (#272).

  `_settings` and `_layout` store **tokens** the site maps to CSS (ADR 0005 §5), and a token set is closed by definition. But `SectionFieldType` had no way to say "one of these", so a four-value setting like a colorway had to be declared as `text`. Three things followed from that, all bad: the inspector rendered a free-text box for a picker's job, the valid values could only be documented in `placeholder`, and a typo was **not a validation error at all** — it degraded silently at render time, where the site fell back to a default and quietly produced the wrong design.

  The asymmetry is what makes it a gap rather than a decision: `_layout` already worked this way. `validateLayout` rejects a token that isn't a declared layout. Settings and regular fields simply had no equivalent.

  `SectionField` now takes `options: { value, label? }[]` plus an opaque `display` hint (`"swatch"`, passed through untouched like `SectionDef.icon` — the schema layer has no business knowing what a swatch looks like). The validator rejects a value outside the set with a message naming what was expected, mirroring `validateLayout`'s shape. Absent stays a no-op, and empty string means _cleared_ — the picker's blank option, which hands the choice back to the component's own default.

  On the client, the inspector's field group and its settings rail each carried their own nested `<Show>` ladder for text-vs-textarea, so a third shape would have meant a third level of nesting in both. They now share one `ScalarField`, and a new field type is added once.

  Astroid's `SECTION_SETTINGS` declares `colorway`/`align` as `select`, with options **derived from `COLORWAY_CLASS` / `ALIGN_CLASS`** — so the set a picker offers and the set the site can actually render are the same list by construction, and adding a colorway stays one edit instead of an edit plus a remembered second edit that would otherwise offer a token nothing maps.

- 5b227b5: Sanitize `richText` inside `array` item fields.

  `sanitizeSectionsRichText` walked one level — section fields and block fields — and its own docstring stated the assumption: _"Array item fields are not recursed — richText is a top-level section/block field."_ But `SectionField` lets an `array` declare a richText item field, and a catalog promptly did: Astroid's `faq.items[].answer` is richText, rendered with `set:html`. An editor's FAQ answer was therefore stored exactly as typed and served to every visitor, leaving CSP as the only defence for a value the write path was supposed to have scrubbed.

  `sanitizeItemRichText` now recurses through `itemFields` at any depth. Non-object rows and non-array values pass through untouched, and non-richText siblings are still left alone — sanitizing them would corrupt legitimate text containing angle brackets.

  The rule this restores: anything the schema can express, the write-time sanitizer has to cover. A validator that accepts a shape the sanitizer skips is a hole by construction.

### Patch Changes

- 1ac694c: Enforce the section catalog on every `pages` write path, and answer a rejected write with a 422 instead of a 500.

  Two write paths reach a page's `sections`, and only one of them validated. `versionsRoute` takes the collection `config` and runs its `beforeChange` hook — sanitize, then validate against the catalog. `pagesRoute` takes no config and runs no hook, so a direct `POST` / `PATCH /api/louise/pages/:id` — the path the on-canvas _structural_ edits go through — persisted an unknown section `_type`, a `_settings` token outside its declared options, or unsanitized section rich text. `<Sections>` then skipped the bad `_type` at render time, so the section silently vanished with no error anywhere; the rich text (`faq.items[].answer` is `richText`, rendered with `set:html`) reached the public page with CSP as the only remaining defence. The generated worker even carried a comment claiming "every route below inherits" the validation — it didn't.

  Astroid now derives the same sanitize + validate from the collection config and wires it into `pagesRoute`'s `sanitize` / `transform` / `validate` seams via a new `astroidPagesWriteHooks(config)`, spread into the generated route. Both write paths now enforce one contract, from one source — the collection's `beforeChange` hook is refactored to share the exact primitives (`sanitizeAstroidPageSections`, `assertAstroidPageSections`), so they cannot drift.

  Separately, `versionsRoute` returned a raw **500** when the collection hook rejected a draft: `applySaveDraft` only translated a `LouiseValidationError` thrown by its own `validate` option into a 422, while the identical error thrown from inside `api.saveDraft`'s hook escaped uncaught. It leaked at two call sites — the `POST /:id/versions` save, and the buffer flush at the start of `POST /:id/publish` (a coalesced auto-save that the KV write-buffer answered 200 without validating is validated for the first time there). Both now catch a `LouiseValidationError` from the hook and return the same 422 with per-field violations; a non-validation throw (a real DB fault) still propagates as a 500, honestly. The invalid content was always kept off the live page — this is about giving the editor the violations instead of a 500.

  Found by serving a scaffolded site on `wrangler dev` and exercising the routes over HTTP — none of it was visible to the unit suites, `astro check`, or `astroid doctor`. The four behaviours are asserted served in CI's scaffold live-smoke leg, and the `pagesRoute` wiring + the shared sanitize/validate are unit-tested in `astroidjs`.

- d3fd13d: Use pnpm consistently in every documented command. The repo pins pnpm via `packageManager` and its own scripts already used it, but the published READMEs, the `create-astroid` help text, and the `astroid` CLI banner still told users to run `npm` — including `npm run doctor` in `create-astroid`'s README while the template README it scaffolds said `pnpm doctor`.

  Install lines become `pnpm add`, one-off binaries become `pnpm exec`, and `npm create astroid` becomes `pnpm create astroid` (which also drops npm's `--` argument separator, since pnpm forwards flags directly).

  References to npm _the registry_ are left alone — "shipped to npm", "the npm package", "not an npm dependency" are all still accurate, and rewriting them would make them wrong.

## 0.15.0

### Minor Changes

- 6c6064b: Add `louise-toolkit/content/define` — the drizzle-free half of the content module: `defineCollection` plus the collection/field types and the `flattenFields`/`flattenDoc`/`nestDoc` helpers.

  The `content` barrel re-exports the whole module, and three of its members import `drizzle-orm` as real values: `codegen` (builds Drizzle tables), `localApi` (builds queries), and `validation` (uniqueness queries). Those imports are legitimate, but ESM is eager — so a caller that only wanted `defineCollection` still had to resolve `drizzle-orm` at import time. Because `drizzle-orm` is an _optional_ peer, that quietly required consumers to install a package they never asked for, and it shipped a broken `npm create astroid` to npm: Astroid's config generators call `defineCollection` and nothing else, and the CLI died on `Cannot find package 'drizzle-orm'` before writing a file.

  Import from `content/define` when you're describing content (config, codegen tools, meta-frameworks); import from `content` when you're also reading or writing it. The barrel still exports everything, so this is a narrower door onto the same rooms, not a second source of truth — nothing is deprecated and nothing breaks. Verified: the built `content/define` entry resolves to four chunks with **zero** external dependencies, while the barrel still pulls `drizzle-orm`.

## 0.14.0

### Minor Changes

- c182412: Wire the Workers AI editorial assists (#75) into the editor UI (#166) — the interactive half of the inline assists, completing #75.

  - **Rich-text toolbar "rewrite" control** (`client/RichText.tsx`): a sparkle menu (Tighten / Rephrase / Simplify / Fix) that POSTs the current selection to `/api/louise/ai/rewrite` and swaps in the result. Enabled only over a real selection; a model hiccup (502) leaves the original text untouched.
  - **SEO "Suggest" button in the Pages panel** (`client/settings/pages-panel.tsx`): POSTs the page's title + body text to `/api/louise/ai/seo` and pre-fills the SEO title/description for review — set as dirty edits, never auto-committed, so the owner still presses Save.
  - New `sparkle` icon (the four-point AI affordance).

  Both controls are opt-in and degrade gracefully: the moment a call returns 503 (the `AI` binding isn't provisioned) the control retires itself, consistent with the `core/ai` ethos. The server helpers + `aiRoute` already shipped (#150/#151/#154); a host mounts `aiRoute` to enable them.

- 56821bc: Route the Workers AI helpers through [AI Gateway](https://developers.cloudflare.com/ai-gateway/) (#87) — response caching, cost caps / rate limiting, provider fallback, retries, and request logging in front of every call, without changing the module's contract.

  - New `AiGatewayOptions` (`{ id, cacheKey?, cacheTtl?, skipCache? }`) — a `gateway?` option on `generateAltText` / `rewriteText` / `suggestSeo` (and their `AltTextOptions` / `RewriteOptions` / `SeoOptions`), threaded to Workers AI's `run` as `options.gateway`.
  - `aiRoute` gains a `gateway?: (env) => AiGatewayOptions | undefined` accessor for the rewrite/SEO calls; the media route's alt text picks it up via `altTextOptions.gateway`.

  Gateway caching already keys on the full request (model + inputs), so identical calls dedupe automatically — `cacheKey` is only for deliberately widening a cache entry. Omit `gateway` and calls go direct; the gateway is purely additive. See the new `guide/ai-assists.md` for setup (creating a gateway, cost caps, and fallback).

- 6fa4f98: Extend `louise-toolkit/ai` with text assists and expose them over HTTP via a new `aiRoute` (#75). The editor client can't call `env.AI` directly (server-only binding), so rewrite/SEO round-trip through the Worker.

  - **`rewriteText(runner, text, { mode })`** — tighten / rephrase / simplify / fix a passage. Best-effort (null on absent binding, blank input, or model error), with model preamble/quotes stripped from the result.
  - **`suggestSeo(runner, content)`** — an SEO title (≤60) + meta description (≤155) parsed from the model's JSON reply (tolerant of prose/code-fence wrapping), length-capped, missing fields → null.
  - **`aiRoute({ resolveEditor, ai })`** — editor-guarded route:
    - `POST /api/louise/ai/rewrite` `{ text, mode? }` → `{ text }`
    - `POST /api/louise/ai/seo` `{ content }` → `{ title, description }`
    - Opt-in + degrade: `ai: (env) => env.AI`; when it returns `undefined` the route answers `503` so the client can hide the assist. Each call is a same-origin, session-guarded mutation (it spends AI budget).

  This is the tested server foundation both remaining #75 consumers call — the ProseKit rewrite toolbar and the settings SEO panel — which land as follow-up client PRs.

- 0039440: Editor Actions (`louiseSaveAction` / `louiseSaveDraftAction` / `louiseSettingsAction`) now require an injected `getEnv` and no longer default to `locals.runtime.env`.

  Astro v6+ removed `Astro.locals.runtime.env`, so the old default (`ctx.locals.runtime?.env`) resolved to `undefined` under the library's own supported peer (`astro ^7`) — every consumer relying on it 500-ed ("Astro.locals.runtime.env has been removed in Astro v6"). Rather than have the library reach for `cloudflare:workers` itself (the core primitives take their bindings by dependency injection — the library never imports the CF runtime as a value), `getEnv` is now a required dep. Inject the Worker env explicitly, the same way the site reads its bindings:

  ```ts
  import { env } from "cloudflare:workers";
  import { louiseSaveAction } from "louise-toolkit/astro";

  louiseSaveAction({ collections, ActionError, getEnv: () => env });
  ```

  A missing `getEnv` is now a compile error (it's a required field) and, for untyped callers, throws a clear error at action-construction time instead of a per-request 500. `getEditor` still defaults to `locals.editor`, and `EditorActionContext` no longer carries `locals.runtime` since the toolkit doesn't read it.

- 3146ec8: Add `louiseSaveAction` — the editor `save` mutation (#72) as an Astro Action: a typed, Zod-validated server function so a site calls `actions.louise.save(...)` and gets end-to-end types + automatic input validation, instead of hand-building a `fetch("/api/louise/save")` JSON body and re-parsing it server-side.

  `louise-toolkit/astro` now exports `louiseSaveAction(config)`, which returns the `{ input, handler }` a site drops into `defineAction`. Because `defineAction`/`ActionError` live in Astro's virtual `astro:actions` module (only resolvable inside an Astro app), the toolkit ships the ingredients and the site assembles the action — mirroring `createLouiseMiddleware` — taking the `ActionError` class by injection so the handler still throws framework-correct 400/401/404.

  ```ts
  // site: src/actions/index.ts
  import { defineAction, ActionError } from "astro:actions";
  import { louiseSaveAction } from "louise-toolkit/astro";

  export const server = {
    louise: {
      save: defineAction(louiseSaveAction({ collections, ActionError })),
    },
  };
  ```

  The store path is shared with the raw `saveRoute` via a new pure `applyFieldSave` (allowlist + sanitize + D1 write), so a field is validated once per adapter and written in exactly one place — no double-parsing. CSRF stays with Astro's built-in same-origin guard for Action POSTs; the adapter ports only the editor-session (auth) check. The raw `/api/louise/save` route is unchanged and remains the fallback for non-Astro consumers and the keepalive auto-save client.

- afe5ba1: Add `louiseSaveDraftAction` — the editor `saveDraft` mutation (#72) as an Astro Action, completing the editor-mutation Action surface alongside `louiseSaveAction` and `louiseSettingsAction`. A site calls `actions.louise.saveDraft({ id, data })` to stage a versioned-page draft; the input bundles the row `id` with the changed fields (an Action call has no URL to carry the id).

  The store path is shared with the raw `versionsRoute` (POST `/:id/versions`) via a new pure `applySaveDraft` — the concurrent-surface merge base (KV buffer → newest pending draft → live row) and the #70 KV write-buffer — so the draft-merge logic lives in one place. `VersionsRouteConfig` now extends a `SaveDraftDeps` base that the Action config also extends. The handler returns the route's JSON body (a created `version`, or `{ buffered: true }` when a write is coalesced). The raw route is unchanged and remains the fallback for the keepalive auto-save client.

- c39466b: Add `louiseSettingsAction` — the editor `settings` mutation (#72) as an Astro Action, mirroring `louiseSaveAction`: a site drops `defineAction(louiseSettingsAction({ ...settingsConfig, ActionError }))` into `src/actions/index.ts` and calls `actions.louise.settings(patch)` with a typed, Zod-validated patch object.

  The store path is shared with the raw `settingsRoute` via a new pure `applySettingsPatch` (media-strictness on image keys, base-column vs `custom` partition, singleton write) — so a patch is validated once per adapter and merged/written in exactly one place. The handler returns the `ignored` (non-allowlisted) keys, and the shared editor-Action plumbing (`EditorActionDeps`, injected `ActionError`, `locals.editor` auth guard, injected `getEnv` binding resolution) is now factored so further editor Actions follow the same shape. The raw `/api/louise/settings` route is unchanged.

- c6052d3: Close out the remaining pre-publish audit findings — security hardening, cache/read efficiency, and the last accessibility gaps.

  **Security.** `editorsRoute`'s "can't remove the last editor" guard counted every row in the user table; on a site that also stores customers there (email/password auth shares Better Auth's table) that over-counts, letting the final admin delete themselves and lock everyone out. It now counts `role = 'admin'` — the same test the magic-link allowlist uses. The edit-mode cookie is now `secure` over https (still not a control — the session is re-verified every request — but no reason to ship it plaintext-only).

  **Efficiency.** `applySaveDraft` read the full version list from D1 on _every_ autosave tick and then discarded it whenever a KV write-buffer existed. The buffer read now comes first and gates that query, so a burst of edits stops paying for a version list per debounce tick (the live-row lookup stays — the 404 check needs it). Separately, the edge cache keyed on the raw URL, so `?utm_source=…` and friends minted a fresh entry per campaign link — exactly the traffic burst a cache should absorb. The new `edgeCacheKeyUrl` strips known tracking params and sorts the rest; only the _key_ is normalized, so a page that reads its own query string is unaffected.

  **Accessibility.** `role="toolbar"` on the edit bar and the formatting bubble now actually implements arrow-key roving (←/→, Home/End) instead of just advertising it. Icon-only controls get a deliberate `:focus-visible` ring rather than relying on the UA default against coloured fills. The dashboard summary is a real `<h2>`, so the `<h3>` cards below it no longer skip a heading level.

  **Docs that were wrong.** `theme/fonts.css` now warns that its inlined face makes the stylesheet render-blocking and is meant for editor surfaces, not public pages. `semanticSearch` documents that it's the one path sending _visitor_ text to Workers AI. The `grammar` option documents Harper's ~10MB WASM download. The `louise-dark` theme documents that it does not restyle the injected editor chrome.

- 9f5ac5d: Add multi-editor tenancy to `louise-toolkit/auth` via the Better Auth organization plugin (#100) — multiple editors/roles per organization and a path to multi-tenant hosting, gated by the same generated-never-hand-rolled schema contract as the rest of auth.

  - **`LouiseAuthConfig.organizations`** (`{ teams?, allowUserToCreateOrganization? }`) enables the `organization` plugin in the request-scoped factory. When set, its `organization`/`member`/`invitation` tables (plus `team`/`teamMember` with `teams`) are namespaced under `tablePrefix` alongside user/session, so the runtime queries exactly the tables the generator emits.
  - **`AuthSchemaConfig.organizations`** (`{ teams? }`) threads the same plugin into `authSchemaOptions`, so `generateAuthSchemaSql` (and `louise gen-auth-schema`) emit the org tables + the `activeOrganizationId`/`activeTeamId` session columns, FKs resolving to the prefixed targets. Only `teams` affects the schema; the runtime-only knob is omitted. Mirror this on the CLI config whenever `LouiseAuthConfig.organizations` is set.
  - **`resolveOrgEditor(auth, db, request, { organizationId, editorRoles?, tablePrefix? })`** — a second editor-access axis beside the global admin allowlist: it returns an `OrgEditorSession` when the signed-in user holds an editor role (`owner`/`admin` by default, `DEFAULT_ORG_EDITOR_ROLES`) in the given org, else `null`. Membership is read from the Better Auth `member` table over D1 (no version-specific server API), so it drops straight into `editorsRoute`/`guardEditor` as a `resolveEditor`. The site decides which org a request maps to — the sole org for a single site, or per-hostname for multi-tenant hosting.
  - **`activeOrganizationId(auth, request)`** — convenience reader for the session's active organization (single-site case).
  - **Member-invitation email** — set `organizations.renderInvitationEmail` (mirrors `renderMagicLinkEmail`) to turn on invite emails: the factory builds the accept `url` from the invitation id + `acceptInvitationPath` (default `/organization/accept-invitation`), renders with the site's branding, and sends over the `EMAIL` binding; dev logs the link. Omit it and invitations are still created and acceptable through the API. The URL builder is exported as `invitationAcceptUrl` (Better Auth hands back only the invitation id, so the app constructs the link).

  Enabling `organizations` is additive and opt-in: a single-editor site is unchanged, and a newly-invited org member gets the global role `user` while their edit rights come from membership — the two access tiers coexist.

- 698e230: `mountLouise` can route the inline auto-save through typed Astro Actions, with a keepalive escape hatch for the unload path (#138, completing #72). Pass `actions: { save, saveDraft }` — the site injects `actions.louise.save` / `actions.louise.saveDraft` (which it can import from `astro:actions`; this framework-agnostic client can't). The **normal debounced** save then calls the Action; the **unload** flush (tab-hide / page-hide / `beforeunload`) still uses the raw `keepalive` fetch, since Astro's action client can't set `keepalive` and a save fired mid-navigation would be dropped.

  Fully backward compatible: omit `actions` and every save stays on the raw `/api/louise/*` routes exactly as before. Each injected callable must resolve on success and reject on failure (the site wraps the action's `{ data, error }`).

  Scoped to the inline field + inline versioned-draft surfaces. The sections dock and the reference-site wiring follow separately (the dock surfaces per-field validation detail the Action adapter doesn't carry yet).

- 077b323: Blocks can now be **added** in place (#182 Phase 3 / ADR 0005 §4). The on-canvas block toolbar gains a `+` (add block after) button, and `mountSections` takes an optional `blocks` (`BlockCatalog`) so the editor knows a section's block palette. Adding a block inserts a blank of the section's allowed type, re-renders the whole section through the fragment route (blocks render inside their section's bespoke component, not standalone), swaps the section element in place, re-stamps + re-wires it, and stages a draft — no reload. New `replaceSectionElement(index, el)` in `louise-toolkit/client` swaps a re-rendered section in place. The `+` and the `blocks` catalog are both opt-in: without them the block toolbar stays move + delete only (the Phase 2 behaviour), and a multi-type block picker is a later slice (single-`allow` sections add their one type).
- aa020ca: On-canvas **block chrome** — the block-layer half of the editing chrome (#182 Phase 2 / ADR 0005 §3–4). `client/chrome.ts` now reads the `data-louise-block="<i>.blocks.<j>"` marker alongside the section marker and draws a second, **blue** ring + toolbar over the hovered block. Hit-testing is **deepest-boundary-wins**: a hover inside a block lights the block and clears its parent section, so exactly one layer rings at a time — the ADR's `:has()` suppression done in JS (no `:has()` dependency, fully unit-testable). New readers: `parseBlockMarker`, `readBlockMarkers`, `blockRefOf` (+ `BlockRef` / `MarkedBlock`). `mountSectionChrome` gains an optional `blocks` action set (`BlockChromeActions`, keyed by `BlockRef`); omitting it keeps the Phase 1 section-only behaviour. Instant within-section block ops mirror the section ops: `moveBlockElement` / `deleteBlockElement` reorder/remove already-rendered blocks and re-stamp the survivors, and `restampSection` now also re-stamps a moved section's nested block markers so a section reorder keeps its blocks' `<i>` aligned. Reader/renderer half only — the editor wires the block callbacks to its store + autosave once a section renders blocks (the reference slice).
- 47df5c4: Bundle the brand font instead of fetching it from Google Fonts. Roboto Flex (the
  `wght` axis, latin subset) is now base64-inlined into `theme/fonts.css` and baked
  into the editor chrome bundle (`client/styles.ts` pulls it in with `?raw`, like
  the Phosphor icons) — so Louise surfaces make **no third-party font request** and
  work offline / under strict CSP.

  The `@import url("https://fonts.googleapis.com/…")` in `theme/fonts.css` and the
  runtime Google Fonts `<link>` + `preconnect`s in `injectStyles()` are gone.

  **Migration:** if you set a strict `font-src` in your CSP, allow `data:` (the
  inlined `@font-face` uses a `data:` URL). You no longer need `https://fonts.googleapis.com`
  in `style-src` or `https://fonts.gstatic.com` in `font-src` for the brand type.

- 15ed27c: Schema-validate commerce webhook payloads and add structured-output parsing (#97, #99).

  - `louise-toolkit/schema`: new `s.array(item, { min, max })` builder primitive (element issues re-path under their index, mirroring `s.object`), plus `parseJson`, `extractJson`, and `parseModelJson` — validate a raw JSON string against a schema without throwing, and pull the first balanced JSON object/array out of LLM prose (respecting strings/escapes) instead of slicing on the first/last brace. Malformed JSON and shape mismatches both come back as violations, so callers keep one graceful-degrade branch.
  - `louise-toolkit/commerce`: new `parseWebhookEvent(schema, rawBody)` — run it **after** `verify…Signature` to prove the payload's shape (the HMAC only proves the sender). Each provider module exports its event envelope schema: `stripeWebhookEventSchema`, `squareWebhookEventSchema`, and `fourthwallOrderEventSchema`. The Fourthwall order-body aliases stay tolerant in `mapFourthwallOrder` (a strict inner schema would drop a live order on shape drift).

- 4d2de4c: Astro Content Layer loader — expose Louise D1 collections through native `getCollection()` (#92).

  - New `louise-toolkit/astro` exports: `louiseLoader({ collection, read, idOf?, name? })` returns an Astro Content Layer `Loader`, and `collectionToAstroSchema(collection)` derives a Zod schema straight from a `defineCollection`'s fields (text/select/number/date/checkbox/relationship/group → typed; richText/array/json pass through; `hasMany` relationships and bookkeeping columns dropped). Register it with Astro's `defineCollection({ loader })` and read published content via `getCollection`/`getEntry`, typed from the collection's own fields — no hand-written schema.
  - Content Layer loaders run at **build time** (in Node, off any Worker binding), so — like `defineCatalogLoader` — the D1 read is injected: a site supplies `read()` (typically the D1 REST API at build, or a snapshot). The result is a build-time snapshot of published content (rebuild on publish to refresh); for request-time freshness, keep reading D1 in an SSR page. The loader owns schema mapping, store population, content digests for incremental builds, and fail-safe error handling (a read failure keeps the last good store rather than emptying the collection).

  Site: `workers/site` gains an example — `src/content.config.ts` registers a `publishedPages` collection via `louiseLoader(pagesCollection, readPublishedPages)`, with a D1 REST read (`src/lib/louise/published-pages.ts`) gated on `CF_ACCOUNT_ID` / `CF_D1_DATABASE_ID` / `CF_API_TOKEN` (unset → the collection builds empty).

- aa0f70d: Add `louise-toolkit/ai` — optional Workers AI editorial assists (#75), starting with AI alt text on image upload. A new, catalog-agnostic `AiRunner` contract (`run(model, inputs)` — `env.AI` satisfies it directly, no cast) plus best-effort helpers that **degrade gracefully**: with no binding, or on any model error, they return `null` and never throw, so a save/upload/publish is never blocked by AI.

  - `runAi(runner, model, inputs)` — run a model best-effort (null when absent or on error).
  - `generateAltText(runner, imageBytes, opts)` — concise alt text for an image, tidied (whitespace-collapsed, "an image of…" lead-ins stripped, sentence-cased, length-capped).

  The media route gains an opt-in `altText` accessor that fills each upload's `alt` from the image — off by default (no upload latency or cost unless wired), mirroring the `deferReindex`/`bufferKv` pattern:

  ```ts
  mediaRoute({
    table: media,
    resolveEditor,
    altText: (env) => env.AI, // opt in; needs the `ai` binding in wrangler.jsonc
  });
  ```

  The model id is passed as a string (not pinned to a workers-types model catalog), leaving room to route `run` through AI Gateway later (#87). This is the foundation for the rest of #75 (rewrite toolbar, SEO suggestions) and the AI cluster (#86/#106/#107).

- a89ad95: `createLouiseMiddleware` now auto-allows `data:` fonts in the response CSP, so
  the bundled brand font (an inlined `data:` `@font-face`) works under a strict
  `font-src` with **no consumer change** — resolving the migration note from the
  font-bundling change. It adds `data:` to an existing `font-src` (idempotent), or
  derives one from `default-src` when none is set; it's a no-op without a CSP
  header or when `data:` fonts are already allowed.

  Also exported as `allowCspDataFonts(response)` from `louise-toolkit/security`
  for sites that assemble their own middleware.

- 10519f3: Add the Core Web Vitals piece of the site-health co-pilot (#106) on Cloudflare Analytics Engine — owned, cookieless, real-visitor performance, surfaced as a plain "Fast / Slow" badge in the Health panel.

  New `louise-toolkit/analytics` module:
  - **`cwvBeaconScript(opts)`** — a self-contained, dependency-free JS beacon to inline on public pages. Observes LCP, CLS, and (approximate) INP via `PerformanceObserver` and reports each once, on `visibilitychange`, via `sendBeacon`. Cookieless; optional `sampleRate`.
  - **`vitalsRoute`** — the public `POST /api/louise/vitals` ingestion route: **same-origin only** (a cross-origin `Origin` is refused), validates the payload, and writes an Analytics Engine data point (metric as index, page as blob, value as double). Always `204`; a malformed payload or unprovisioned dataset is accepted-and-dropped, so it's cleanly optional.
  - **Query + summary** — `cwvSqlQuery(dataset, sinceHours)` builds the AE SQL for the p75 of each metric (sampling-aware via `quantileWeighted`/`_sample_interval`); `parseCwvRows` + `summarizeCwv` reduce it to a `CwvSummary` (per-metric p75 + an overall rating = the worst present metric, per Google's thresholds), or `"none"` when there's no field data.
  - `HealthSummary` gains an optional `cwv` slice, and the Health panel renders a **Performance** section — a "Fast / Could be faster / Slow" badge plus plain-language Loading / Responsiveness / Visual-stability figures, or "not measured yet" until data arrives.

  This is the library layer (fully unit-tested); wiring it on a site — inlining the beacon, binding an Analytics Engine dataset, mounting `vitalsRoute`, and folding the p75 into the scheduled health scan — is a per-site step (deploy-only verifiable).

- 8509d15: Add a D1 Sessions API seam so draft resume is read-your-writes even behind [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) (#69). With replication on, a resume read (loading the latest draft after an auto-save) can land on a replica that hasn't caught up to the write — "my edit vanished." The Sessions API closes that gap, and the toolkit now wires it end to end.

  `louise-toolkit/db` gains the seam: `db()` now accepts a `D1Database` **or** a `D1DatabaseSession` (Drizzle only calls `prepare`/`batch`, both of which a session implements), plus `openD1Session(DB, constraint)`, `d1Bookmark(client)`, and the bookmark-cookie helpers `D1_BOOKMARK_COOKIE` / `readD1Bookmark` / `serializeD1BookmarkCookie`. All of it feature-detects `withSession` and degrades to the raw binding when the runtime predates the Sessions API — so behaviour on an un-replicated D1 is unchanged and the seam is safe to ship before you flip replication on.

  The draft-save path (`applySaveDraft`, shared by the raw `versionsRoute` POST and the `louiseSaveDraft` Action) now runs through a `first-primary` session and persists the session bookmark in an HttpOnly `louise_d1_bookmark` cookie. The resume read anchors a session at that cookie and threads it through the draft query, so the write is always visible. The cookie round-trips automatically across the same-origin auto-save POST and the next top-level edit-mode navigation — no client code. Writes always target the primary, so only the read path changes; public view-mode renders stay session-free and cacheable.

  ```ts
  // Edit-mode resume, anchored at the last auto-save's bookmark.
  import { resumeReadSession } from "./lib/louise/drafts.js";
  const resume = resumeReadSession(env.DB, Astro.cookies);
  const draft = await latestDraftSections(resume.client, home.id, env.DRAFTS);
  resume.commit(); // persist the advanced bookmark
  ```

  See `guide/drafts.md` for the how-to, including the REST call to enable replication (`PUT /accounts/{id}/d1/database/{id}` with `{"read_replication":{"mode":"auto"}}`).

- a6a9a2c: Add a shell-owned **action footer** to the Louise Settings drawer (#109) — a persistent, context-driven bar so save / cancel / publish / delete are always visible instead of scattered inline and scrolled off.

  - New `client/settings/panel-actions.tsx`: `PanelActionsProvider` (a push/pop **stack**, so the deepest active view owns the footer and restores the parent's actions on unmount), `usePanelActions().push(actions, status?)`, `DrawerFooter`, and the `PanelAction` / `SaveStatus` / `ActionKind` types — all exported from `louise-toolkit/client/settings`.
  - The shell wraps the drawer body + footer in the provider and installs **Cmd/Ctrl+S → the active frame's primary action**. Buttons are dirty-aware (disabled when unchanged), show a `busyLabel` ("Saving…") while an async `onClick` is pending, and auto-saving surfaces can push a **status pill** instead of buttons. The footer collapses when the active view has neither actions nor a status.
  - The framework panels migrate their inline actions into the footer, removing the duplicated inline buttons:
    - **Settings** — Save/Revert (Save dirty-gated; Revert restores the last-loaded snapshot; the pill carries the saved/error result). Sign-out stays in the body.
    - **Pages** — the per-page settings form's Save (dirty-gated) + Delete. The list keeps its inline "+ New page"; the footer collapses on the list.
    - **Media** — the per-asset alt/caption editor's Save/Cancel. Editing is now single-open (one asset at a time) so the footer stack has one unambiguous top; the card's Copy/Alt/Delete stay inline.

  Framework panels are always mounted inside the shell (via `mountSettings`), which now provides the footer context; a site-registered collection tab can push its own footer actions with `usePanelActions`.

- ab52389: Drop the routine save-status text from the sections edit bar. With auto-save on
  (the default), drafts stage on a debounce and flush on navigation, so the
  "Saving… / Draft saved / Unsaved / Draft" line is redundant noise — the bar now
  shows **History + Publish** only. A _failed_ save still surfaces (red, error-only),
  since it must never be silent and the Publish button doesn't report it. The
  manual Save-draft button is unchanged for hosts that opt out with `autoSave: false`.
- a929ac1: Make the editor operable without a mouse, closing the two blocking accessibility gaps in the on-canvas chrome and the overlays.

  **Structural editing is now keyboard-reachable (WCAG 2.1.1).** The section/block chrome only ever appeared on `mouseover`, so its move / delete / ⚙-inspect actions — and the non-inline fields (image, link URL, layout, `_settings`) that live behind the gear — were unreachable by keyboard. Marked regions are now tab-stops that reveal their toolbar on focus, with `Enter`/`F2` to step into it, `←`/`→` to rove its buttons, `Escape` to step back out, and `Alt+↑`/`Alt+↓` to reorder plus `Delete`/`Backspace` to remove directly. Structural keys only fire when the region itself holds focus, so they never interfere with typing in a field. The affordances are additive — Louise sets `tabindex`/`aria-keyshortcuts` only where the author hasn't, never overwriting a section's own `role`/`aria-label`, and removes exactly what it added on dispose. The toolbars are proper `role="toolbar"`s and their glyph buttons carry real accessible names ("Move up", not "↑").

  **Overlays now manage focus (WCAG 2.4.3 / 2.1.2 / 4.1.2).** The Settings drawer, the version-history drawer, and the inspector popover moved no focus on open, could be tabbed straight out of into the page behind, and had no Escape. A new shared `wireDialogA11y` helper marks each `aria-modal`, moves focus in, wraps Tab at both edges, closes on Escape, and restores focus to whatever opened it — with collapsed `<details>` groups correctly excluded from the tab ring. Their decorative scrims are now `aria-hidden`.

- 9cd8395: Second accessibility pass over the editor — names, semantics, alt text, and contrast.

  **Inline images can carry alt text, and no longer lose it (WCAG 1.1.1).** ProseKit's image node ships only `src`/`width`/`height` and serializes exactly those, so an image placed in rich text reached the published page with no description — and any authored `alt=` was silently dropped the first time the field round-tripped through the editor. The image node now has an `alt` attribute that both serializes to `<img alt>` and parses back, plus an on-image control to write it (the badge reads "Alt?" in amber until a description is set). The sanitizer already allowed `alt` on `img`, so it persists end to end.

  **Inline editables and inputs have accessible names (WCAG 1.3.1 / 3.3.2 / 4.1.2).** Inline `contenteditable` fields announced only as "edit text" — their sole hint was CSS `::before` content, which is not an accessible name. They now carry `role="textbox"`, `aria-multiline` where applicable, and a name taken from the field's own label. Placeholder-only inputs (invite first/last/email, link label + URL, image URL, Pages search) gained real labels, and the media-library thumbnails — buttons with no text and only a `title` — now have proper names.

  **Popup menus tell the truth and dismiss (WCAG 4.1.2 / 2.1.1).** The add-section palette, block-add menu, AI rewrite menu, and colour swatches all declared `role="menu"`/`menuitem`, promising arrow-key roving that was never implemented. They're now labelled button groups — honest semantics for what they are, plain buttons in the tab order — with `aria-haspopup`/`aria-expanded`/`aria-controls` on every trigger, and Escape or an outside press to dismiss (Escape returns focus to the trigger).

  **Contrast now clears AA (WCAG 1.4.3).** Measured and fixed: success green on white 3.30:1 → 5.02:1, slate-400 body text 2.56:1 → 4.76:1, empty-field placeholder 2.22:1 → 4.69:1, and the white glyphs on the on-canvas toolbars 3.02:1 → 5.02:1 (section) and 3.88:1 → 5.08:1 (block). The section/block rings keep their brand colours — they're non-text graphics and already clear the 3:1 bar; only the bars carrying white labels darkened. Primary buttons move one stop down the existing brand ramp (3.88:1 → 4.68:1), to a blue that was already the button's own hover.

- 355915d: The sections editor now wires the **block layer** into the on-canvas chrome (#182 Phase 2 / ADR 0005 §4). `mountSections` passes block actions to `mountSectionChrome`, and two new store ops — reorder and delete a section's blocks — reconcile `state.items[i].blocks` and mirror the change on the already-rendered page (via `moveBlockElement` / `deleteBlockElement`), then stage a draft via autosave. This is the block analogue of the instant section reorder/delete: no server round-trip, and a section's block markers stay aligned. Block **add / swap-type** still need the fragment-render route (Phase 3). Fully additive — a section with no `blocks` renders and edits exactly as before.
- ce8f8a6: Add `formToAstroSchema` — the forms counterpart to `collectionToAstroSchema` (#92) — so a `defineForm` definition drops straight into an Astro Action's `input`.

  `louise-toolkit/astro` now exports `formToAstroSchema(form)`, which maps a form's fields to a Zod schema: `email`/`url` carry their format check, `number`/`date` coerce, `checkbox` normalizes to a boolean (accepts `true`/`1`/`"true"`/`"on"`), `select` options double as the allowlist, and `required` drives optional-vs-required (required string-likes must be non-empty). Like the collection bridge it lives in the `astro` subpath and pulls Zod from `astro/zod`, so the framework-agnostic core takes no Zod dependency.

  This closes the gap where form Actions took raw `FormData` + a hand-written interface + manual coercion: the form is the single source of truth, and the client infers the input type for free.

  ```ts
  export const server = {
    inquiry: defineAction({
      input: formToAstroSchema(inquiryForm),
      handler: async (input) => {
        /* input is typed + validated */
      },
    }),
  };
  ```

- 037054f: Structural **add** is now instant — no more save-and-reload (#182 Phase 3 / ADR 0005 §4). "+ Add section" optimistically splices the new item into the store, POSTs it to a per-item **fragment-render route**, and inserts the returned server-rendered HTML in place (re-stamped to the target index, inline fields wired), then stages a draft via autosave. New `insertSectionElement(el, index, container)` in `louise-toolkit/client` places a fragment among the marked sections and re-stamps them 0…n (the add analogue of the reorder/delete DOM ops). The editor still authors **zero markup** — the server owns rendering.

  **Consuming sites opt in** by providing the fragment route: an editor-gated Astro **partial** (`export const partial = true`) that reads a POSTed `{ item }`, forces edit mode, and renders `<Sections sections={[item]} />` — the toolkit POSTs to `/louise-fragment`. Sites without it degrade gracefully: the add falls back to the previous save-and-reload, so nothing breaks. (workers/site ships the reference route.)

- baf6b62: Add an opt-in spelling **and grammar** checker to the rich-text editor (#110), powered by [Harper](https://writewithharper.com) — Automattic's Rust→WASM checker — running **entirely on-device in a Web Worker**. Issues are underlined inline; clicking one opens a popover to apply a suggestion.

  Pivoted from the issue's original self-hosted-LanguageTool design: Harper needs no service to deploy or provision, and the text **never leaves the browser** (a stronger privacy story than a self-hosted checker), while adding a second Rust/WASM module after the resvg OG renderer (#85).

  Enable it per surface — off by default:

  ```ts
  mountLouise({ /* … */, grammar: true });        // inline rich-text fields
  // or on the component:  <RichText grammar />    //  and mountRichText(el, onChange, doc, { grammar: true })
  ```

  `harper.js` is an **optional peer dependency**, loaded via dynamic `import()` only when `grammar` is enabled — so its multi-MB WASM never ships to sites that don't use it (the `binaryInlined` build also avoids a separate `.wasm` fetch). Scope: rich-text prose fields, English only for now (Harper's current limit). Multiline plain-text fields and other languages are follow-ups.

- 42bd2b9: Add the one-click AI fix to the site-health co-pilot (#106 Phase 2b) — generate missing image alt text with Workers AI, straight from the Health panel.

  - **`POST /api/louise/media/generate-alt`** — a new action on `mediaRoute` that backfills `alt` for images missing it: it selects the missing-alt rows (optionally a single `{ key }`), fetches each object from R2, runs `generateAltText`, and writes the result. Capped per call at `DEFAULT_ALT_FIX_BATCH` (12, override with `MediaRouteConfig.altFixBatch`) so a large library can't exhaust the Worker's subrequest/AI budget — the client re-runs until the count is zero. Editor-guarded mutation; **503** when no `altText` runner is wired (the client hides the assist). Reuses the same `altText` / `altTextOptions` config the upload path already uses, so a site that enabled AI alt on upload gets the backfill for free.
  - **`HealthPanel`** — the "Image descriptions" row now offers **"Fix with AI"** (busy → "Fixing…") beside "Review in Media". On success it refreshes the health, overview, and media queries so counts update live; a 503 swaps the button for a "not set up — add them by hand" note.

  Non-image assets, registry rows whose R2 object is gone, and empty model output are skipped (left for a manual fix), never failing the batch. SEO auto-fix (`suggestSeo` in place) and CWV/RUM remain future work.

- b29f520: Add the one-click AI **SEO** fix to the site-health co-pilot (#106 Phase 2c) — generate an SEO title/description for published pages missing them, from the Health panel. Completes the "one-click fix where AI can" pair (alt + SEO).

  - **`seoFixRoute`** (`core/editor/seo-fix.ts`) — `POST /api/louise/pages/generate-seo` (editor-only). Selects published pages with an SEO gap (or a single `{ id }`), feeds each page's HTML-stripped content to `suggestSeo`, and writes back — **only the missing field(s)**, never overwriting an existing title or description. Capped per call at `DEFAULT_SEO_FIX_BATCH` (8; `batch` overrides); **503** when no AI runner is wired; a page with empty content or no model output is skipped, not failed. Mount before `pagesRoute` (like `searchRoute`) so its `/:id` matcher doesn't claim `/generate-seo`.
  - **`HealthPanel`** — the alt and SEO rows now share one `AiFixSection` + `createFixer`: each shows **"Fix with AI"** (busy → "Fixing…") beside a manual "Review in …" link, refreshes the affected counts on success, and hides the assist on a 503.
  - Wired on louisetoolkit.com: `worker.ts` mounts `seoFixRoute({ table: pages, resolveEditor, ai: (env) => env.AI })`.

  SEO generation itself is deploy-verified (Workers AI is server-only). Optional CWV/RUM remains the last, non-blocking thread of #106.

- 1faa88a: Add the site-health co-pilot data layer (#106) — a new `louise-toolkit/health` module that composes Louise's existing primitives into one persisted, owner-facing health snapshot the Home dashboard's Health card (#108) reads.

  - **`HealthSummary`** — `{ brokenLinks, missingAlt, seoGaps, checkedAt, brokenLinkDetails? }`, shape-compatible with `overview.health` so a stored summary can be returned from the overview route directly.
  - **`summarizeHealth(input)`** — assembles the snapshot from a scan's parts: exact counts, a capped sample of broken-link details (`MAX_BROKEN_LINK_DETAILS`), and the scan timestamp (injectable `now`). Bad counts are guarded to non-negative integers.
  - **`readHealthSummary` / `writeHealthSummary`** — persist the snapshot in KV via a structural `HealthKV` interface (the real `KVNamespace` fits, no Workers-types dependency). A corrupt blob reads back as `null` rather than throwing. `healthIssueCount` sums the categories.

  Why a persisted snapshot: broken-link checking is a crawl (seconds, network) that belongs on a Cron Trigger, so its result must be stored for the dashboard to read cheaply; the alt/SEO gap counts are cheap COUNTs a site computes at scan time. The Health card stays hidden until the first scan writes a summary.

  Wired end-to-end on louisetoolkit.com: the cron `scheduled()` handler now runs a health scan (broken links + media missing alt + published pages with SEO gaps) and persists it, and the `overview.health` slice reads it back — lighting up the dashboard's Health card. The scan orchestration lives in the site (it owns the exact COUNTs); the toolkit ships the reusable summary + persistence primitive.

- 8497b55: Add the site-health detail panel (#106 Phase 2) — the drill-in behind the Home dashboard's Health card, so the owner can see _what_ is wrong, not just a count.

  - **`HealthPanel`** (`client/settings/dashboard/health-panel.tsx`) — reads the full persisted `HealthSummary` from `/api/louise/health` and lists the broken links (URL · status · the page they're on, capped with an "…and N more"), plus alt/SEO gap counts each with a jump to the surface that fixes them (Media for image descriptions, Pages for SEO). Handles the not-yet-scanned and all-clear states. It's a **hidden framework panel**: reachable from the Health card's "Review" action, not a top-strip button.
  - **`healthRoute`** (`core/editor/health.ts`) — `GET /api/louise/health` (editor-only), config-driven `read(env)`; returns `{ summary }` with `summary: null` (a 200, not a 404) until the first scan runs, so the panel shows a "not checked yet" state.
  - The dashboard **Health card's "Review"** now opens the health drill-in (`open({ panel: "health" })`); new `dashboard.healthEndpoint` config overrides the endpoint.

  Wired on louisetoolkit.com: `worker.ts` mounts `healthRoute` reading the persisted summary (`readHealthSummary(env.RL)`). Exported `HealthPanel` from `louise-toolkit/client/settings`.

  Still to come (Phase 2b): one-click AI fixes — generating alt text (`generateAltText`) and SEO meta (`suggestSeo`) in place — which need per-item detail in the summary + fix endpoints, and optional CWV/RUM.

- 60e690f: Adopt the Cloudflare **Images binding** in `louise-toolkit/media` for server-side transforms and `.info()`-based dimensions, and retire the `sharp` dependency from the sites. (#84)

  - `LouiseMediaEnv` / `MediaRouteEnv` gain an **optional** `IMAGES` binding. When present, uploads read intrinsic dimensions via `IMAGES.info()` — which sizes AVIF and TIFF, the two formats the header parser (`imageDimensions`) can only sniff, not measure. Absent → the header parser is used, so nothing regresses.
  - `imageInfo(images, bytes)` — read dimensions through the binding (returns `null` for SVG or on any Images error, so callers can fall back).
  - `transformImage(images, input, opts)` — server-side re-encode/resize/crop that returns a `Response` of the encoded bytes. This cashes the long-standing "future Images-binding backend" seam in `transform.ts`. For public on-the-fly derivatives, prefer the zero-cost URL rewrite (`cfImage`) — reach for this when you need the transformed _bytes_.
  - `putMedia` accepts an optional `images` binding and the editor `mediaRoute` passes `env.IMAGES` through automatically.

  Site/docs: declare `"images": { "binding": "IMAGES" }`, drop the direct `sharp` dependency (the Cloudflare adapter externalizes sharp and uses its workerd image service; docs use `passthroughImageService`), and disallow sharp's native postinstall in the pnpm workspace (`sharp: false`) since it now only arrives as an inert optional dep of `astro`.

- 60e033f: Rich-text format bubble + brand colours (#182 Phase 5). The inline editor's
  formatting toolbar is now a floating **selection bubble** (ProseKit
  `InlinePopover`) that appears over highlighted text, instead of a caret-following
  focus dock. It gains an inline **link** control, and the text-colour swatches are
  now **brand tokens** rather than fixed hex: applying one stores
  `color: var(--color-<token>)`, so the colour resolves to the _site's own_ daisyUI
  theme (primary / secondary / accent / neutral / info / success / warning / error)
  and a re-theme flows through with no content rewrite. The sanitizer accepts
  `color: var(--color-*)` on the mark's `<span>`.
- b950812: The **inspector popover** — the contextual editor for a section's layout + settings (#182 Phase 4 / ADR 0005 §5). The on-canvas chrome toolbar gains a ⚙ (wired via a new optional `onInspect` on the section/block chrome actions) that opens a small popover anchored to the selected element: a **layout picker** (sections with declared `layouts`) and a **settings form** (each `settings` field, reusing the dock's inputs). Picking a layout / committing a setting updates the store (`_layout` / `_settings`) and re-renders the section through the fragment route (the same seam as block add / swap-type), then autosaves — so the change shows on the real design with no reload. Blocks get the settings half (no layouts). Opt-in and additive: no `onInspect`/`layouts`/`settings` → no ⚙, unchanged behaviour. Outline-tree navigation and migrating the dock's per-item forms onto the rail are later refinements.
- 1c4a8f9: Section **reorder and delete are now instant** (#182 Phase 1 / ADR 0005 §4). Moving a section up/down or deleting it (from the on-canvas toolbar or the dock) reconciles the store and mirrors the change on the already-rendered DOM — relocating/removing the marked section element and re-stamping the `data-louise-section` **and** `data-louise-sfield` markers — then stages a draft via autosave. No more save-and-reload round-trip for these ops, and inline editing stays aligned across a reorder (`wireInline` now re-reads the marker rather than closing over it). New `chrome.ts` helpers: `restampSection`, `moveSectionElement`, `deleteSectionElement`. Add / array-item structural ops still reload for now — they need markup that doesn't exist yet (the Phase 3 fragment-render route).
- dd2187a: Add a Workers KV write-buffer for auto-save to coalesce high-frequency draft writes (#70) — a burst of edits no longer hits D1 with a version row per debounce tick.

  - New `louise-toolkit/editor` draft-buffer primitives: `draftBufferKey`, `readDraftBuffer` / `writeDraftBuffer` / `clearDraftBuffer` (with a self-expiry TTL), and `shouldFlushBuffer`. The buffer holds the freshest working-draft snapshot per page; the consistency model is deliberately simple — the buffer is only ever ahead of or equal to the D1 draft and is cleared on publish, so "the freshest pending draft" is `buffer ?? D1 draft`.
  - `versionsRoute` gains an opt-in `bufferKv?: (env) => DraftBufferKV | undefined` (+ `bufferFlushMs`, default 10s). When set: each auto-save `POST …/versions` updates the KV buffer and only flushes to D1 on the first write of a session, every `bufferFlushMs`, and on publish (which flushes the freshest work, publishes it, then clears the buffer). Discarding a draft clears the buffer too. Unset → every draft writes straight to D1, unchanged.

  Resume reads should prefer the buffer (it holds edits not yet flushed) — feed `readDraftBuffer` into your draft-render path. KV is eventually consistent and caps ~1 sustained write/sec per key, so it's a scratch buffer; D1 stays authoritative.

  Site: bind a `DRAFTS` KV namespace, enable `bufferKv` on the pages collection, and make the draft-render helpers (`latestDraftBody` / `latestDraftSections`) consult the buffer first. Provision `wrangler kv namespace create DRAFTS` before deploying.

- 38b8b81: `createLouiseMiddleware`'s `rateLimit.kv` now also accepts a getter (`() => RateLimitBackend | undefined`), resolved per request only for a matched surface. Astro middleware is constructed at module scope, but `cloudflare:workers` `env` bindings are only valid in request scope (the same reason editor Actions take `getEnv: () => env`) — a getter lets a site pass `kv: () => env.RL` without reading the binding at module-eval, which would otherwise crash on load. A getter that yields a falsy backend (e.g. the KV namespace isn't provisioned yet) skips rate-limiting — fail open, consistent with `rateLimit`. Passing a plain `RateLimitBackend` is unchanged.
- de43f53: Rate limiter: optional Cloudflare native Rate Limiting binding, with the KV counter retained as fallback (#89).

  - `louise-toolkit/security` `rateLimit(backend, key, limit, windowSec)` now accepts either a KV binding (as before) or Cloudflare's native Rate Limiting binding — a new `RateLimitBackend = KVLike | RateLimiterBinding` union, dispatched on the binding shape. The native path is in-colo (no KV round-trip) and cheaper for the hot public abuse-control surfaces (pay/email, form submissions, search). Both paths fail open, so a limiter outage never blocks sign-in or a form.
  - Callers are unchanged: `KVLike` stays assignable, and the `formRoute({ rateLimitKv })` and Astro-middleware `rateLimit.kv` slots widen to `RateLimitBackend` so a site opts into the native binding just by passing it (typically `env.RATE_LIMIT ?? env.KV`).
  - Semantics note for the native path: the budget lives in wrangler config (`ratelimits` binding, `period` capped at 10 or 60s), so `limit`/`windowSec` become **advisory**, `remaining` is best-effort, and `retryAfter` is a bounded upper estimate — not the exact reset the KV path reports. Use it for coarse burst control; keep long-window budgets (e.g. per-day) on KV.

  Sandbox: the hand-rolled per-IP limiter on the `/api/checkout` pay+email endpoint now runs through the shared `rateLimit` primitive — an optional native `RATE_LIMIT` burst guard (20/60s, no provisioning needed) in front of the existing per-day KV budget.

- d351abf: Add a live OG / social-card preview to the pages drawer (#76). As an editor types a page's title / SEO title, `PageForm` now shows the share card they'll get — either the custom Social image (when set) or the auto-generated card, drawn with the same `ogCardSvg` template the site rasterizes for real (#85).

  Because #85 made the OG card a pure SVG, the preview is client-side and instant: the browser rasterizes it natively, so there's no Browser Rendering, no server round-trip, and no debounce. The generated card renders as inline SVG (not a `data:` image) so it never trips the site CSP's `img-src`. The new `OgPreview` component / `ogPreviewContent` helper lives in `louise-toolkit/client`, and `PagesPanel` takes an optional `ogCard?: OgCardOptions` prop so a site can match its real card's brand, colours, footer, and font.

  Version-history thumbnails (the Browser-Rendering half of #76) are tracked separately.

- e668e37: Add an owner **Home / Overview dashboard** as the Louise Settings drawer's default landing (#108) — an at-a-glance "what needs my attention?" surface instead of cold-opening into a CRUD panel.

  - **Card registry** (`client/settings/dashboard/*`), mirroring the shell's tab pattern: `DashboardCard` (`id` / `order` / `render(api)`), a shared `<Card>` (title · status dot · plain-language body · one verb), and `HomePanel` — a traffic-light summary ("Your site is healthy" vs "3 things need your attention") over a responsive card grid. Each card is handed a card-scoped `DashboardApi` (`open` for cross-panel deep-links, `report` for reactive status). Exported from `louise-toolkit/client/settings`.
  - **Built-in Phase-1 cards**, all reading one shared `/api/louise/overview` query (single round-trip): **Content** (drafts + unpublished → Review pages) and **Inbox** (unread → Open inbox) are live; **Health** (broken links / missing alt / SEO) is wired but stays absent until #106 persists the feed. Every card **degrades to hidden** when its slice is missing, so a brochure site's dashboard differs from a shop's with no config.
  - **Server** `overviewRoute` (`core/editor/overview.ts`) — `GET /api/louise/overview` (editor-only), config-driven: the site supplies a resolver per slice (`content` / `inbox` / `health`) so the toolkit assumes no column names; an absent or throwing resolver is omitted rather than 500-ing the dashboard. Mount before `pagesRoute` like `searchRoute`.
  - **Shell:** Home is a new fixed framework panel (leads the top strip) and the **default overlay when the drawer opens**. Owner-facing config: `dashboard?: { cards?, hide? }` to append site cards / hide built-ins, and `home?: false` to restore the old Pages-first landing. A `house` icon was added.

  **Behavior change:** the drawer now opens to Home by default. Sites that haven't wired `overviewRoute` see an empty "Your site is healthy" landing (the cards degrade gracefully); pass `home={false}` to keep opening on Pages / the first tab. Wiring `overviewRoute` with content/inbox counts lights up the live cards.

  The `HomePanel` registers no footer actions, so the drawer footer (#109) collapses on it — validating that panel's empty-slot case.

- a9d61c6: Move FTS reindex off the write path onto Cloudflare Queues (#77) — publish returns as soon as the row is written; the search index syncs asynchronously.

  - `createLocalApi` / `createVersionedLocalApi` accept a `LocalApiOptions.deferReindex` callback. When set, create/update/publish/delete hand the changed row's id to it **instead of** syncing the FTS index inline; unset keeps the inline sync, so nothing changes for callers without a queue.
  - `reindexDoc(db, table, config, id)` — the deferred counterpart: re-reads the row (upsert its index entry, or remove it if the row is gone). Call it from a queue consumer to drain a job. No-op for a collection without `config.search`.
  - `versionsRoute` gains a `deferReindex?: (env) => DeferReindex | undefined` option (given the runtime env so it can reach a queue binding); returning `undefined` falls back to inline sync.
  - `louise-toolkit/queues` adds the `SideEffectJob` message type (an extensible `kind: "reindex"` union) to pair with the existing `enqueue` / `processBatch` primitives.

  Site: bind a `QUEUE` producer + a `queue()` consumer (batches of 10 / 5s, 3 retries, then a dead-letter queue) that drains reindex jobs via `reindexDoc`. Provision `wrangler queues create louisetoolkit-side-effects{,-dlq}` before deploying.

- 14a62c4: Real-time multi-editor client wiring (ADR 0002 / #71, task 4) — the browser half of the per-page edit session, completing #71. Opt-in, versioned pages only, degradation-first.

  - **WS client** (`client/realtime.ts`): `connectRealtime()` — handshake, heartbeat, exponential-backoff reconnect, and trailing-throttled outbound `change` publishing, over the authed `/api/louise/realtime/:slug/:id` route. `connected()` gates the surface between publishing here and its debounced-fetch fallback; a `release` flushes any pending change first so the final ≤throttle of typing isn't dropped. Framework-agnostic and fully unit-tested (fake-socket lifecycle).
  - **Inline surface** (`mountLouise({ realtime })`): presence avatars in the edit bar; publishes field edits over the socket when connected (the DO coalesces + persists — no debounced fetch, no double write); applies a peer's plain-text edits live (skipping a field you're focused in); and soft-locks the rich body — claim on focus, release on blur, with a "locked by X" badge + read-only state when a peer holds it (the server enforces the lock and never broadcasts the body). Publish snapshots the current field values into a fresh draft first, so it promotes the latest even before the DO's alarm fires.
  - **Sections surface** (`mountSections({ realtime })`): presence in the shared bar. Sections persistence stays on the proven debounced-fetch draft path for now — a live canvas sync is a follow-up.
  - Exposes `connectRealtime`, `resolveRealtime`, `RealtimeOption`, `RealtimePeer`, `RealtimeSession`, and the `initials`/`otherPeers` presence helpers.

  Degrades silently: with no `EDIT_SESSION` binding the upgrade 503s, `connected()` stays false, and editing keeps using the debounced-fetch auto-save exactly as before. The site's `LouiseEditIsland` / `SectionsMount` stamp the flag from the collection's `realtime` option.

- 7be2413: Add `louise-toolkit/realtime` — the per-page live-editing Durable Object, PR 1 of ADR 0002 (#71): the **hibernatable-WebSocket skeleton** + the authed upgrade route. Presence only for now (no persistence — that's a later slice).

  - **`createEditSession(ctx)`** — the DO session logic a site's `DurableObject` subclass delegates to. On connect it accepts a _hibernatable_ socket (`ctx.acceptWebSocket`), attaches the editor identity, and broadcasts presence; `hello` → `welcome`, `ping` → `pong`; disconnect re-broadcasts presence to the remaining peers. Presence is rebuilt from `ctx.getWebSockets()` + `serializeAttachment`, so it survives hibernation.
  - **`realtimeRoute({ resolveEditor, namespace })`** — `GET /api/louise/realtime/:slug/:id` (a WebSocket handshake), guarded as a same-origin, session-gated mutation, then forwarded to the per-page DO (`idFromName("<slug>:<id>")`) with the **server-resolved** editor identity (the client never provides its own presence). Returns `503` when the DO binding is absent (realtime cleanly off), `426` for a non-upgrade request.

  Following the `workflows` pattern, the **site owns the `DurableObject` subclass + the wrangler binding** (it imports `cloudflare:workers`); this module ships the logic + route it wires in. Model-runtime WebSocket behavior isn't exercised by the repo's happy-dom harness — the route, session message-handling (fake ctx/sockets), and protocol helpers are unit-tested; the live `acceptWebSocket` hibernation is verified on deploy.

- 8355f96: Real-time multi-editor sessions — change-broadcast protocol + coalesced persistence (ADR 0002 / #71, tasks 2 + 3). The per-page `EditSessionDO` skeleton (#153/#156) grows from a presence handshake into a live editing session: authoritative field state, field-change broadcast, a rich-text soft-lock, and a hibernation-safe alarm that coalesces edits to D1 through the **existing** draft path.

  - **Protocol (`louise-toolkit/realtime`).** Extends the versioned WS envelope with `change {field, value, rev}`, `claim`/`release {field}`, and `bye` (c→s) and `change {field, value, rev, from}`, `ack {rev}`, and `locks` (s→c); `welcome` now carries `{you, peers, snapshot, locks}`. `parseClientMessage` validates the new frames.
  - **Authoritative state in `ctx.storage`.** Field values, the rev counter, held locks, the page target, and the last writer live in Durable Object storage, so they survive hibernation (an in-memory-only map would be lost when the DO sleeps). Presence is still rebuilt from `getWebSockets()` + each socket's attachment; the attachment now carries the full `EditorSession` (email/role never leave the DO — only `{id, name}` is fanned out).
  - **Rich-text soft-lock.** `lockFields` (e.g. `["body"]`) are single-editor: only the lock holder may `change` them and their raw values are never broadcast (peers render them read-only and reload on release), so rich-text never crosses sockets un-sanitized. Other fields are last-writer-wins broadcast.
  - **Coalesced flush = one write path.** `createEditSession(ctx, { fields, lockFields, persist, flushMs })` arms an alarm on the first dirtying edit; the `alarm()` handler hands the coalesced snapshot to a site-injected `persist`. The site wires `persist` to `applySaveDraft` (now re-exported from `louise-toolkit/editor`) with the same `pagesDraftDeps` the fetch auto-save + `saveDraft` Action use — same merge-over-pending-draft, same `${slug}_versions` write, same KV buffer. On failure the snapshot stays dirty and the alarm re-arms.
  - **`realtime` collection flag.** `CollectionConfig.realtime` (sibling to `versions`); `defineCollection` rejects `realtime` without `versions.drafts` (realtime persists as drafts).
  - The upgrade route now stamps the full editor identity (id/name/email/role) so the coalesced draft version is faithfully attributed.

  Off by default and degradation-first: with no `EDIT_SESSION` binding the route 503s and nothing changes. Client wiring (presence UI, subscribe/publish with debounced-fetch fallback, soft-lock UI) lands next (task 4).

- d944ca5: Remove the floating "Page sections" dock (#182) — the sections editor is now
  fully on-canvas. Everything the dock owned relocated:

  - **Per-section editing → the ⚙ inspector.** The inspector popover already held
    layout + settings; it now also edits the section/block's non-inline **fields**
    (link URL, image, token) and its **array membership** (per-variant add, per-item
    variant switcher, remove), so the dock's form is no longer needed.
  - **Reorder / delete → the on-canvas toolbar.** Section and block move-up /
    move-down / delete already live on the hover toolbar (`chrome.ts`); the dock's
    duplicate row controls are gone.
  - **Save / Publish / status / History → the shared edit bar** via
    `.louise-bar-actions` (a fixed fallback strip when no `.louise-bar` exists).
  - **Add section → an on-canvas floating control** (same palette markup).
  - **Version history → a dedicated right-side drawer** opened from the bar's
    History button (reuses the Louise drawer visual family). New `history` icon.

  Net effect: no floating panel, no drag-to-move, no collapse toggle — you edit on
  the real design, with page-level actions on the bar. The store, autosave, inline
  wiring, and structural fragment routes are unchanged.

- 0d0db1f: Sections gain a first-class **block layer** (#182 Phase 2 / ADR 0005 §1). A `SectionItem` can now carry an ordered `blocks?: BlockItem[]` — the organising layer _within_ a section — described by a `BlockCatalog` of `BlockDef`s that mirror `SectionCatalog`/`SectionDef` (block fields reuse `SectionField` verbatim). A section opts in by declaring a `SectionDef.blocks` policy (`allow` bounds the palette; `min`/`max` bound the count); the block palette is passed to the validator via `validateSections`/`assertValidSections`'s new `options.blockCatalog`. The validator's block branch mirrors the section pass one level down: it checks the array shape and count, rejects a block whose `_type` is disallowed by the section or absent from the catalog (like an unknown section `_type`), and validates each block's fields — so a block field that is itself a discriminated `array` still validates for free. Fully additive: `blocks` is optional, storage is unchanged (still one `sections` JSON column), and a section without a `blocks` policy ignores any stray `blocks` key. Note `blocks` is now a **reserved** structural key on `SectionItem` (alongside `_type`) — name a discriminated array _field_ something else. The on-canvas block chrome and a reference-slice conversion are the next slices.
- 8474f38: The sections editor now renders **on-canvas section chrome** (#182 Phase 1). In edit mode, hovering a section (over the `data-louise-section` markers the render stamps) rings it and floats a toolbar to **move it up/down or delete it** — wired to the same structural ops the floating dock uses. New `client/chrome.ts` provides the vanilla, framework-free chrome (`mountSectionChrome`) plus the marker readers (`readSectionMarkers`, `sectionIndexOf`) with deepest-boundary hit-testing. Move/delete still save-and-reload for now; instant DOM ops and retiring the dock follow in later slices.
- 1110318: The sections editor gains a **type-switcher UI** for discriminated array fields (#182 Phase 0, completing the schema/validator from the previous release). When a `SectionField` array declares a `discriminator`, the dock renders one "add" button per variant (labelled/iconed from `variantsAdmin`) and a per-item variant `<select>`. Adding shapes the item as the shared `itemFields` ∪ the chosen variant's fields ∪ the discriminator key; switching preserves the shared field values while swapping in the new variant's blanks — via `reconcile`, so the previous variant's fields are dropped, not left merged on the item. Non-discriminated arrays render exactly as before.
- 7326bb6: Section `array` fields can now be a **discriminated union** of item shapes (#182 Phase 0). A `SectionField` of `type: "array"` accepts an optional `discriminator` — `key` + `variants` + `variantsAdmin` — mirroring `ArrayFieldConfig.discriminator` one level down, so one array field can hold heterogeneous "block" items (e.g. image vs. quote) instead of a single fixed `itemFields` shape. Each item's `key` value selects its variant, whose fields layer on top of the shared `itemFields`. `validateSections`/`assertValidSections` enforce it: an absent or unknown variant is rejected (like an unknown section `_type`), the selected variant's own field rules run, and other variants' fields stay out of scope. Fully additive — `discriminator` is optional and `array` storage is unchanged (still one JSON column). The editor's type-switcher UI is the next slice.
- 4c41ec7: Add a `richText` section-field type — inline-editable prose stored as sanitized
  HTML, edited in place with a **light** ProseKit editor (the format bubble only:
  bold/italic/link/brand-colour — no block handles, headings, lists, or image
  inserter). `RichText`/`mountRichText` gain a `minimal` option for this; the
  section wiring mounts it when a field node carries `data-louise-type="richtext"`
  and persists the field's HTML. New `sanitizeSectionsRichText(sections, catalog,
sanitize, blockCatalog?)` export sanitizes those fields on the write path (call it
  from the collection `beforeChange`, next to the body sanitize) so section HTML is
  never stored raw.
- 46e9af5: Sections and blocks gain **layout + settings** schema (#182 Phase 4 / ADR 0005 §5). `SectionItem` can carry a `_layout` token (one of `SectionDef.layouts`) and a `_settings` object; `BlockItem` carries `_settings` (against `BlockDef.settings`). `SectionDef` declares `layouts` (named variants, picker fodder for the inspector rail) and `settings` (non-inline fields — background, spacing, columns … reusing `SectionField`); `BlockDef` declares `settings`. `validateSections` now checks them: an unknown/undeclared `_layout` is rejected like an unknown `_type`, and `_settings` values validate against the declared setting fields with the same `Rule` machinery (undeclared keys ignored, absent `_settings`/`_layout` a no-op). Louise stores only tokens/values — never CSS; the site component reads `_layout`/`_settings` and owns the styling. Fully additive. The inspector-rail UI and a reference-slice render are the next slices.
- 2824490: Add `louise-toolkit/commerce/square-web` — the browser-side companion to `louise-toolkit/commerce/square`. Previously each site carried its own copy of this loader.

  - `loadSquare(environment)` — inject Square's Web Payments SDK from the squarecdn host (sandbox vs production picked by the same `SQUARE_ENVIRONMENT` the server uses), memoized so concurrent callers share one script load. Allow-list the squarecdn host in the site CSP.
  - `mountCard(appId, locationId, environment, selector)` — attach a Square card input to `selector` and return a `SquareCardHandle` that tokenizes on demand (surfacing Square's error detail) and tears down. The card is tokenized in the browser, so raw PAN never reaches the Worker; the token is what `commerce/square` charges via `/v2/payments`.

  Framework-agnostic (DOM globals only — no Solid dependency), so any island or vanilla checkout can consume it.

- 98ba35a: Add `louise-toolkit/schema`: Standard Schema (https://standardschema.dev) support with a zero-dependency `s.*` builder, a `standardValidate` runner that folds any Standard Schema's result into Louise's `ValidationViolation` shape, and `parseOrThrow`.

  Form fields (`FormField`) and collection fields (`FieldConfig`) now accept a `schema` — any Standard Schema (Zod/Valibot/ArkType or the built-in `s.*` builder) — run in the shared client+server validation pass alongside the existing zero-dep `Rule` engine, which stays the default. Empty values are skipped so optional fields stay optional. (#98)

- 17231d2: Guard the clipboard against stega leaking out of edit mode. In edit/preview mode
  rendered text carries an invisible stega source pointer; copying it would paste
  zero-width characters into other apps. The edit client now installs a `copy`
  handler that strips the payload (via the dependency-free `stegaClean`) — but only
  when one is present, so ordinary copies are untouched.

  New from `louise-toolkit/content`: `mountStegaClipboardGuard(target?)` (idempotent,
  browser-only; auto-mounted by the edit client, call it yourself only if you wire
  visual editing by hand) and the pure `cleanCopiedStega(text, html)` it uses.

- 21796fb: Every in-section structural edit is now instant — the last save-and-reloads are gone (#182 Phase 3 / ADR 0005 §4). The dock's variant **type-switcher** (swap-type), array **item add/remove**, discriminated **variant add**, and **media set** now route through a single `rerenderSection(i)` seam: mutate the store, re-render just that section through the `/louise-fragment` route, and swap its element in place (re-wired, draft staged) — no page reload. Falls back to save-and-reload when the section isn't on the live rendered page or the fragment can't render, so nothing is lost. Only loading a _different_ draft version still reloads (it swaps the whole document). Purely internal to the sections editor — no API change.
- 9c4d0a4: Make the inline-edit client **view-transition-aware** (#74), so a host can enable Astro's `<ClientRouter />` and navigate between pages in edit mode without a full reload — the edit bar, drawer, and sections dock re-init on the new page and no pending edits are lost.

  - **Flush on `astro:before-swap`** — a soft navigation fires none of `pagehide` / `visibilitychange`, so `mountLouise` and `mountSections` now also flush pending auto-saved edits (via the raw keepalive fetch) before the DOM is swapped away. Without this, an in-flight edit would be dropped on navigation.
  - **Re-mount cleanly across swaps** — the `mountLouise` idempotency guard (a runtime `<html>` attribute that survives the swap) is cleared on `astro:after-swap`, and the shared leave/unsaved-guard handlers are wired **once** for the page lifetime rather than per mount, so a re-mount can't stack duplicate `window` listeners.
  - **Settings drawer** — `mountSettings` disposes its Solid root on `astro:before-swap`, so its `window` listeners don't leak (and a stale drawer can't be opened) after a navigation.

  `astro:*` are plain DOM events; in a non-Astro host they never fire, so the client stays framework-agnostic. Enabling the transitions themselves (adding `<ClientRouter />` + prefetch) remains the host's choice.

- 7019d09: Add a resvg/WASM OG-card renderer to `louise-toolkit/browser` — rasterize the share image with a Rust/WASM SVG rasterizer instead of screenshotting HTML in a headless browser, retiring Browser Rendering from the OG hot path (~100x cheaper, no cold start). (#85)

  - `ogCardSvg(title, options?)` — the OG card as an SVG document (brand label, greedily wrapped title, footer on a dark field). Content-equivalent to the old HTML card, so the content-hashed cache key stays stable across the swap. Every colour, the font family, and the dimensions are options; `wrapTitle` is exported for reuse.
  - `createResvgRenderer({ wasm, fonts, defaultFontFamily, width })` — an `OgRenderer` backed by `@resvg/resvg-wasm` (a new **optional** peer, dynamically imported like `@cloudflare/puppeteer`). WASM init is guarded per isolate so a renderer built per request initializes exactly once. The caller supplies the compiled WASM module and font buffers (Workers has no system fonts), so the toolkit stays font-agnostic and ships no binary of its own. Note: resvg's font DB selects a static face by weight — it does not interpolate a variable `wght` axis — so supply distinct 400/600/800 faces under one family name for a bold title.
  - `ogImage`'s option `html` is renamed to `markup` (it now carries SVG as well as HTML). A one-line rename at call sites.

  `createPuppeteerRenderer` stays for genuine full-page work (link-check, live previews). Both renderers satisfy the same `OgRenderer` contract, so `ogImage`'s cache discipline is unchanged.

- 6c72267: Add `withEdgeCache` + `isCacheableDirective` to `louise-toolkit/worker` — a **cookie-aware Worker Cache API layer** for the SSR fallback (#95/#163), so published pages can edge-cache while editor requests always render fresh.

  Because `Cloudflare-CDN-Cache-Control` drives Cloudflare's _automatic_ edge cache — which is keyed by URL and runs before the Worker, so it's cookie-blind — a page cached for an anonymous visitor was served to a logged-in editor (the #163/#165 reverts). `withEdgeCache` caches in `caches.default` instead: the Worker runs on every request, reads/writes the cache only for non-bypassed public GETs, and keeps two invariants so `caches.default` is the _only_ cache that ever holds a page:

  - strips `Cloudflare-CDN-Cache-Control` from every response (CF's cookie-blind auto edge cache never engages);
  - sends the client `Cache-Control: no-store` for any page it caches (the stored copy keeps the directive for its TTL), so no browser, CF edge, proxy, or leftover "Cache Everything" Cache Rule can shared-cache the HTML cookie-blind — and a browser can't serve a cached public copy after the visitor enters edit mode.

  Editor requests are excluded by construction via a `bypass` predicate. A host wires it as `composeWorker`'s `fetch` (`withEdgeCache(handle, { bypass: isEditRequest })`) and opts renders in per-route with `Astro.cache.set(...)`. See ADR 0004 for the activation runbook — the mechanism ships gated off until verified on a preview deploy.

- 252d119: Add `withHealing` to `louise-toolkit/worker`: a self-healing wrapper for `WorkerRoute`s that maps typed `LouiseError`s to per-code recovery policy instead of surfacing a 500. Each rule composes three deterministic strategies — `retries` (re-run the route with optional exponential backoff, for transient D1/R2/KV blips), `fallback` (serve a degraded/stale `Response`), and `escalate` (hand the failure off out-of-band via `ctx.waitUntil`, never blocking or breaking the response). Codes with no matching rule (and non-`LouiseError` throws) propagate untouched, so healing is always opt-in.

  Also exports `describeFailure`, which turns a healing context into a flat, JSON-serializable `FailureReport` — the payload an `escalate` hook enqueues for out-of-band recovery — and `TRANSIENT_CODES`, the retry-eligible infrastructure error codes. Pure library code with no AI or network coupling: `escalate` is the seam a self-updating pipeline plugs into.

- ae8e661: Add `louise-toolkit/workflows` (#88) — a thin wrapper over Cloudflare Workflows for durable, multi-step pipelines, the sibling of `louise-toolkit/queues`. Where Queues is fire-and-forget, Workflows persists each step's result and owns per-step retries/backoff, so a flow (publish: OG → warm cache → reindex → notify webhook; commerce fulfillment) resumes mid-way after a failure instead of replaying from the top.

  - `startWorkflow(workflow, params, options?)` — the producer (mirrors `enqueue`); wraps a `create` failure in `LouiseWorkflowError`, and takes an optional idempotency `id`.
  - `defineWorkflow(steps, initialState?)` — turns an ordered list of named steps into a `WorkflowEntrypoint.run` body (mirrors `processBatch`): each step runs inside `step.do` (durable, retried per its `config`) and returns a patch merged into a shared, typed `State` that later steps read.

  The site owns the `WorkflowEntrypoint` subclass + the wrangler `[[workflows]]` binding (it imports `cloudflare:workers`), exactly as it owns the Queues `queue()` export. Queues-vs-Workflows guidance is in the docs, and louisetoolkit.com wires the real publish path onto a `PublishWorkflow` (reindex → warm the OG card → notify webhook), with graceful fallback to the reindex Queue when no Workflow is bound.

### Patch Changes

- 78dd012: Fix the AI editorial assists (SEO suggest + toolbar rewrite), which had gone dead: the default Workers AI text model `@cf/meta/llama-3.1-8b-instruct` was retired by Cloudflare (EOL 2026-05-30), so every `runAi` call threw and — because the helpers degrade to `null` — surfaced as a 502 "unavailable" with no other signal. `DEFAULT_TEXT_MODEL` is bumped to the current `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. (`suggestSeo`/`rewriteText` still take a per-call `model` override, so a site can pin its own.) The alt-text vision model (`@cf/llava-hf/llava-1.5-7b-hf`) and embedding model (`@cf/baai/bge-base-en-v1.5`) were audited and remain current — unchanged.
- 7224956: Publish is now atomic on D1. `createVersionedLocalApi`'s publish path promotes the version snapshot onto the live row (setting `publishedVersionId`) and marks the version row `published` in a single D1 `batch()` — an implicit transaction — so a mid-write failure can no longer leave the row published while its version still reads `draft` (or the reverse). Parent-row existence is guarded before the batch, and any driver without `batch()` keeps the prior sequential behavior, so the generic `BaseSQLiteDatabase` contract is unchanged.
- e7e81ec: `imageDimensions` (`louise-toolkit/media`) now reads intrinsic size from **AVIF/HEIF** (the `ispe` box, walking meta → iprp → ipco and picking the largest when a thumbnail sits alongside the primary image) and **TIFF** (the first IFD's `ImageWidth`/`ImageLength`, both byte orders, SHORT or LONG) — the two formats the header parser previously returned `null` for. Pure-TS, **no new dependency**, so the binding-free upload path records dimensions for these formats too; the `.info()` Images-binding path stays the authoritative decoder. Closes the AVIF/TIFF gap noted in #84 and supersedes the Rust/WASM sniff idea in #101.
- f4e6b73: Editor route handlers now parse request bodies with `louise-toolkit/schema`'s `s.*` builder + `standardValidate` instead of casting untrusted JSON to a type and hand-checking it. `save`, `media`, `settings`, `settings-blob`, `pages`, `versions`, `editors`, and `form` each declare their body shape once; the parse drops unknown keys and rejects malformed bodies consistently (e.g. an array is no longer accepted where an object is expected). Error messages and status codes are unchanged. (#96)
- 8f0e4ba: The edit bar's **Publish** button is now green (`--louise-green`) instead of yellow, matching its role as the primary commit action. Cosmetic only.
- 530aacc: Make `suggestSeo` robust to the model — the SEO assist was still 502ing after the model bump because it parsed the model's freeform text as JSON, and the new model returns structured output differently. It now requests Workers AI **JSON mode** (`response_format` json_schema) so `{title, description}` comes back as guaranteed-valid JSON, and reads it via a new `extractJsonObject` that tolerates a parsed object under `response` (JSON mode), a JSON string, or salvaged freeform text. Also: `runAi` now `console.error`s a swallowed model failure instead of dropping it silently — the bare catch hid two real prod failures (a retired model, an unmet schema), so a dead/misbehaving model is now visible in `wrangler tail` without changing the best-effort null-on-failure contract.
- 050440f: Turn on native browser spellcheck for multiline plain-text section fields (#142). Textarea-backed section fields (`data-louise-multiline` — taglines, card bodies, longer prose) now render with `spellcheck="true"` when edited in place, so misspellings get the browser's underline for free. Single-line headline/label fields stay `spellcheck="false"` (squiggles there are noise), and rich-text prose keeps using the Harper checker (#110). Spelling-only, zero-dependency — the lightweight first step from #142 ahead of any full Harper overlay for plain-text `contenteditable`.

## 0.13.0

### Minor Changes

- ab4dddf: commerce/square: add write wrappers for the "site is the source of truth" direction (pushing D1-owned data up to Square).

  - `upsertCatalogItem` — create/update a catalog ITEM with fixed-price ITEM_VARIATIONs (item + variation `version` pass-through for updates); returns the normalized item with the ids Square assigned plus a temp→real `idMappings`.
  - `SquareCatalogItem` / `SquareVariation` now carry the object `version` (from `mapCatalogItem` / the reads), so a retrieve→edit→`upsertCatalogItem` update round-trips the versions Square requires.
  - Team API: `createTeamMember`, `updateTeamMember`, `retrieveTeamMember`, `searchTeamMembers` (+ `SquareTeamMember` / `TeamMemberInput`).
  - Labor / timecards API: `createTimecard`, `updateTimecard`, `retrieveTimecard`, `searchTimecards` (+ `SquareTimecard` / `TimecardWage`). Requires Square-Version ≥ 2025-05-21, which the pinned `SQUARE_VERSION` satisfies.
  - Invoices API: `createInvoice` (draft, against an OPEN order, with a DEPOSIT/BALANCE/INSTALLMENT payment schedule), `publishInvoice` (yields the hosted `publicUrl` under SHARE_MANUALLY), `retrieveInvoice` (+ `SquareInvoice` / `SquareInvoicePaymentRequest` / `InvoicePaymentRequestInput`) — for deposit+balance billing where one invoice tracks both installments.
  - `createOrder` now accepts ad-hoc line items (`{ name, priceCents, quantity }`) so charges with no catalog object (e.g. a manufacturing deposit) can still mirror as itemized Square orders. `SquareOrderLineItem` is widened to a union (catalog-ref | ad-hoc); constructing catalog-ref line items is unchanged.

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
