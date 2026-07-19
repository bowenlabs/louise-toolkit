# astroidjs

## 0.1.1

### Patch Changes

- Fix `npm create astroid` failing with `ERR_MODULE_NOT_FOUND: Cannot find package 'drizzle-orm'` in a clean environment.

  `astroidjs` calls `defineCollection` from `louise-toolkit/content` at runtime, and that entry pulls in the content validation module, which imports `drizzle-orm` for its uniqueness queries. `drizzle-orm` is an _optional_ peer of `louise-toolkit`, so npm never installed it — meaning anyone running `npm create astroid` (or importing `astroidjs` outside this workspace) crashed before the scaffold produced anything. It went unnoticed because the CI scaffold test runs inside the workspace, where `drizzle-orm` is already present as a dev dependency.

  `astroidjs` now declares `drizzle-orm` as a real dependency, which is what its import graph actually requires; `create-astroid` picks it up transitively. The underlying sharpness — that importing `defineCollection` from the `louise-toolkit/content` barrel drags the drizzle-dependent validation chunk with it — is worth splitting up separately.

## 0.1.0

### Minor Changes

- f623ccb: Add the `astroid` CLI and the project-generation engine behind it (#104). New
  commands: `astroid generate` (regenerate the `src/schema.ts` / `src/worker.ts` /
  `src/middleware.ts` trio from `astroid.config.ts`), `astroid doctor` (validate the
  config, check the wrangler bindings + generated-file freshness, flag unresolved
  binding placeholders), and thin `astroid dev` / `astroid build` wrappers that
  regenerate before handing off to Astro. `astroid deploy` prints a "coming soon"
  notice — live provisioning is a later slice.

  The engine is exported for reuse by the forthcoming `create-astroid` scaffold:
  `generateAstroidProject(config)` returns the regenerated, "do not hand-edit" trio,
  and `generateAstroidWrangler(config)` emits a floor `wrangler.jsonc` (D1/R2/KV/
  Images bindings, custom-domain routes from `hosts`, placeholder ids). The two are
  deliberately separate — `generate` never rewrites the scaffold-once wrangler, so
  provisioned ids are safe. astroidjs now builds to `dist/` (tsgo) and ships an
  `astroid` bin, so the CLI loads a project's TypeScript config via Node's native
  type stripping.

- 4c18d45: Add the `<Collection>` primitive (ADR 0003, item 3) — `astroidjs/components/Collection`.
  A Solid render-prop that renders a typed list: the item type is inferred from
  `items`, so `item` in the render slot is fully typed with no hand-written
  interface. It's a Solid component (not `.astro`) because only a children-as-function
  can type a per-item `{item}`; server-render it by using it inside a Solid island
  with no `client:*` directive (static HTML, no JS shipped). `solid-js` is an optional
  peer dependency.

  The item type comes from the `items` you pass (typed from your data, per ADR 0001's
  Zod-as-source-of-truth) rather than from the collection config — Louise's
  `CollectionConfig` is type-erased (`fields: Record<string, FieldConfig>`), so the
  shape can't be recovered from the collection value itself.

  Also fixes packaging for the source-shipped component layer: `sections.ts` no
  longer imports `../config.js` (it ships as source next to the `.astro`, so it must
  not reach into astroid's built `src/*`), and `src/components/*` is excluded from the
  built `dist/` — the whole component layer ships as source via the `./components/*`
  exports.

- 561775e: Implement `astroid deploy` (#104) — the one-command platform bring-up. It reads the
  generated `wrangler.jsonc`, and for every binding still holding a placeholder id it
  provisions the resource (D1/R2/KV) via the project's own `wrangler`, patches the
  discovered id back into `wrangler.jsonc`, applies migrations, prompts for
  `SESSION_SECRET`, and deploys.

  Plan-first + safe: it prints the exact commands it will run; `--dry-run` stops
  there, and the irreversible steps only proceed on an interactive `y` (or `--yes`) —
  non-interactively it refuses unless `--yes` is passed. `--local` targets the local
  D1 for migrations. Replaces the previous "coming soon" stub.

- 43a31f0: Fix `<Editable>` so it type-checks in a real consumer, and add its section-field
  mode (ADR 0003 §5). The previous generic-`Polymorphic` `Props<Tag>` resolved to
  `IntrinsicAttributes` under `astro check` — the component looked like it accepted no
  props, so any `<Editable …>` failed to type-check. It's now a concrete
  `HTMLAttributes<"div">`-based interface with `as` for the element.

  New section-field mode: pass `sfield` (the `<index>.<path>` marker) — plus optional
  `multiline` — to emit `data-louise-sfield` for the structured `<Section>` editor,
  alongside the existing page-field mode (`collection`/`key`/`field` →
  `data-louise-field`). This completes ADR 0003 item 5's proving slice: the reference
  site's `FeatureGrid` section now stamps its inline-edit markers through `<Editable>`
  instead of by hand, verified to compile + build with `astro check` + `astro build`.

- 1711a45: Add the `<Editable>` component primitive (ADR 0003, checklist item 1) —
  `astroidjs/components/Editable.astro`. It owns the `data-louise-*` inline-edit
  marker contract so sites stop hand-stamping it: a typed, polymorphic prop surface
  (`as` + typed `...rest`, `collection`/`key`/`field`/`type`) that emits the markers
  the Louise client turns into in-place editors — but only in edit mode, so public
  HTML stays clean. astroidjs now ships `.astro` source components (exported via
  `astroidjs/components/*`) alongside its built TS generators.

  Also: `astroidPagesCollection` now sanitizes the `body` field on every write. The
  body is edited in place as rich HTML and staged as a draft, so it's sanitized
  (scripts dropped, off-origin image hotlinks removed) before storage — closing the
  stored-HTML gap the inline editor would otherwise open.

- 9b5b9c3: Add the `editors` route to the generated Worker's editor-route plan. The scaffold
  floor ships DB-managed Better Auth editors (a `user` row _is_ an editor, and that
  table is the magic-link allowlist), so the generated `worker.ts` now composes
  `editorsRoute({ table: "user", resolveEditor })` — the backend for the Users panel
  that invites and removes editors. Slotted after `mediaRoute`; no ordering
  constraint (it doesn't share the `/pages/:id` matcher).
- af0cb91: Scaffolded sites now ship a real Content-Security-Policy. `astro.config.mjs`
  enables Astro's `security.csp`, so every on-demand (SSR) page — all of ours —
  gets a hash-based `content-security-policy` response header. The generated
  `src/middleware.ts` (`createLouiseMiddleware`, `cspStyleSrc: "'self' 'unsafe-inline'"`)
  then rewrites `style-src` to permit Louise's data-driven `style=""` carriers and
  the editor's runtime-injected `<style>`, and auto-allows the inlined `data:` brand
  font — leaving Astro's script hashes verbatim. Previously the CSP machinery
  shipped dormant (the middleware only rewrote a CSP header, and nothing emitted one).

  To keep that policy strict-by-default, the template's two inline scripts are now
  CSP-hashable (Astro hashes processed scripts but **not** `is:inline` / `define:vars`,
  whose per-request content can't be hashed):

  - **`login.astro`** — the magic-link submit handler drops `is:inline`, so Astro
    processes and hashes it into `script-src` (rewritten to stay type-safe under
    `astro check`).
  - **`LouiseEdit.astro`** — the editor boot no longer uses `define:vars`. The
    per-render `userName` / `versionedPageId` ride as `data-*` on a marker element
    that the now-static (hashable) boot script reads; edit-mode gating and the
    `astro:page-load` re-boot are preserved.

  A site that loads **Square Web Payments** must allow its SDK host in `script-src`
  — `security: { csp: { scriptDirective: { resources: ["'self'", "https://web.squarecdn.com"] } } }`
  — documented in the scaffolded `astro.config.mjs` rather than allowed by default.

- 5383051: Add the `<Section>` dispatcher + a starter section library (ADR 0003, items 2 &
  4). `astroidjs/components/Section.astro` is a discriminated union over
  `SectionKind` — `<Section kind="hero" heading="…" />` requires that kind's fields
  and rejects another kind's — dispatching to typed section components (hero,
  featureGrid, cta, contact). The typed model (`astroidjs/components/sections`)
  follows the ADR conventions: variant props are unions not `string`, callers pass
  intent (`colorway="brand"`) while the component owns the token→class mapping, and
  those unions derive from the token maps via `keyof typeof` so type and
  implementation can't drift.

  Remaining ADR 0003 items: `<Collection>` (item 3) needs a Solid render-prop —
  Astro slots can't type a per-item `{item}` — and the reference-site proving
  conversion (item 5) needs a local `astro build` to verify the components compile;
  both are deferred rather than shipped unverified.

- 50cee46: Collapse `defineAstroid` to a single brand. Every site Astroid targets
  (coracle.coffee, ghostfire.coffee, themidwestartist.com, louise-web) serves one
  brand from one deploy — none does host/tenant dispatch — so the `brands[]` array
  was speculative complexity. The config now hoists `key`/`archetype`/`theme`/
  `sections`/`modules`/`portal` to the top level, and the schema generator drops the
  `brand` discriminator column + per-brand slug. The axis that genuinely multiplexes
  is _editors_ (the org plugin, #100) and _audiences_ (a gated `portal`), both kept
  as options on the one brand.

  Breaking: `brands[]`, `BrandConfig`, `isMultiBrand`, and `commerce.sharedCatalog`
  are removed; `BrandTheme`/`BrandPortal` are renamed to `Theme`/`Portal`. Added a
  `"marketing"` archetype (the louise-web floor). Nothing consumes `astroidjs` yet,
  so there is no downstream migration.

- 0e9acbd: Introduce `astroidjs` — the opinionated meta-framework layer over Louise Toolkit
  and Astro. Ships the initial `defineAstroid` configuration surface for
  multi-brand, editable sites on Cloudflare Workers: brands with archetypes
  (storefront / wholesale / portfolio), a themeable section library, optional
  modules (order tracking, subscriptions, …), and a shared-catalog commerce
  option. `astroidjs` depends on `louise-toolkit`, never the reverse.
- 9e07377: Add config → schema generation. `astroidPagesCollection` / `astroidContentConfig`
  derive the Louise content config from an Astroid project (the opinionated bit),
  and `generateAstroidSchema` emits the Drizzle `schema.ts` a Louise site would
  otherwise hand-write — composing `pagesColumns`, the `pages_versions` snapshot
  table, and the framework tables the config selects (`inquiries` only when a brand
  captures them). Multi-brand adds a `brand` discriminator and a per-brand slug.
  This is the first slice that consumes `louise-toolkit` (one-way: astroidjs →
  louise-toolkit).
- 40b8e0e: Add config → Worker + middleware generation. `astroidEditorRoutePlan` encodes the
  one collision-free order for the `louise-toolkit/editor` routes (versions/search
  before pages) as data, so the "MUST precede pagesRoute" footgun is impossible by
  construction. `generateAstroidWorker` emits the Worker entrypoint — editor routes
  in that order, an R2 media-asset route, and the `composeWorker` default export
  over Astro's SSR handler — with inquiry routes + the contact form included only
  when a brand captures inquiries. `generateAstroidMiddleware` emits the Astro
  middleware via `createLouiseMiddleware`. Two seams (auth `resolveEditor`, the
  section-catalog `validate`) are marked for later slices.

### Patch Changes

- 38b8b81: The generated `middleware.ts` now ships a default rate limit on the unauthenticated auth surface (`POST /api/auth/*`, 10/min keyed by client IP via the already-provisioned `RL` KV) — so a scaffolded site isn't open to magic-link email-bombing (inbox flooding + Email/Worker spend) out of the box. The generated contact form gains a matching submission cap (`spam.rateLimit`, 5/min/IP) on top of its honeypot + minimum-time heuristics. Both read `env.RL` per request (a getter, never at module-eval) and fail open on a KV blip.
- 47df5c4: The generated middleware's CSP `style-src` no longer allows
  `https://fonts.googleapis.com` — Louise's brand font is bundled + base64-inlined,
  so scaffolds make no Google Fonts request. A strict `font-src` should permit
  `data:` for the inlined `@font-face`.
- Updated dependencies [c182412]
- Updated dependencies [56821bc]
- Updated dependencies [6fa4f98]
- Updated dependencies [78dd012]
- Updated dependencies [0039440]
- Updated dependencies [3146ec8]
- Updated dependencies [afe5ba1]
- Updated dependencies [c39466b]
- Updated dependencies [7224956]
- Updated dependencies [c6052d3]
- Updated dependencies [9f5ac5d]
- Updated dependencies [698e230]
- Updated dependencies [e7e81ec]
- Updated dependencies [077b323]
- Updated dependencies [aa020ca]
- Updated dependencies [47df5c4]
- Updated dependencies [15ed27c]
- Updated dependencies [4d2de4c]
- Updated dependencies [aa0f70d]
- Updated dependencies [a89ad95]
- Updated dependencies [10519f3]
- Updated dependencies [8509d15]
- Updated dependencies [a6a9a2c]
- Updated dependencies [ab52389]
- Updated dependencies [a929ac1]
- Updated dependencies [9cd8395]
- Updated dependencies [355915d]
- Updated dependencies [f4e6b73]
- Updated dependencies [ce8f8a6]
- Updated dependencies [037054f]
- Updated dependencies [baf6b62]
- Updated dependencies [42bd2b9]
- Updated dependencies [b29f520]
- Updated dependencies [1faa88a]
- Updated dependencies [8497b55]
- Updated dependencies [60e690f]
- Updated dependencies [60e033f]
- Updated dependencies [b950812]
- Updated dependencies [1c4a8f9]
- Updated dependencies [dd2187a]
- Updated dependencies [38b8b81]
- Updated dependencies [de43f53]
- Updated dependencies [d351abf]
- Updated dependencies [e668e37]
- Updated dependencies [8f0e4ba]
- Updated dependencies [a9d61c6]
- Updated dependencies [14a62c4]
- Updated dependencies [7be2413]
- Updated dependencies [8355f96]
- Updated dependencies [d944ca5]
- Updated dependencies [0d0db1f]
- Updated dependencies [8474f38]
- Updated dependencies [1110318]
- Updated dependencies [7326bb6]
- Updated dependencies [4c41ec7]
- Updated dependencies [530aacc]
- Updated dependencies [46e9af5]
- Updated dependencies [050440f]
- Updated dependencies [2824490]
- Updated dependencies [98ba35a]
- Updated dependencies [17231d2]
- Updated dependencies [21796fb]
- Updated dependencies [9c4d0a4]
- Updated dependencies [7019d09]
- Updated dependencies [6c72267]
- Updated dependencies [252d119]
- Updated dependencies [ae8e661]
  - louise-toolkit@0.14.0
