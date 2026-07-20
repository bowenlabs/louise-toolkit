# create-astroid

## 0.2.0

### Minor Changes

- 86896b6: Close the last three dead-UI gaps: the typed Actions surface, real-visitor Core Web Vitals, and the dashboard's inbox card.

  **Astro Actions (`src/actions/index.ts`).** Astroid generated only the raw `/api/louise/*` route half, leaving the Astro-native layer of ADR 0001 unbuilt. That is not a missing convenience — the two entrypoints write the _same rows_, and the whole point of `louise-toolkit/astro`'s factories is that each shares its route's store path (`applyFieldSave`, `applySettingsPatch`, `applySaveDraft`). A project wiring its own Actions gets a second write path, which is where validation, sanitization, and draft-merge semantics drift apart silently. `save`, `saveDraft`, and `settings` now ship pre-wired against the same tables and the same collection config the worker uses; the file is scaffold-once and meant to be added to. `ASTROID_SETTINGS_COLUMNS` / `ASTROID_SETTINGS_IMAGE_KEYS` are now exported so the Actions import the identical allowlist the routes enforce rather than carrying a second literal that could drift.

  **Core Web Vitals.** `HealthSummary` has carried an optional `cwv` field since the health module landed, and the Health panel rendered a "not measured yet" badge for it — permanently accurate and permanently useless, because nothing collected the data. The full loop now ships: a beacon (`public/vitals.js`) posts LCP/CLS/INP, `vitalsRoute` writes them to an Analytics Engine dataset, and the daily health scan reads the p75 back and folds it into the summary. Collection is free and needs no credentials; only the read-back does, because the Analytics Engine SQL API is account-scoped and has no binding — so `CF_ACCOUNT_ID` + `CF_API_TOKEN` follow the dormant-until-provisioned convention and an unprovisioned site simply keeps the "not measured yet" badge rather than erroring. The dataset name is derived from the project key so two Astroid sites on one account don't blend their p75s.

  The beacon is a **static file, not an inline script**: Astro hashes processed scripts into `script-src`, and an inline script carrying generated content can't be hashed and would be CSP-blocked. From `public/` it is same-origin and already covered by `script-src 'self'`. It is skipped in edit mode — an editor's session isn't representative field data.

  **The inbox card.** Previously omitted on the reasoning that an "unread" count with no read-state column could only be the total, "a number that never goes down". That was wrong about the model: `inquiriesRoute` is GET-and-DELETE, and the Inquiries tab _reviews and clears_ submissions — deletion **is** the acknowledgement. So a surviving row is a message still waiting, the count falls as you work through them, and `COUNT(*)` is exactly right. Wired, gated on the project actually capturing inquiries.

  `vitalsRoute` is imported from `louise-toolkit/analytics`, not `/editor` — the same non-editor-route trap `realtimeRoute` hit.

- 5b227b5: Wire Workers AI, so the editor assists that already ship actually work.

  `aiRoute` (rewrite / expand / shorten a selection, suggest SEO), `seoFixRoute` (one-click SEO backfill for published pages missing a title or description), and `mediaRoute`'s `altText` all existed in the toolkit and all shipped as buttons in the editor drawer. None of them was reachable: the generated `wrangler.jsonc` declared no `ai` binding and the route plan mounted neither route, so every one of those buttons answered 404 or 503 and the client dutifully hid it. They were invisible, not broken, which is why nobody noticed.

  The binding is declared unconditionally rather than behind a module flag. `louise-toolkit/ai` degrades by contract — a missing binding or a model error yields null, never a throw — and each route answers 503 when the runner is undefined, so mounting them on a project that never touches AI costs nothing. Every call is editor-gated, so a visitor can't spend your AI budget.

  **`seoFixRoute` is mounted before `pagesRoute`, and that ordering is load-bearing.** It lives at `/api/louise/pages/generate-seo`, and `pagesRoute` claims _every_ path under `/api/louise/pages/` as an item id — so mounted after, it would be unreachable and the request would 400 on the non-integer id `generate-seo`. That is the same collision the existing `versions`/`search` ordering exists to prevent, and it fails silently until someone clicks the button, so there's now a test asserting the general rule: any route under `/api/louise/pages/<word>` precedes `pagesRoute`.

  The alt-text model (`@cf/llava-hf/llava-1.5-7b-hf`) was checked against Cloudflare's current catalog before wiring — it is live and was not in the May 2026 deprecation batch. A retired Workers AI model surfaces as a generic 502 with nothing in `wrangler tail`, so this is worth re-checking whenever the default moves.

- 09a5e01: Scaffold the server-authoritative payment seam, so `archetype: "storefront"` can take a card.

  Everything around this already existed and none of it was reachable: `verifyCheckout` re-priced server-side, `checkoutIdempotencyKey` deduped a double-clicked Pay button, the rate rule on `/api/checkout` was in the middleware, `/checkout` and `/cart` were in the noindex list, and the CSP already allowed Square's Web Payments hosts. The route in the middle was missing.

  A Square storefront now gets `src/pages/api/checkout.ts` and `<SquareCard>`. The route's step order is the part worth fixing in place, because each step is somewhere a mistake costs money rather than throwing: re-price every line from the D1 mirror (the client's price is a _staleness check_, never an input to the charge — accept `unitPrice` from the body and anyone buys anything for a penny), refuse on mismatch rather than silently charging the server's number, derive the idempotency key from the verified cart _and_ the cart id, and only then charge — and only if commerce is actually provisioned, so an unconfigured store simulates instead of calling Square with `DUMMY_REPLACE_ME`. The card field is an iframe served by Square's CDN, so the raw card number never enters the page's DOM or reaches the Worker.

  **The cart is deliberately not generated.** Where it lives (localStorage, D1, a portal session), what it holds, and how it renders are project decisions Astroid has no business making; a half-opinionated cart is worse than none. What is _not_ a project decision is the order above.

  Square only, and named rather than pretended-generic: Fourthwall redirects to its own hosted checkout, and Stripe has no catalog API so it fills the `invoicing` role.

  `SQUARE_APP_ID` and `SQUARE_ENVIRONMENT` are emitted as wrangler **vars** rather than added to the commerce credential roster. The app id is public — it ships to the browser to mount the card field — and putting either in `credentials` would also fold it into the dormancy gate, which asks whether we can safely _call_ Square, a different question from whether a card field can render. So dormancy semantics are unchanged for existing projects.

- 29b5c1c: Add the commerce module (#250): provider **roles**, a catalog mirror with a pulled/owned split, one shared loader, and a server-authoritative checkout.

  **Roles are forced by capability, not chosen.** The obvious model — one commerce provider per site — is wrong, and the toolkit's own clients prove it: `commerce/stripe` has no catalog API at all (invoices, customers, payment intents), while `commerce/fourthwall` has a catalog and cart but no invoicing. Square does both. So a single provider abstraction would have a permanent hole wherever Stripe sits. `commerce` now takes `storefront` and `invoicing` independently — the topology themidwestartist.com already runs — and `defineAstroid` rejects a provider assigned to a role its client can't serve, naming the ones that can. The `provider` shorthand assigns to the provider's natural role, so `{ provider: "stripe" }` is invoicing rather than a storefront with nothing behind it.

  **One mirror primitive, two modes.** Every site kept a set of fields _pulled_ from the provider and a disjoint set the owner edits and must survive every sync. What they didn't agree on was how much to store — and that turns out to be a setting, not a second design. `mirror` keeps the catalog fields in D1 (tma's `products`: fast local reads, briefly stale); `overlay` keeps only the owner's columns keyed by the provider's id (coracle's `product_display_meta`: never stale, one provider round-trip per read). `overlay` is just `mirror` with an empty pulled set, so one generator emits both.

  The invariant the split exists for is enforced in the sync: **an owned column never appears in an UPDATE.** Not usually — never. A sync that writes one silently reverts the owner's work, and they find out days later. Owned columns appear only in the INSERT, as defaults for a row that didn't exist. `slug` is owned for the same reason: it's the public URL, so a provider rename must not break links and SEO. Writes are keyed on the provider's id (unique), so the cron and a webhook racing on one product collide into one row, and slug collisions are allocated around rather than failing the sync over two products sharing a name.

  **One loader, both providers.** tma's loader says it outright — coracle runs the same helper over Square, "only the `content/repo` reads differ — issue: repo drift." Two sites, one intent, two translations that drifted. `astroidCatalogLoaderConfig` reads the mirror, and the adapters (`squareToCatalogItem`, `fourthwallToCatalogItem`) normalize before the row is written — so the loader never learns which provider it is.

  **Server-authoritative checkout.** `verifyCheckout` treats the client's price as a staleness check and never as an input to the charge: re-price server-side, refuse on mismatch. It also rejects non-integer, negative, and absurd quantities — a quantity of `-1` turns a charge into a refund on some providers. `checkoutIdempotencyKey` derives a key from the verified lines and total plus a required `identity` (order-insensitive, scope-separated), so a double-clicked Pay button charges once while two customers with identical carts stay two charges.

  The generated worker, CSP, env types, and webhook receivers all became plural: a two-provider site gets a receiver and signing secret per provider, and a CSP allowing both SDKs.

  Fixed while verifying: the generated `schema.ts` used `real()` for `price`/`sortOrder` but never imported it, so **every commerce scaffold failed `astro check`**. The drizzle import is now computed from what the emitted source actually uses, with a test asserting the two stay in sync.

  Verified in a clean room (packed tarballs, installed outside the workspace): a `--commerce square` scaffold type-checks with 0 errors and builds.

- 6d99c52: Wire edge caching for published pages — shipped wrapped, and shipped off.

  The generated worker now wraps Astro's SSR fallback in `withEdgeCache`, Louise's cookie-aware Worker Cache API layer (ADR 0004), with `bypass: isEditRequest`. The scaffold gets the `cacheCloudflare()` provider, a page-level opt-in on the home route, and an `ASTROID_EDGE_CACHE` var that defaults to `"false"`.

  **The default is the safe state, not merely the off state.** With the var off every render calls `Astro.cache.set(false)` → `no-store` → `withEdgeCache` stores nothing and is a transparent pass-through. Wrapping unconditionally is therefore inert; the wrap only becomes live when a page emits a cacheable directive, which requires both the var _and_ a request that isn't in edit mode.

  Why this layer rather than Cloudflare's automatic edge cache: the automatic one is keyed by URL and runs **before** the Worker, so it cannot see the edit cookie and will serve a cached public page — drafts and inline-edit hooks and all — to a signed-in editor. `withEdgeCache` runs inside the Worker, decides cacheability after inspecting the request, and strips the CDN directive from every response so the automatic cache never engages. That distinction is what got this feature reverted twice, and it is why activation stays gated on the preview-deploy runbook in `docs/adr/0004-edge-caching.md`: `caches.default` is not cleared by Cloudflare Dev Mode or "Purge Everything", so a bad production flip is hard to walk back.

  **`louise-toolkit` gains `isEditRequest` and `LOUISE_EDIT_COOKIE`** (from `louise-toolkit/worker`). The edit-cookie predicate was hand-rolled in the reference site, and Astroid would have hand-rolled it a second time — against a cookie name that lives as a default inside `createLouiseMiddleware`. Now the middleware that _sets_ the cookie and the predicate that _looks for_ it read one constant, so they cannot drift. Drift there is not a cosmetic bug: it means an editor served a cached public page, which is precisely the failure this layer exists to prevent and the hardest one to notice. The predicate matches at a cookie-name boundary, so `x_louise_edit=1` can't false-positive into a permanent cache bypass.

- 2652929: Add the transactional email module (#254): the four templates every consuming site rewrote, a mail theme derived from the project's brand, and a delivery path that is safe to call from a request handler.

  **Templates.** Sign-in link, password reset, and the inquiry pair — notify the owner, confirm to the sender. All three sites wrote these four with the same structure and near-identical copy, differing only in the brand name, which is what makes them first-party rather than site-side. The brand-agnostic frame already lived in `louise-toolkit/email`; this owns the wording and the layout inside it. Every template renders HTML **and** plaintext from one definition: a message with no text/plain part scores worse with spam filters, and for a sign-in link the plaintext body is what a terminal client shows and what the dev log prints. Visitor-supplied values are HTML-escaped, and the inquiry subject goes through `subjectSafe` — a newline in a name field is a header-injection primitive.

  **`astroidMailTheme(config)`** derives the ten palette slots, the colour band, and the font stacks from `theme.colors`. Two choices are load-bearing: neutrals stay fixed (page background, ink, rules are typography decisions, not brand ones) while the accent and band come from the brand; and the accent is **contrast-corrected against the card background**, because a brand yellow used verbatim as 11px uppercase text is unreadable and mail clients have no dark-mode escape hatch. The band is always five cells — a ramp through however many brand colours exist — so the masthead reads as designed rather than as "whatever was configured". A malformed hex falls back instead of throwing; a bad colour in settings should not take out password reset.

  **`sendTransactional`** never rejects. Mail in this stack is always store-and-forward — the inquiry row is inserted, the account exists — so it is the notification of something that already happened and must not fail the request that caused it, nor throw into a `waitUntil` where it becomes an unhandled rejection. Messages send concurrently and independently, so the owner's copy still arrives when the visitor typo'd their address. With no `EMAIL` binding (or no `MAIL_FROM`) the mailer is dormant per the #252 convention: it **logs** the rendered message, plaintext body included, which is what makes "click the magic link" work under `wrangler dev`.

  The scaffold wires it: the generated worker hangs `sendInquiryMail` off the form route's `onSubmit` (which fires after the insert, off the response path), and `auth.ts` now renders the real magic-link template instead of a three-line HTML string.

  Verified end to end on a scaffolded project with no bindings provisioned: a contact POST returns 201, the row lands in D1, and both messages are logged with their recipients, subjects, and bodies.

- d2f625d: Wire the site-health co-pilot, so the Health panel that already ships has a backend.

  This is the same shape as the `overviewRoute` gap: `louise-toolkit/health` and `healthRoute` existed, and the Health card and panel ship in the editor drawer astroid mounts — but nothing provisioned the subsystem, so the panel was UI for something that could never have data.

  Now generated: `healthRoute`, the `health` slice on `overviewRoute`, and a daily cron that crawls the site's own pages for broken links and counts images missing alt text and published pages missing SEO. The summary lands in the **existing `RL` namespace** under its own key rather than a new binding — it's one small singleton blob, and a binding you must remember to provision before the dashboard works is a binding people don't provision. Until the first scan runs the route returns `{ summary: null }`, which the panel renders as "not checked yet".

  Every part of the scan degrades on its own: a failed crawl or a missing table yields zero rather than aborting, because a partial health report is worth strictly more than none.

  **Crons are now a list, and the handler dispatches on `controller.cron`.** Cloudflare fires one `scheduled` handler for every trigger and identifies which fired by that string, so `wrangler.jsonc`'s `triggers.crons` and the handler's dispatch have to agree exactly — a string in one and not the other is a job that silently never runs, with no error and no log. Both now derive from `astroidCrons`, and CI asserts every declared cron is dispatched. The health scan is daily (`17 4 * * *`) and deliberately not on the hourly catalog cron: hourly would be a self-inflicted crawl 24× a day to recompute counts that move slowly.

  Consequently `scheduled` is emitted for every project, not only those with queues, and `triggers` always has at least the health entry. Disabling `queues.cron` now drops only the catalog re-sync.

  Also: `SITE_URL` is finally typed in the scaffold's `env.d.ts` — `wrangler.jsonc` declared the var but reading it was a type error.

- 5f49ec2: Add the map module (#258): a self-hosted PMTiles basemap served from R2, a brand-recoloured MapLibre style, and a scaffolded `<MapEmbed>` — no API key, no external tile host.

  **Range serving is the reusable part**, and it's more than a passthrough. A PMTiles archive is one immutable blob, often hundreds of megabytes, that the client reads a few kilobytes at a time. `servePmtiles` implements the range contract properly: bounded windows, open-ended ranges, **suffix ranges**, 416 with the real length for unsatisfiable ones, and HEAD.

  That suffix case is not hypothetical. The implementation this generalizes matched only `bytes=<start>-<end?>`, so `bytes=-20000` — "the last 20 KB", how a client reads a footer without knowing the length — fell through to serving the **entire archive**. A correct-looking response and a catastrophic one. It's handled here, with tests.

  It also trusts what R2 says it returned over what was asked for, because R2 clamps, and a `Content-Range` that disagrees with the body corrupts the client's view of the archive.

  **`servePmtiles` takes a reader function, not a bucket.** `R2Bucket.get` is overloaded and its first overload _requires_ an options argument, so no structural interface with an optional second parameter can accept a real `R2Bucket` — verified the hard way, by watching `astro check` reject it in a scaffolded project. Taking `read: (range?) => Promise<…>` lets the call site use R2's own types, and incidentally makes the handler work over any storage.

  **`astroidMapStyle` is dependency-free.** A MapLibre style is JSON, so it's a plain object rather than an import of `maplibre-gl` (a megabyte) or `protomaps-themes-base` for types — astroidjs stays installable by projects that never draw a map. Road casings are ordered beneath road fills (the thing that makes a road read as a stroked ribbon), labels are opt-in because they need self-hosted SDF glyphs, and OpenStreetMap attribution defaults to present because the licence requires it.

  **`<MapEmbed>` is generated, not shipped.** A component living in astroid's own `src/components/` would make `maplibre-gl` + `pmtiles` hard requirements of the package — including for the CI probe that type-checks the component library — for a feature most sites never enable. Generating it into the projects that turn the module on keeps the dependency where the decision was made, and puts the pin, gestures, and placeholder in the project's hands, which is right: those are brand.

  CSP contributes exactly `worker-src blob:`, gated on the module. MapLibre builds its tile-decoding workers from blob URLs, and without it the canvas renders empty. Nothing else is needed — which is the whole argument for the self-hosted archive: same-origin means `connect-src` stays `'self'` with no tile host to allow.

  `create-astroid --map` scaffolds the route and component and injects the two dependencies. The config it writes now emits `modules`, which matters: `astroid generate` rebuilds the CSP from that file, so a config that dropped it would regenerate a policy without `worker-src blob:` and the map would fail with no obvious cause.

- 481884e: Add the media primitives (#257): `<MediaSlot>` and `<JustifiedGallery>`, plus a `work.astro` gallery page for the `portfolio` archetype.

  **`<MediaSlot>`** is the responsive-image component the consuming sites each rebuilt. The srcset math wasn't the missing piece — `louise-toolkit/media` already ships `cfImageSrcset` and `circleImage` — the _component_ around it was: a `sizes` hint (without one the browser assumes `100vw` and over-fetches on every multi-column layout, which is how a "responsive" image ends up slower than a fixed one), a reserved `aspect-ratio` box so images can't shift the page as they load, and `focal`/`zoom` framing applied at render rather than as a second CDN derivative of the same source. `alt` is required, with `""` documented as the correct value for a decorative image — the failure mode being a missing attribute, which makes assistive tech read the filename aloud.

  **`<JustifiedGallery>`** is Flickr-style row balancing: images keep their aspect ratios, rows fill the container exactly, row heights land near a target. CSS can't express it — `grid` wants uniform tracks and `columns` produces a masonry _column_ flow where reading order runs down the page instead of across it, which is wrong for a portfolio and wrong for keyboard order.

  It works in two layers so it never depends on JavaScript to be usable. SSR emits a flex-wrap floor using the media library's recorded dimensions, already justified and gap-correct with no layout shift; on the client, once images decode and their true dimensions are known, `justifyRows` recomputes exact rows. That second pass is what fixes the common case of dimensions being absent, stale, or transposed.

  The layout arithmetic lives in `astroidjs/components/justify` as a pure function, so it's the same code on the server and the client and can be tested without a browser. It carries two rules worth naming: the last box in a row absorbs the rounding remainder (rounding each box independently leaves a 1–2px seam that reads as a ragged right edge), and a sparse trailing row is left un-stretched past a slack multiple — otherwise a gallery ending on one landscape photo blows it up to full width and four times every other row's height.

  `create-astroid --archetype portfolio` now scaffolds `src/pages/work.astro`, wiring the gallery to the media registry: images only, alt/caption carried from the asset row (so an editor fixes alt text once and every gallery picks it up), and intrinsic dimensions passed through so first paint isn't a guess.

  CSP-wise both components stay inside the strict policy from #253 — the layout script is a normal bundled `<script>` that Astro hashes into `script-src` (verified: it builds to a hashed `_astro/*.js`, not inline), and per-tile sizing uses the data-driven inline `style` attribute the middleware's `style-src` rewrite already covers.

  CI now scaffolds and `astro check`s a **portfolio** project alongside the storefront one. That isn't redundant: the storefront scaffold never emits `work.astro`, so it never compiles these components — and `.astro` files are invisible to both `tsgo` and vitest, so without it they would ship with nothing having type-checked them at all.

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

- 5b227b5: Fix the release blockers a pre-production audit found in Astroid and its scaffold. Three of them shared a root cause, and each root cause was a place where nothing could observe the failure.

  **The scaffold's toolkit versions are derived, not hand-written.** `template/package.json` pinned `astroidjs: ^0.1.0` and `louise-toolkit: ^0.14.0` as literals. Both were already stale — the published `create-astroid@0.1.2` installs two copies of the toolkit — and the pending release takes astroid to a minor that `^0.1.0` cannot match, so the next scaffold would have installed a version with no `astroidjs/astro` export and died before Astro loaded its config. `create-astroid` now derives both ranges from its own resolved dependencies (`pnpm pack` rewrites `workspace:*` to the concrete version), and CI asserts the scaffold declares the versions it was built against. That assertion is the actual fix: the clean-room smoke test pins both packages to tarballs via pnpm `overrides`, which is exactly what made the declared ranges invisible to it.

  **`astroid generate` can now complete a config change.** The regenerated trio emits static imports of module seams — `./queue.js`, `./portal-auth.js` — and every one of those files was produced by exactly one thing, `create-astroid`'s CLI. So switching a module on afterwards, by editing the one typed config the framework is built around, regenerated a project importing files that did not exist, and `astroid doctor` reported `healthy` and exited 0. The scaffold-once file list now lives in `astroidjs` as `generateAstroidScaffoldFiles`, shared by the CLI and the scaffolder: `generate` writes any that are missing and never overwrites one that exists, and `doctor` treats a missing seam as an error. `doctor` also gained the wrangler bindings the generated code actually dereferences (`RL`, `DRAFTS`, `COMMERCE_QUEUE`, `EMAIL`) — enabling commerce previously left the worker calling `env.COMMERCE_QUEUE.send()` against a `wrangler.jsonc` with no queues block, and both `doctor` and `deploy` called it fine. Drift in the trio is now an error rather than a warning, so `pnpm doctor` can gate CI on the condition it exists to catch.

  **Three failures that only appear once deployed.** Nothing in this repo runs a deployed scaffold, so all three passed every build:

  - The generated `wrangler.jsonc` had no `send_email` binding, while `src/env.d.ts` declared `EMAIL` as required and Better Auth's magic-link path emails the link in production (it is only console-logged in dev). Sign-in was impossible on every deployed site.
  - The Better Auth migration was always a stub for real users. `better-auth` and `@better-auth/passkey` are optional peers of `louise-toolkit`, resolvable only inside this workspace, so the scaffolder's dynamic import succeeded in-tree and failed everywhere else — leaving no `user` table and a printed `seed:editors` step that failed with `no such table: user`. Both are now direct dependencies of `create-astroid`, verified against a true clean-room install; the fallback instructions also moved into the numbered steps, ahead of the migration apply, instead of a note printed below the list.
  - `--commerce` declared a `products` table in `src/schema.ts` that no migration created. `generateCatalogMigrationSql` emits it from the same `astroidCatalogMirror` declaration the Drizzle schema comes from, so the two cannot describe different shapes.

  **`checkoutIdempotencyKey` takes a required `identity` (BREAKING).** The key was derived from the verified cart alone, so two different customers buying the same items at the same price produced byte-identical keys. Providers scope idempotency keys per account and retain them ~24h, so the second buyer's charge was deduped into the first buyer's order: no second charge, no second order, and a success page. On a single-SKU storefront that is ordinary traffic. `scope` was never an identity — its own test fixes it as `"order"` vs `"refund"` — so the fix is a third parameter carrying a cart id, checkout-session id, or user id. It is required and empty is refused, because a falsy default would restore the collision silently.

  **Failures that reported success.** `astroidCatalogSync` swallowed every per-item error and returned `{ created: 0, updated: 0 }`, which is indistinguishable from an empty catalog — so an unapplied migration or an unavailable D1 meant the queue consumer acked, the cron re-sync acked, and the site served a frozen catalog with nothing in `wrangler tail`. The result now carries `failed` and `errors`, and a _total_ failure throws so the queue's retry and DLQ do their job; partial failures still don't throw, because tolerating individual items is the point. `sendTransactional` likewise built a `{ delivered: false, reason }` that only the dormant path ever logged, while the generated inquiry handler discards results by design — a dead sending domain produced silence everywhere. Genuine delivery failures are now logged.

  **The dormant mailer no longer prints live magic links in production.** `logOnly` turns on whenever `MAIL_FROM` is unset, which happens on a deployed Worker with an unset secret or a failed Secrets Store read — and the log dump included the plaintext body, i.e. single-use sign-in and password-reset URLs, in `wrangler tail` and every Logpush sink. The body is now printed only where the environment reads as development, with an explicit `devLog` escape hatch; everywhere else the log still records that a message went unsent, and why, without the credential. Detection is deliberately conservative — an environment it can't identify reads as production — so `astro dev` (and therefore `astroid dev`, plus vitest) still prints the link, while a bare `wrangler dev` needs `devLog: true`. The withheld-body message says exactly that. Erring toward a missing convenience beats erring toward a leaked credential.

  **The scaffolded portal reset email goes through `resolveMailer`.** It hand-built its `MailerOptions`, bypassing the only thing that applies the `DUMMY_REPLACE_ME` sentinel check — so a fresh deploy with a real EMAIL binding but a placeholder `MAIL_FROM` called the Email API with an envelope sender of literally `"DUMMY_REPLACE_ME"`, was rejected upstream, swallowed, and reported to the user as a reset email sent.

  **`portal.gated` now throws instead of doing nothing.** It was accepted, resolved onto `ResolvedPortal`, and read nowhere — the guard table is built from `portal.routes` and `portalGuard` allows any unmatched path. A site setting it believed the whole site sat behind a login while every page outside `/portal` was public, and it type-checked. Until it is wired, `defineAstroid` refuses it and names the workaround: a security control that silently does nothing is worse than one that isn't offered.

  **`astroid deploy --dry-run` no longer mutates the working tree.** The regenerate step sat above the dry-run guard, so a command whose last line is `(dry run — nothing executed)` had already rewritten the trio and discarded any local edits to it — and probing the plan on a working branch is precisely when those edits exist.

  **Provisioning Turnstile no longer locks the owner out of their own site.** `getLouiseAuth` registers Better Auth's captcha plugin on `/sign-in/magic-link` as soon as both halves of the pair are real, and that plugin rejects any request without an `x-captcha-response` header — but the scaffolded login page rendered no widget and sent no token. So following `.env.example`'s own instruction ("Get a real pair at dash.cloudflare.com → Turnstile") produced a 403 on every sign-in attempt with nothing to explain it. The page now renders the widget under exactly the condition the server arms the check (`turnstileSiteKey`, which returns null for the always-passing test key — the same test `activeCaptchaSecret` applies) and forwards the token in that header. The README's claim about the both-halves-real rule was true for the _secret_ pair and silent about the missing widget; it now describes both, and says plainly that the public contact form is a separate surface with no captcha.

  **The editor dashboard, the draft buffer, and delete-safety are wired.** Three routes were mounted and returning 200 while missing the one option that made them do anything. `overviewRoute` was absent entirely, so the drawer's Home panel — `mountSettings` defaults `home: true`, and Home is the initial overlay — was the first screen an owner saw and it fetched a 404; it now ships with a content resolver counting drafts, unpublished changes, and the last edit. The `inbox` slice is deliberately left out: the inquiries table has no read-state column, so an "unread" count could only be the total, a number that never goes down. `versionsRoute` now receives `bufferKv: (env) => env.DRAFTS`, so the KV namespace the setup instructions have you create is actually written to. `mediaRoute` now receives `referenceSources` for `pages` and `site_settings`, so deleting an asset that is live on a page warns instead of silently breaking it.

  **Four `ModuleKind` values that wired nothing are removed** — `orderTracking`, `subscriptions`, `giftCards`, and `privateLabel` type-checked, passed validation, and had no consumer anywhere: no scaffold, no CSP origin, no rate rule, no table. Re-add each in the change that implements it.

  **CI now compiles and runs what it used to only generate.** The smoke test scaffolds `--portal` (so `src/portal-auth.ts` and the portal auth catch-all are type-checked at all — the portal's unit tests assert generator output as strings and never compile it), and applies every migration to a throwaway SQLite database, asserting each table the generated schema reads exists. Nothing ran that SQL before, which is why a `products` table with no migration survived.

  **Documentation that described code we don't ship.** Both README examples still listed `marquee`, `featured`, `story`, and `visit` — the four section names removed in #277, which the test suite asserts are dead — so the flagship copy-paste example was a compile error; the same stale example survived in the `defineAstroid` JSDoc. The README also advertised Turnstile as a shipped worked example when only the secret names and CSP origins exist, and `create-astroid`'s README omitted `--map`, `--pwa`, and `--portal`.

- 163a005: Add the PWA scaffold (#259): a scoped service worker, a derived manifest, and `<RegisterSW>` — opt-in via `modules: ["pwa"]`.

  **The scoping is the design, not a detail.** A Louise site is CMS-edited: someone signs in, flips edit mode on, and edits the live page in place. A service worker caching HTML across the whole origin would serve that editor a stale copy of the page they're trying to change — and the bug would present as _"my edits don't save"_, about as far from the cause as a report can get.

  So the generated worker refuses to touch anything dynamic, even inside its own scope:

  - `/api/*` — checkout, auth, and every Louise write. A cached POST response or a stale session is a correctness bug, not a speedup.
  - editor and auth routes — the studio must always be live.
  - **any URL carrying `?louise`** — that marks an edit-mode request, and caching one poisons it.

  Outside the scope it doesn't intercept at all, which is why a narrower scope (`"/order"`) is usually the right answer: it keeps the worker off the marketing pages entirely.

  Everything else is the ordinary split — navigations network-first with the cached page as the offline fallback, hashed `/_astro/*` assets cache-first since their names change when their content does. The precache is `allSettled`, so one 404 in the shell can't fail the install and leave the app with no worker at all; the cache name carries the project key, so two Astroid apps on one origin can't read each other's entries.

  The manifest derives from the brand — name, theme colour, scope — and declares `any` and `maskable` icons as separate assets, because the platform crops a maskable icon to its own shape and the artwork needs padding the plain one shouldn't have. Icons are declared but not generated: a scaffold can't invent a brand's icon, and emitting placeholders would produce an installable app with a grey square for a face.

  `<RegisterSW>` is a bundled `<script>`, never inline, so Astro hashes it into `script-src` and it works under the strict CSP. The scope rides on a `data-` attribute rather than being interpolated, since `define:vars` forces `is:inline` and per-render content can't be hashed. Registration failures are logged rather than swallowed — the app works without a worker, but a scope or MIME misconfiguration should be findable.

  One deliberate difference from the reference: **`Service-Worker-Allowed` is not emitted.** That header is only needed for a scope _broader_ than the script's own location, and `sw.js` sits at the root, so every scope is narrower. The reference sets it anyway (its own code comment explains why it's unnecessary) — harmless, but it implies a requirement that isn't there and will mislead whoever later moves the script.

- 71aafa2: Add the realtime module (ADR 0002 / #71) — live multi-editor editing on a page, opt-in via `modules: ["realtime"]` or `--realtime`.

  The package description has advertised "multi-editor sites" since 0.1.0. That was true for the _org_ axis — many editor accounts — and false for the one people mean: two editors on the same page. Without a live channel they clobber each other; the server-side draft merge narrows the window but there is no presence, no field sync, and no signal that someone else is in the same field. `louise-toolkit/realtime` had shipped the session logic and the upgrade route; nothing generated the Durable Object, the binding, or the migration that make them reachable.

  Astroid now generates all three, plus `realtimeRoute` in the worker and the client opt-in on the boot marker. The DO subclass is scaffold-once (`src/edit-session.ts`) because it must import `cloudflare:workers` — a runtime-only specifier the toolkit can't carry — and because `persist` is the seam a project tunes.

  **It augments rather than replaces.** With the module off, the socket unopened, or the connection dropped, the client falls back to the existing debounced auto-save. And there is still exactly one write path: the session's coalesced flush goes through `applySaveDraft`, the same merge-over-pending-draft the fetch auto-save uses, so drafts, version history, publish semantics, and read-your-writes are unchanged. The DO is a new front end to that path, not a parallel store — which is also why it does _not_ pass `bufferKv`: its alarm is already the coalescer for that page, and the KV write-buffer would be a second layer over one stream of edits.

  Three details are load-bearing and easy to get wrong from memory, so they're generated and asserted in CI rather than left to a reader:

  - The migration block uses **`new_sqlite_classes`**, not `new_classes`. The session keeps authoritative state in `ctx.storage`, and a Durable Object's storage backend cannot be changed after the class is first deployed.
  - The class is **re-exported from the worker entry**. Wrangler resolves a binding's `class_name` against the worker's exports, and the failure is a deploy error that points nowhere near the file that defines it.
  - `realtimeRoute` is imported from **`louise-toolkit/realtime`**, not `/editor`. It is the one factory in the route plan that isn't an editor route; bundling it with the rest type-checks inside this package — the plan is only strings — and fails only in a scaffolded project. The clean-room `astro check` is what caught it.

  The rich-text body takes a soft-lock (one editor at a time) rather than being last-writer-wins clobbered, and locked values are never fanned out to peers, so raw rich text doesn't cross sockets.

- d733db6: Put Astroid's section library on Louise's actual section/block model (ADR 0005), replacing the parallel one it had (#260, part 1).

  **The problem.** Astroid's `<Section>` dispatched on a `kind` prop with `colorway`/`align` as component props and a `SectionProps` union. Louise's model — the one the on-canvas editor and the write-time validator both read — differs in every particular: a section is a stored `SectionItem` (`{ _type, blocks?, _layout?, _settings?, ...fields }`), its shape is declared once as a `SectionDef` in a `SectionCatalog`, and presentation choices are `_settings`/`_layout` **tokens** that Louise stores and the site maps to CSS. Two models meant Astroid's sections could not be edited on canvas at all: nothing called `mountSections`, and no component emitted a `data-louise-sfield` marker.

  **`astroidSectionCatalog`** is now the single declaration of what a section is — the same object `mountSections` edits with and `assertValidSections` validates writes against, so a field can't be editable-but-invalid or validated-but-uneditable. `colorway`/`align` become `_settings` tokens; `COLORWAY_CLASS`/`ALIGN_CLASS` stay as the site-owned half of that contract, so a re-theme still needs no content rewrite. Repeatables stay real arrays (`featureGrid.items`) rather than the `card1…card6` flattening — `base` makes the marker path positional, and the client's path parser is already depth-agnostic.

  **The marker contract splits the way ADR 0005 §2 splits it.** `<Section>` stamps the _boundary_ (`data-louise-section` / `data-louise-block`), because only the dispatcher knows an item's position; components stamp _fields_ via `<Editable base={base} field="…">`, because only the component knows which of its text nodes are editable. A component never learns its own depth, which is what lets the same component render as a section or as a block — blocks recurse through `<Section>` with a deeper `base`.

  **One media lookup per page, not per image.** A section stores an image as a URL, but the `alt`/`caption` an editor typed live on the media asset — so rendering images correctly means joining back to the registry, and doing it per image is thirty D1 round-trips for one gallery. `<Sections>` resolves the whole page in one bounded `IN (...)` (chunked under SQLite's parameter ceiling) and threads the result down. The collection step is schema-driven: it walks the catalog for `type: "image"` fields, including inside arrays and discriminated variants, so a new section with an image is picked up because it _declared_ one — not because someone remembered to update a list.

  The scaffold is wired end to end: the home page renders `<Sections>` from the page's `sections` column (draft-aware in edit mode), `LouiseEdit.astro` mounts the on-canvas editor against the catalog, the seed ships three real sections, and the pages collection sanitizes + validates `sections` on write.

  Two notes on things that bit during this work, both recorded in code:

  - The pages hook loads `assertValidSections` / `sanitizeSectionsRichText` via a **dynamic** import. `louise-toolkit/content`'s sections module reaches drizzle-orm for real (sections → validation → `import { and, eq, ne }`), and drizzle is an _optional_ peer — a static import would put it back in the graph of every caller that only describes content, which is exactly what shipped a broken `create-astroid` to the registry once and why `content/define` exists. Deferring it keeps the CLI drizzle-free while the running site gets real validation. The proper fix is to split the Rule evaluator out of `validation.ts`.
  - `.astro` files are invisible to `tsgo` and vitest, so before this the entire section library compiled nowhere. Now that the scaffold renders sections, CI's `astro check` reads them — and it immediately caught two real errors (`mountSections` takes `(el, opts)`, and `querySelector` returns `Element`, not `HTMLElement`).

  The 11 new section types (Gallery, Media, SplitImage, Steps, Banner, FAQ, PricingTiers, Testimonial, AboutIntro, ProductGrid, LocationHours) land next, on this contract.

- c26fb07: Bake the two stack-wide security concerns every consuming site was re-deriving by hand into Astroid (#253).

  **Rate-limit rules as data.** The limiter mechanism was already in `louise-toolkit/security` and deliberately unopinionated — which routes, which budgets, is policy. But the policy turned out not to vary: all three sites independently wrote the same rule set, same surfaces, same 10-minute windows, budgets within a factor of one of each other, differing only where a site had a surface the others didn't. So `astroidRateRules(config)` now derives the whole set — the editor magic-link always (the email-bombing target, tightest budget), the portal's credential surfaces when `portal.enabled`, checkout when `commerce` is configured. The generated middleware _calls_ it rather than embedding literals, so a `match` predicate survives and enabling a portal needs no regeneration. `security.rateRules` in the config are matched first, which makes them an override seam and not just an append. The session-gated editor API stays out on purpose: a limiter that can lock the owner out of their own studio is worse than the abuse it stops.

  **CSP composition**, via a new `astroidjs/astro` build-time subpath (kept off the main entry — it reaches for `node:crypto` and `solid-js/web`, neither of which belongs in the Worker bundle). `astroidSecurity(config)` supplies `astro.config.mjs`'s `security` block, and the split it encodes is the non-obvious part:

  - **Astro owns `script-src`.** It hashes every script it processes, so the policy carries no `'unsafe-inline'`. What it does _not_ hash is Solid's hydration bootstrap, which `@astrojs/solid-js` injects on every page with an island — without that hash the bootstrap is blocked and islands silently fail to hydrate. Astroid computes it from `generateHydrationScript()`, the same call the renderer makes, so it follows solid-js upgrades instead of going stale as a copy-pasted literal.
  - **The middleware owns `style-src`.** Louise's data-driven `style=""` carriers need `'unsafe-inline'`, and per spec a single hash in `style-src` _voids_ `'unsafe-inline'` — the two cannot coexist in one directive, so it's rewritten per response instead of declared at build time.

  Enabled modules contribute origins (a commerce provider's SDK/iframe/tokenization hosts, the Turnstile frame), and `security.cspOrigins` adds whatever Astroid can't see. `ASTROID_VITE_BUILD` carries `assetsInlineLimit: 0` — an inlined asset is inline, therefore unhashed, therefore blocked.

  Also fixes a real bug in the generated `src/worker.ts`: it imported `./astroid.config.js`, but the config lives at the project root, so the specifier had to be `../astroid.config.js`. Verified end to end by scaffolding a project and building it — the composed policy, including the Solid hash, lands in the built output.

- 1574674: Ship the SEO layer as a first-party Astroid primitive (#255): `<Seo>`, `<StructuredData>`, and origin-aware `robots.txt` + `sitemap.xml`. Two sites had hand-built the same thing, and the parts that were subtle in both are now the parts that are encoded once.

  **`<Seo>`** emits the tags directly rather than wrapping `astro-seo` — there are about fifteen of them, their shapes are frozen by the OG and Twitter specs, and owning them means `resolvePageSeo` is the only place a value can come from. That resolution has two rules worth stating: an **empty string is unset**, so clearing a field in the editor falls back to the site default instead of publishing a blank `<meta>`; and the title template applies only when a page supplies its own title, so the home page reads `Acme Coffee` rather than `Acme Coffee | Acme Coffee`. `site_settings.disableIndexing` is a site-wide kill switch that beats a page asking to be indexed, which is what makes it usable on staging.

  **`<StructuredData>`** emits a schema.org `@graph` — the business, the `WebSite`, and optionally the entity the page is about. The business `@type` is the only genuinely per-site part, so it comes from the archetype (`storefront` → `Store`, `portfolio` → `Person`, otherwise `Organization`) with `seo.businessType` for the many cases where a narrower subtype exists. The business carries a stable `@id` so other nodes reference it instead of restating it. The payload goes through `escapeJsonLd`, not `JSON.stringify`: `stringify` does not escape `<`, so any editor-authored value containing a literal `</script>` would close the tag early and inject markup straight into `<head>`.

  **`robots.txt` + `sitemap.xml`** derive their exclusions from one function (`astroidNoindexPaths`), so they cannot disagree about what is crawlable — the editor and its API always, plus the portal and checkout routes when those modules are on. Both are **origin-aware**, built from the serving origin rather than a configured domain: a preview deploy that advertises the production host invites its content to be indexed under the real domain. Sitemap entries are de-duplicated, sorted, and XML-escaped, since a single unescaped `&` in a slug makes the whole document invalid.

  The scaffold wires all of it: `Site.astro` reads `site_settings` and renders both components, `index.astro` now passes the page's `seo_*` overrides (distinct from `title`, which is the on-page H1), the login page is `noindex`, and the two route files ship as scaffold-once so a site can add its own URLs.

  Verified by building and serving a scaffolded project with **no** bindings provisioned: title, canonical, OG/Twitter, and the JSON-LD graph all render off the config fallback, and `robots.txt`/`sitemap.xml` return valid documents.

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

- 7e49fd4: Fix `pnpm install` failing on a fresh scaffold, and clear two dependency advisories.

  **A scaffolded project could not be installed.** `pnpm install` — step 2 of the README's own Next Steps — exited 1 with `ERR_PNPM_IGNORED_BUILDS`: pnpm refuses to run a dependency's build script until told to, and both `esbuild` and `workerd` need theirs. The template shipped no build approvals, so the first command a new user runs errored.

  It survived because **every test compensated for it**. CI's clean-room smoke step overwrote the scaffold's config and appended its own `allowBuilds`, and the local clean-room scripts copied that same pattern — so the suite proved the scaffold installs _for CI_, and never once for a user. The scaffold now ships its own `pnpm-workspace.yaml` (pnpm 10+ reads settings from that file even for a single package), and CI installs with it instead of replacing it, appending only the tarball pins it genuinely needs.

  **Two dependency advisories** are fixed in the same file, both reaching us only through `better-auth`'s dev-tooling transitives:

  - **esbuild** — SNYK-JS-ESBUILD-17750822, "resources downloaded over insecure protocol", CVSS 9.2, fixed in 0.28.1.
  - **ws** — CVE-2026-62389, unbounded resource allocation, CVSS 8.7, fixed in 8.21.1.

  Worth noting that **`pnpm audit` reports neither**. It reads GitHub's advisory database; Snyk carries its own, and in this case Snyk was right and a clean local audit was not evidence of anything. The first attempt at this fix trusted `pnpm audit`, pinned esbuild to `^0.25.4`, and left a CVSS 9.2 finding in place.

  The esbuild override is deliberately **blanket rather than parent-scoped**. Two paths reach a vulnerable copy — drizzle-kit's own `esbuild ^0.25.4`, and the deprecated `@esbuild-kit/esm-loader` it still ships, whose `core-utils` pins 0.18.20 — so scoping to one parent fixes only half. Blanket is also the cheaper option here: Astro and Vite had already resolved 0.28.1, so this collapses the tree to a single esbuild rather than forcing an unusual version anywhere. The real risk was `@esbuild-kit/core-utils` being written against the 0.18 API, so that was verified rather than assumed: drizzle-kit still reads and transpiles a TypeScript `drizzle.config.ts`, `drizzle-kit generate` still loads the full schema, and the site build still passes.

- 2749050: Make the section catalog the single source of the section vocabulary (#277).

  `SectionKind` was a hand-written union in `config.ts` and the catalog was a separate object, so the two drifted **in both directions**: the union named four kinds with no catalog entry and no component (`marquee`, `featured`, `story`, `visit`), while omitting eight that were real and renderable. Nothing checked the gap, so `create-astroid` wrote archetype defaults listing sections that could never render.

  `SectionKind` is now `keyof typeof astroidSectionCatalog` — a **type-only** import, so `config.ts` gains no runtime dependency and the `create-astroid` CLI's import graph is unchanged.

  That derivation only works because the catalog is now declared with **`satisfies SectionCatalog`** rather than a `: SectionCatalog` annotation. `SectionCatalog` is `Record<string, SectionDef>`, so annotating widens `keyof typeof` to `string` and throws the literal keys away. Those keys are load-bearing in three places — `SectionKind`, `isRenderableSection`'s narrowing, and `<Section>`'s component-map index — and annotating silently degrades all three to "any string". That is exactly how the dispatcher lost its type safety before (fixed in #276 with a cast; the cast is no longer papering over anything).

  **The archetype defaults moved into astroidjs.** They were a plain JS object in `create-astroid`, where a section name that didn't exist was invisible. Typed against `SectionKind`, a stale name is now a compile error — verified by temporarily adding `"marquee"` back and watching the build fail. The four dead kinds are replaced by the sections that actually do their job: a marquee is a `banner`, curated picks are a `productGrid`, a brand-origin block is `aboutIntro`, and "visit" is exactly `locationHours`.

  `capturesInquiries`' `sections.includes("contact")` — the one real consumer of `config.sections` — is now checked against that same union, so renaming the catalog's `contact` entry would fail the build instead of silently scaffolding a site with a contact section and no inquiries table behind it.

### Patch Changes

- f4c33d8: Gate the generated `/api/checkout` route to same-origin, so the one public POST that moves money has the CSRF protection every other public write already had.

  Serving a scaffolded storefront turned this up: a cross-origin, correct-price POST to `/api/checkout` returned 200 and processed (re-priced, and in a provisioned store would charge), while the contact form (`formRoute`) and the vitals beacon both refuse a cross-origin POST with a 403. Checkout — the only endpoint that takes a card — was the only ungated one. The single-use Square card token limits the practical CSRF risk, but the inconsistency is real and a money-moving endpoint should not be reachable cross-origin, if only to stop cross-origin price-probing and rate-budget abuse.

  The generated checkout route now calls `isSameOrigin(request)` first — before parsing the body, re-pricing, or charging — and returns 403 on a cross-origin (or header-stripped) request. `isSameOrigin` is now re-exported from `louise-toolkit/security` (it already lived in `auth/guard`, where the editor gates use it) so a commerce route can import the CSRF check without pulling in the whole auth barrel. Verified served: cross-origin → 403, header-stripped → 403, same-origin → passes (the contact form still 201s, unaffected).

  The route is scaffold-once, so if you deliberately serve checkout from another origin, the gate is one line to relax — it's yours.

- 1ac694c: Enforce the section catalog on every `pages` write path, and answer a rejected write with a 422 instead of a 500.

  Two write paths reach a page's `sections`, and only one of them validated. `versionsRoute` takes the collection `config` and runs its `beforeChange` hook — sanitize, then validate against the catalog. `pagesRoute` takes no config and runs no hook, so a direct `POST` / `PATCH /api/louise/pages/:id` — the path the on-canvas _structural_ edits go through — persisted an unknown section `_type`, a `_settings` token outside its declared options, or unsanitized section rich text. `<Sections>` then skipped the bad `_type` at render time, so the section silently vanished with no error anywhere; the rich text (`faq.items[].answer` is `richText`, rendered with `set:html`) reached the public page with CSP as the only remaining defence. The generated worker even carried a comment claiming "every route below inherits" the validation — it didn't.

  Astroid now derives the same sanitize + validate from the collection config and wires it into `pagesRoute`'s `sanitize` / `transform` / `validate` seams via a new `astroidPagesWriteHooks(config)`, spread into the generated route. Both write paths now enforce one contract, from one source — the collection's `beforeChange` hook is refactored to share the exact primitives (`sanitizeAstroidPageSections`, `assertAstroidPageSections`), so they cannot drift.

  Separately, `versionsRoute` returned a raw **500** when the collection hook rejected a draft: `applySaveDraft` only translated a `LouiseValidationError` thrown by its own `validate` option into a 422, while the identical error thrown from inside `api.saveDraft`'s hook escaped uncaught. It leaked at two call sites — the `POST /:id/versions` save, and the buffer flush at the start of `POST /:id/publish` (a coalesced auto-save that the KV write-buffer answered 200 without validating is validated for the first time there). Both now catch a `LouiseValidationError` from the hook and return the same 422 with per-field violations; a non-validation throw (a real DB fault) still propagates as a 500, honestly. The invalid content was always kept off the live page — this is about giving the editor the violations instead of a 500.

  Found by serving a scaffolded site on `wrangler dev` and exercising the routes over HTTP — none of it was visible to the unit suites, `astro check`, or `astroid doctor`. The four behaviours are asserted served in CI's scaffold live-smoke leg, and the `pagesRoute` wiring + the shared sanitize/validate are unit-tested in `astroidjs`.

- cad91a8: Fix three scaffold gaps found by building and serving a fresh site: the section colorway/alignment tokens never rendered, the contact links were dead, and the SESSION_SECRET guidance was wrong for a local `wrangler dev` preview.

  - **The `_settings` token contract was a silent no-op.** Astroid's section components ship as source inside `node_modules`, and Tailwind v4 doesn't scan `node_modules` — so `bg-primary`, `text-primary-content`, `items-center`, and every other colorway/alignment utility was absent from the built CSS. A section set to `colorway: "brand"` rendered on the default background; only `btn-primary` looked right, because daisyUI ships that as component CSS. `src/styles/site.css` now `@source`s the astroidjs components so those utilities are generated.
  - **A dead `/contact` link out of the box.** The `contact` section (and the default hero/cta) link to `/contact`, but no such page was scaffolded. The template now ships `src/pages/contact.astro` — a progressively-enhanced form that posts to the generated `formRoute` (honeypot + min-time + rate limit + validation), with submissions landing in the editor's Inquiries tab.
  - **`.env.example` said "empty SESSION_SECRET is fine on localhost"** — true under `pnpm dev` (astro dev serves on localhost), but a local `wrangler dev` preview of the built worker routes the request through the `hosts` domain, so the dev fallback never fires and every editor route 500s. The comment and README now call out that case.

  Also documents two behaviours that surprised the first run: a raw-SQL-seeded page isn't in the full-text index until a publish or `POST /api/louise/pages/reindex`, and `seo_title` is run through the config's title template (so set the page part only, not `"Page | Brand"`).

- d3fd13d: Use pnpm consistently in every documented command. The repo pins pnpm via `packageManager` and its own scripts already used it, but the published READMEs, the `create-astroid` help text, and the `astroid` CLI banner still told users to run `npm` — including `npm run doctor` in `create-astroid`'s README while the template README it scaffolds said `pnpm doctor`.

  Install lines become `pnpm add`, one-off binaries become `pnpm exec`, and `npm create astroid` becomes `pnpm create astroid` (which also drops npm's `--` argument separator, since pnpm forwards flags directly).

  References to npm _the registry_ are left alone — "shipped to npm", "the npm package", "not an npm dependency" are all still accurate, and rewriting them would make them wrong.

- Updated dependencies [86896b6]
- Updated dependencies [5b227b5]
- Updated dependencies [09a5e01]
- Updated dependencies [f4c33d8]
- Updated dependencies [29b5c1c]
- Updated dependencies [6d99c52]
- Updated dependencies [2652929]
- Updated dependencies [d2f625d]
- Updated dependencies [5f49ec2]
- Updated dependencies [481884e]
- Updated dependencies [1ac694c]
- Updated dependencies [cad8084]
- Updated dependencies [5b227b5]
- Updated dependencies [163a005]
- Updated dependencies [71aafa2]
- Updated dependencies [0d3ef34]
- Updated dependencies [d733db6]
- Updated dependencies [c26fb07]
- Updated dependencies [1574674]
- Updated dependencies [b54e39f]
- Updated dependencies [407c861]
- Updated dependencies [0a93ce6]
- Updated dependencies [b93d6d1]
- Updated dependencies [d3fd13d]
- Updated dependencies [ff5ab79]
- Updated dependencies [2749050]
- Updated dependencies [5b227b5]
  - astroidjs@0.2.0
  - louise-toolkit@0.16.0

## 0.1.2

### Patch Changes

- Updated dependencies [6c6064b]
- Updated dependencies [6c6064b]
  - astroidjs@0.1.2
  - louise-toolkit@0.15.0

## 0.1.1

### Patch Changes

- Fix `npm create astroid` failing with `ERR_MODULE_NOT_FOUND: Cannot find package 'drizzle-orm'` in a clean environment.

  `astroidjs` calls `defineCollection` from `louise-toolkit/content` at runtime, and that entry pulls in the content validation module, which imports `drizzle-orm` for its uniqueness queries. `drizzle-orm` is an _optional_ peer of `louise-toolkit`, so npm never installed it — meaning anyone running `npm create astroid` (or importing `astroidjs` outside this workspace) crashed before the scaffold produced anything. It went unnoticed because the CI scaffold test runs inside the workspace, where `drizzle-orm` is already present as a dev dependency.

  `astroidjs` now declares `drizzle-orm` as a real dependency, which is what its import graph actually requires; `create-astroid` picks it up transitively. The underlying sharpness — that importing `defineCollection` from the `louise-toolkit/content` barrel drags the drizzle-dependent validation chunk with it — is worth splitting up separately.

- Updated dependencies
  - astroidjs@0.1.1

## 0.1.0

### Minor Changes

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

- 561775e: Scaffold the deploy paths (#104). The generated README now leads with two
  low-friction options — a **Deploy to Cloudflare** button (zero-CLI: Cloudflare
  clones the repo, provisions the bindings declared in `wrangler.jsonc`, and deploys)
  and **`astroid deploy`** (one command: provision + migrate + secrets + deploy) —
  with the by-hand `wrangler` steps kept as the fallback.
- 910a5dc: New package: `create-astroid` — the one-command scaffold for a new Astroid site
  (#104). `npm create astroid@latest my-site` writes the floor: the typed
  `defineAstroid` config, the generated schema/worker/middleware trio +
  `wrangler.jsonc` (via `astroidjs`), the Better Auth migration (via
  `louise-toolkit`), a content migration + FTS, DB-managed editor auth (`src/auth.ts`
  - the `/api/auth` catch-all + a `seed-editors` bootstrap), and a baseline Astro app
    (Cloudflare adapter, Solid, Tailwind + daisyUI). Interactive prompts or flags
    (`--key`, `--name`, `--archetype`, `--color`, `--host`); binding ids are
    placeholders that `astroid doctor` flags until provisioned.

  The floor is **editable in the browser**: a `/login` magic-link page and a
  `LouiseEdit` component that boots the edit bar + the Settings drawer
  (Pages/Media/Settings/Users) in edit mode. The home page's **title and body are
  inline-editable in place** via Astroid's `<Editable>` primitive — edits stage a
  draft, Publish promotes it. A seeded `home` page row (`seed/home.seed.sql`) makes
  it work out of the box.

### Patch Changes

- Updated dependencies [c182412]
- Updated dependencies [56821bc]
- Updated dependencies [6fa4f98]
- Updated dependencies [78dd012]
- Updated dependencies [0039440]
- Updated dependencies [3146ec8]
- Updated dependencies [afe5ba1]
- Updated dependencies [c39466b]
- Updated dependencies [f623ccb]
- Updated dependencies [4c18d45]
- Updated dependencies [38b8b81]
- Updated dependencies [561775e]
- Updated dependencies [47df5c4]
- Updated dependencies [43a31f0]
- Updated dependencies [1711a45]
- Updated dependencies [9b5b9c3]
- Updated dependencies [af0cb91]
- Updated dependencies [5383051]
- Updated dependencies [50cee46]
- Updated dependencies [0e9acbd]
- Updated dependencies [9e07377]
- Updated dependencies [40b8e0e]
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
  - astroidjs@0.1.0
