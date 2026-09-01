# astroidjs

## 0.9.5

### Patch Changes

- Updated dependencies [76e38bc]
- Updated dependencies [4467706]
- Updated dependencies [afdddf7]
- Updated dependencies [2227153]
- Updated dependencies [b643c3e]
- Updated dependencies [bea4d08]
- Updated dependencies [7b71572]
- Updated dependencies [ca92147]
- Updated dependencies [54ce5ea]
- Updated dependencies [4aa52e9]
  - louise-toolkit@0.27.0

## 0.9.4

### Patch Changes

- Updated dependencies [6711c1c]
  - louise-toolkit@0.26.0

## 0.9.3

### Patch Changes

- Updated dependencies [67189d1]
- Updated dependencies [9137487]
  - louise-toolkit@0.25.3

## 0.9.2

### Patch Changes

- b35d566: fix(worker): the generated media route never matched, 404-ing every uploaded asset

  `mediaAssetRoute` guarded with `url.pathname.startsWith(\`${MEDIA_BASE}/\`)` —
  a pathname compared against an origin, which is false for every request that
  can exist. The route therefore never ran on any generated site: requests to the
  media host fell through to the SSR handler and every uploaded image, on every
  page, answered with the site's own 404 page.

  The guard now matches `url.origin` against `MEDIA_BASE` and takes the whole
  pathname as the R2 key. Sites pick this up by regenerating (any `astroid dev` /
  build) — no config or content change.

## 0.9.1

### Patch Changes

- Updated dependencies [c1c7b0f]
  - louise-toolkit@0.25.2

## 0.9.0

### Minor Changes

- c0b36b7: Add `media.maxUploadBytes` — the media library's upload ceiling is now configurable.

  The generated `mediaRoute(...)` call was a fixed string with no `maxBytes`, so every project was pinned to louise-toolkit's 10 MB default and had no seam to change it: hand-editing the generated worker is undone by the next `astroid generate`.

  That default is wrong for the projects where the masters ARE the product — a painter's or photographer's portfolio uploads 40 MB camera files and serves only Cloudflare-resized derivatives, so the master's size costs storage, not page weight.

  ```ts
  export default defineAstroid({
    // …
    media: { maxUploadBytes: 40 * 1024 * 1024 },
  });
  ```

  Omitted, nothing changes: the generated line is byte-identical to before and the route keeps `DEFAULT_MAX_BYTES`.

  Validated at generate time rather than in production: a value above Cloudflare's 100 MB request-body limit is rejected with an explanation (the edge drops an oversized body before the Worker runs, so the media route never gets to return its own 413), as are zero, negatives, and non-integers — the last catching the common megabytes-not-bytes slip.

## 0.8.2

### Patch Changes

- 6eaa562: **The host rewrite no longer drops the query string.**

  The generated rewrite built its target from `context.url.pathname` alone, so
  every search param was discarded on a tenant or app host. `?page=2`, `?sort=`,
  a campaign tag, `?qr=1` — all silently gone, while the same page on the apex
  path form kept them. Nothing errors; the page just renders as though nobody
  asked for anything.

  It bites hardest on an app host running a routed island. Typed search params
  are the reason to reach for a router in an admin UI at all — filter, sort and
  pagination live in the URL — and on a full page load or a shared deep link
  they were being stripped before the app ever saw them.

  Both branches now carry `context.url.search`. A rewrite chooses which _page_
  renders; it does not get to edit what was asked of it.

  Found on themidwestartist.com while wiring QR attribution, where `?qr=1`
  reached the apex form and never the storefront's own host.

## 0.8.1

### Patch Changes

- 7624fc1: **The host rewrite no longer swallows API routes.**

  `tenancy`'s rewrite applied to every path, including `/api/*`. That is wrong in
  a way that is very hard to see: an API route is addressed absolutely by
  whatever calls it and reads the host from `locals.tenant`, so rewriting it
  moves it somewhere no route matches — and on an **app host with a catch-all
  page** (`tenancy.apps` + `[...path].astro`, i.e. exactly the studio shape
  `mountStudio` encourages), the _page_ answers instead. `fetch("/api/…")` then
  returns HTML, or a redirect to a sign-in, and every data load on that host
  fails silently while the identical code works on the apex.

  Found in production on themidwestartist.com: the studio loaded at
  `studio.example.com` and then fetched nothing, because `/api/louise/*` was
  being rewritten into `/studio/api/louise/*` and answered by the studio's own
  catch-all page.

  `TenancyConfig.rewriteExclude` now defaults to `["/api"]`, checked before both
  the app and tenant branches. Matching is segment-aware, so `/api` covers
  `/api/x` but never `/apiary`. Set `[]` to restore the old behaviour, or add
  prefixes for other host-agnostic surfaces (`/_actions`, `/webhooks`).

  New pure export `isRewriteExcluded(pathname, exclude)` so a site can unit-test
  its own list.

## 0.8.0

### Minor Changes

- 38e2eb4: **`TenancyConfig.apps` — first-party apps on their own subdomain labels.**

  `apps: { studio: "/studio" }` serves `studio.example.com/<path>` from
  `src/pages/studio/<path>`, closing the gap the PWA config already assumed was
  closed: `PwaConfig.emitDir`'s docs describe "a PWA served from its own
  subdomain that rewrites to a path prefix", but nothing could express that
  rewrite. A reserved label renders the ordinary site — which turns the admin
  host into a second copy of the marketing homepage — and a tenant label goes
  through `resolveTenant` and rewrites to `${rewritePrefix}/<slug>`, which is
  both the wrong path shape and a per-request lookup for an app that exists
  whether or not any tenant does.

  An app label is **implicitly reserved**: `tenantLabel` never offers it to
  `resolveTenant`, and listing it in `reserved` too is refused at config time —
  one list per fact, or the two drift. The generated middleware checks the
  static map first, inside the same `rewrite` hook the tenant dispatch uses, so
  ordering guarantees (after `guard`, outside `extend`'s try/catch) carry over
  unchanged.

  New pure export `appPrefix(host, tenancy)` mirrors `tenantLabel`'s host
  handling (port and case ignored, one label only), so `wrangler dev` behaves
  like production and a site can unit-test its app map without standing up a
  request.

  Three config-time refusals, each for a failure that otherwise surfaces as the
  wrong page with nothing pointing back at the config: a dotted app label (the
  wildcard matches one level), a label in both `apps` and `reserved`, and a
  prefix that isn't `/name`-shaped (the rewrite is `prefix + pathname`, so `"/"`
  or a trailing slash produces `//…`).

- 38ae25d: **`TenancyConfig.unknown: "404"` — an unknown tenant host can now refuse instead
  of falling through.**

  `resolveTenant` returning `null` has always fallen through to the ordinary
  site, and the scaffold told you to "refuse it in the middleware's guard" if
  that was wrong for your project — but the middleware is generated, so there was
  no site-owned place to put that refusal. The moment tenant hosts are commercial
  surfaces, fallthrough is the wrong answer: a stranger who points a CNAME at
  your zone gets your homepage under their name.

  `unknown: "404"` emits a guard that refuses any syntactically-valid tenant host
  whose lookup resolved to nothing. It composes with the portal guard into ONE
  guard function (a second `guard:` key would silently shadow the first), runs
  after `extend` (so it reads the `locals.tenant` the lookup wrote) and before
  `rewrite`, per the #307 ordering guarantees. Reserved labels, app labels, the
  apex, and off-pattern hosts are never affected — `tenantLabel` returns `null`
  for all of them, so they are not tenant candidates.

  The default stays `"fallthrough"`, unchanged. The split of responsibilities is
  deliberate: `resolveTenant` decides _what exists_; the config decides what
  not-existing _means_ — visible in `astroid.config.ts` rather than buried in a
  seam.

### Patch Changes

- Updated dependencies [2a16348]
- Updated dependencies [3bae09a]
  - louise-toolkit@0.25.1

## 0.7.2

### Patch Changes

- Updated dependencies [50ecd8d]
  - louise-toolkit@0.25.0

## 0.7.1

### Patch Changes

- Updated dependencies [cc5cc4b]
- Updated dependencies [934676d]
- Updated dependencies [eb6ff81]
- Updated dependencies [24335e9]
- Updated dependencies [fa9e636]
  - louise-toolkit@0.24.0

## 0.7.0

### Minor Changes

- e56d546: **`AstroidConfig.crons` — more than two scheduled triggers.**

  `astroidCrons()` returned exactly two expressions and the generated `scheduled`
  handler dispatched on those two literals, so a project needing a third had two bad
  options: add it in the Cloudflare dashboard, where it drifts from the
  `wrangler.jsonc` that is supposed to describe the deploy; or add it to
  `triggers.crons`, where the generated dispatch never matches it and Cloudflare
  fires an invocation that does nothing, with no error anywhere.

  ```ts
  crons: [
    { expression: "*/15 * * * *", message: { kind: "inventory_pull" } },
    { expression: "30 3 * * *", message: { kind: "nightly_reconcile" } },
  ],
  ```

  Each entry is emitted into **both** `triggers.crons` and the dispatch, from the
  same list, so the two cannot drift. `scripts/ci/checks/crons-dispatched.mjs`
  already enforces that agreement against a real scaffold; there is now a unit test
  asserting the same invariant.

  The message is **enqueued, never run inline**, so the work takes the same retry
  and DLQ path as everything else and a slow job can't hold the scheduled handler
  open. It is typed `unknown` because the consumer owns the message vocabulary —
  whatever you put there arrives at your `handleQueueMessage`'s `onMessage`.

  **Two config-time refusals**, both for failures that are otherwise silent:

  - **A duplicate expression.** One handler dispatches on `controller.cron` in
    order, so a cron colliding with the health scan, the catalog re-sync, or another
    entry never reaches its own branch — the first wins, and the config reads as
    though both are live. This is the exact unreachable-trigger failure the feature
    exists to prevent, so it refuses rather than reproduces it.
  - **Crons without the queue consumer.** A cron's work is enqueued, so without one
    the generated handler would `send` to a binding the project never creates.

- 660a433: **`PwaConfig.offlineFallback` and `PwaConfig.emitDir`** — the two gaps blocking a
  PWA scoped to something other than the site root.

  **`offlineFallback`.** The generated service worker's navigate catch fell back to
  `caches.match(SCOPE)` — the _dynamic app shell_. On an auth-gated app that is
  precisely the wrong thing to precache: the response carries `Cache-Control:
no-store`, so either nothing is cached and the offline fallback is empty, or a
  signed-in shell is stored and later served to whoever opens the app next. Point
  this at a prerendered page instead; it is precached with the shell, since a
  fallback fetched on demand is a fallback that isn't there when the network is.

  **`emitDir`.** `sw.js` and the manifest were written to `public/` unconditionally.
  A PWA served from its own subdomain that rewrites to a path prefix
  (`studio.example.com/` → `/studio/`) has the browser fetch `/sw.js` at _its_ origin
  root, which rewrites to `/studio/sw.js` — so a worker at the public root is a 404
  with nothing to explain it.

  ```ts
  pwa: { scope: "/studio", emitDir: "studio", offlineFallback: "/offline" },
  ```

  The `_headers` stanza moves with the files (its `no-cache` rule is what stops a
  bad worker sticking around, and a stanza pointing at a path nothing serves sets
  headers on nothing), while `_headers` itself stays at the public root, where
  Cloudflare reads it. Its append-once marker moves too, so switching `emitDir` on
  rewrites the stanza rather than appending a second one.

  With `scope` equal to the serving path, no `Service-Worker-Allowed` header is
  needed — a worker may always control its own directory and below.

- 71cc1d7: **Fixed: one provider's webhook could storm another provider's API.**

  `astroidQueueHandler` ran the site's `refreshCatalog` seam for any webhook whose
  event type matched the sending provider's catalog prefixes. But the seam is
  provider-blind by construction — it re-syncs whichever catalog _that site_ uses,
  which is not necessarily the provider that sent the event.

  Two commerce providers is now a supported configuration, and that is where it
  bites. A site running Fourthwall as its storefront and Square as its POS means
  `refreshCatalog` re-pulls Fourthwall — while Square emits `inventory.count.updated`
  on **every single sale**. Each in-person transaction therefore triggered a full
  Fourthwall re-sync against an unrelated provider's rate limit. The periodic refresh
  is unaffected, so the site looks healthy right up until the day it's busy.

  Two additive changes, no break:

  - **`refreshCatalog` now receives the message that triggered it** —
    `(message: AstroidQueueMessage) => void | Promise<void>`. A zero-argument seam
    stays valid, so existing consumers compile and behave identically.
  - **`catalogProvider`** scopes the dispatch. Set it and only that provider's
    webhooks trigger a refresh; leave it unset and any catalog-affecting webhook
    does, which is what every single-provider project already gets.

  The periodic `catalog_refresh` is deliberately never scoped — it is the safety net,
  and a safety net with an exception is not one.

  The scaffolded `src/queue.ts` now emits `catalogProvider` for projects configured
  with more than one commerce provider, set to the storefront's, so the two-provider
  case is wired correctly on the way in rather than discovered on a busy Saturday.

- d7b0277: **Location-scoped pricing: `ScopedPriceLookup`, `verifyCheckout` scope, an
  `"out-of-stock"` refusal, and a location-aware Square adapter.**

  One catalog sold through several merchants carries a different price per
  location — each shop's commission absorbed in its own Square
  `location_overrides` entry. Nothing in the checkout path could see that
  dimension, so a cart was re-priced against **base** prices no matter which
  storefront it came from: a customer could pay the cheapest merchant's price at
  the dearest merchant's shop. That is the same exploit as trusting the client's
  `unitPriceCents`, one level further back.

  All additive; a single-location store changes nothing.

  - **`ScopedPriceLookup = (ids, scope?) => Promise<Map | ScopedPrices>`.** A plain
    `PriceLookup` stays assignable — fewer parameters, narrower return.
  - **`verifyCheckout(lines, lookup, { scope })`** passes the scope through to the
    lookup.
  - **`"out-of-stock"`** joins the refusal union. A lookup reaches it by returning
    `{ prices, outOfStock }`; a bare `Map` can't express it and guessing would put
    the wrong sentence in front of a customer. Delisted is gone and should leave
    the cart, sold out is coming back and is worth a notify-me. Stock is checked
    **before** price, because a sold-out variation is usually still priced.
  - **`squareToCatalogItem(item, { locationId })`** replaces `Math.min` over every
    variation. It drops variations the merchant doesn't carry and prices the rest
    through their overrides. The headline number is scoped for the same reason the
    variants are: `price` means "from", so computing it over the whole catalog
    advertises a price this merchant will never honour — and since the dropped
    variation is usually the cheap one, the error runs in the direction a customer
    notices at the till.
  - **`squareItemSoldAt(item, locationId)`** is new, because the adapter can't skip
    a row for you — it returns one item, and "don't store this" isn't a
    `CatalogItem`. Without the guard an unstocked item mirrors as a $0 card.

  **Also fixes the generated checkout route under `square: { locations: "multi" }`,
  which charged against an ambient location id that does not exist.**

  `commerceProviderCredentials` deliberately drops `SQUARE_LOCATION_ID` for
  multi-location projects, on the stated grounds that any path defaulting to an
  ambient id "would ring one merchant's sale against another merchant's books, and
  the sale would look perfectly successful while doing it." The scaffold was
  exactly such a path: it emitted `locationId: env.SQUARE_LOCATION_ID ?? ""` — a
  var the project is told not to set — so the charge either failed outright or, if
  someone set the var to quiet it, credited one location for every merchant's
  sales.

  Multi-location now generates a route that:

  - resolves the merchant in a `resolveLocationId(request)` you fill in, from the
    **host**, and refuses the checkout when it returns `null` rather than falling
    back to a default;
  - re-prices at that location live from Square via `retrieveVariationPricesAt`,
    because the D1 mirror holds one price per item and structurally cannot answer
    "what does this cost here";
  - charges the same location it priced against;
  - runs the **dormancy gate before verification** rather than after — per-location
    re-pricing is itself a Square call, so the old ordering would have the
    enforcing step break the rule it enforces ("never call Square with a dummy
    credential"). An unprovisioned multi-merchant store therefore can't do the
    staleness check at all, and says so (`priced: false`) instead of echoing the
    client's total back as though the server had agreed to it.

  `SquareCard.astro` takes `locationId` as a prop there too. Single-location output
  is byte-identical to before.

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

- dc33db0: **Declare the `astro` dependency astroid has always had.**

  `astroidjs` imports `astro`, `astro/types` and `astro:actions`, and ships 25
  `.astro` components — while declaring `astro` nowhere: not a dependency, not a
  peer, not even a dev dependency. Its own typecheck passed only because `astro`
  hoisted out of `louise-toolkit`'s devDependencies in the workspace.

  That is invisible today and load-bearing tomorrow. In a scaffolded project it
  happens to work, because `create-astroid`'s template pins `astro` itself and the
  installer resolves it from there. What it costs is the two things a peer
  dependency is for: nothing tells you which Astro versions this package actually
  supports, and nothing complains when you install it somewhere Astro isn't. And
  the moment astroid stops living beside louise in one workspace (#327), the hoist
  disappears and its typecheck has no `astro` to resolve at all.

  Now declared as an optional peer at `^7.0.9` — matched to what the template pins,
  which is the version astroid is actually built and smoke-tested against — plus a
  devDependency so the package typechecks on its own rather than on a neighbour's
  graph.

  Optional rather than required because `astroidjs` has a real non-Astro surface
  (`defineAstroid`, the queue handler, the commerce and tenancy helpers) that runs
  in a plain Worker, and a required peer would make that an install warning for no
  reason.

- 71cc1d7: **The scaffolded queue consumer now says to turn Square's retry on.** `SquareConfig.retry`
  has existed since the multi-location wave, off by default so an attended checkout route
  keeps failing fast — a customer watching a spinner is better served by an error than by
  three silent backoffs. The queue consumer is the exact inverse: nobody is watching, and a
  rate-limited catalog push that gives up halfway leaves the site serving a half-applied
  catalog.

  That distinction lived only in a source comment on the library side, so the one place it
  actually matters — the `refreshCatalog` seam a project fills in — never mentioned it. The
  scaffolded `src/queue.ts` now does, with the Square-specific form when Square is the
  storefront provider and a generic note otherwise.

  Comment-only in generated output; no behaviour change to existing projects.

- Updated dependencies [71cc1d7]
- Updated dependencies [e56d546]
- Updated dependencies [71cc1d7]
- Updated dependencies [1cf8d2e]
- Updated dependencies [2164d91]
- Updated dependencies [71cc1d7]
- Updated dependencies [71cc1d7]
- Updated dependencies [71cc1d7]
- Updated dependencies [7a08f74]
- Updated dependencies [7a08f74]
- Updated dependencies [89a9afb]
  - louise-toolkit@0.23.0

## 0.6.0

### Minor Changes

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

### Patch Changes

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

- Updated dependencies [8725ab4]
- Updated dependencies [a684acc]
- Updated dependencies [2e6ebe3]
- Updated dependencies [153c5ba]
- Updated dependencies [f02c87a]
  - louise-toolkit@0.22.0

## 0.5.0

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

### Patch Changes

- f598e61: The scaffolded `MapEmbed.astro` now logs when its map fails to load. Its
  IntersectionObserver called an `async init()` that nothing awaited and nothing
  caught, so a failed `maplibre-gl` / `pmtiles` chunk fetch — a page load racing a
  deploy is enough — was a silent unhandled rejection: the container stayed an
  empty tinted box with nothing in the console to explain it. The call site now
  catches and logs `[astroid:map] map failed to load`, matching the convention the
  commerce card scaffold already follows.
- Updated dependencies [5c64e11]
  - louise-toolkit@0.21.0

## 0.4.1

### Patch Changes

- Updated dependencies [53afba9]
- Updated dependencies [a57e375]
  - louise-toolkit@0.20.0

## 0.4.0

### Minor Changes

- e7e0f56: `AstroidConfig.blockCatalog` — thread the site's block types into the `pages` write contract.

  **Why.** `validateSections` and `sanitizeSectionsRichText` have both taken a
  `blockCatalog` since ADR 0005, but Astroid's write hooks passed neither and the
  config had no key to put one in. So a site could declare `blocks: { allow: [...] }`
  on a section, wire the on-canvas block toolbar, add a block — and have every save
  422 with "unknown block type". The editor looked like it worked and nothing
  persisted.

  Unlike `sectionCatalog` there is no built-in vocabulary to fall back on: block
  types are wholly site-defined. So the default is `{}`, which is correct for a
  sections-only site (with no section declaring a `blocks` policy, no block is ever
  reached) and load-bearing for everyone else.

  **It gates sanitization too, not just validation.** A block's rich-text fields are
  only scrubbed when its def is resolvable, so this is what makes a `richText` block
  field go through `sanitizeRichHtml` on write.

  Wired into both write paths — the collection's `beforeChange` hook (the
  `versionsRoute` path) and `astroidPagesWriteHooks` (the raw `pagesRoute` path) —
  so the two keep enforcing one contract.

  Sites using the block layer must now set it:

  ```ts
  export default defineAstroidConfig({
    sectionCatalog: SECTIONS,
    blockCatalog: BLOCKS, // ← required once any section declares `blocks`
  });
  ```

  Additive: a site that sets neither is unchanged.

- 977a2de: A `pos` commerce role, and `square.locations: "multi"` for multi-merchant projects.

  **`pos` — in-person selling as its own role.** Physical stock held at real places
  and sold at a counter, rather than through the site's own cart. It is separate
  from `storefront` because a site commonly runs both, and the two need different
  things: only `pos` needs locations, per-location pricing, and inventory.

  themidwestartist.com is the case in point — print-on-demand merch through
  Fourthwall (`storefront`), originals and self-stocked prints through Square
  (`pos`) across several shops and galleries. Neither provider can do the other's
  job, which is the same reason `invoicing` already exists.

  Only Square can serve `pos`, and that is a fact about the clients rather than a
  preference: the role needs `listLocations`, `location_overrides` and
  `batchChangeInventory`, none of which the Stripe or Fourthwall clients expose.
  Fourthwall's Platform API is create-only for products, so it cannot model stock
  held at a place at all. `assertCommerceRoles` rejects the assignment at config
  load with a message naming the alternatives, rather than at runtime as a missing
  function.

  **`commerce.square.locations`.** `"single"` (the default) is the ordinary case:
  one location, its id supplied once as `SQUARE_LOCATION_ID`. `"multi"` is the
  multi-merchant model, where each merchant is a Square Location and the location
  id comes from the _request_ — which merchant's storefront is this? — rather than
  from the environment.

  Setting `"multi"` **drops `SQUARE_LOCATION_ID` from the provider's credential
  gate entirely.** Not because it is merely unnecessary, but because it is
  hazardous: any code path that defaulted to an ambient location id would ring one
  merchant's sale against another merchant's books, and would look perfectly
  successful doing it. Leaving the name present-but-ignored is the kind of thing
  someone later "fixes" by using it, so it is removed rather than made optional.
  The access token and webhook secret are unchanged, and other providers are
  untouched.

  A `commerce.square` block with no role assigned to Square is now a config error —
  otherwise a typo'd config looks like it opted into multi-location while nothing
  reads the setting.

  **New exports:** `hasPos(commerce)`, `hasMultiLocation(commerce)`, and
  `commerceProviderCredentials(provider, commerce)` — the config-aware replacement
  for reading `COMMERCE_PROVIDER_SECRETS[provider].credentials` directly.
  `CommerceRole` gains `"pos"`, and `ResolvedCommerceRoles` gains an optional
  `pos`. All additive; existing configs and role resolution are unchanged.

### Patch Changes

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

- Updated dependencies [e7e0f56]
- Updated dependencies [e7e0f56]
- Updated dependencies [e7e0f56]
- Updated dependencies [5b4d17b]
- Updated dependencies [977a2de]
- Updated dependencies [977a2de]
  - louise-toolkit@0.19.0

## 0.3.2

### Patch Changes

- Updated dependencies [fc5a156]
  - louise-toolkit@0.18.0

## 0.3.1

### Patch Changes

- 06e5f03: `astroid doctor`: detect cron drift in `wrangler.jsonc`. The generated `scheduled`
  handler dispatches on a fixed set of cron strings (`astroidCrons` — the daily
  health scan plus the hourly catalog sync when commerce is on), but `wrangler.jsonc`
  is scaffold-once, so a config that gains a cron can't update it. Doctor now parses
  `triggers.crons` and errors when any expected cron is undeclared — the exact
  silent-failure class it exists to catch (an undeclared cron means Cloudflare never
  fires that job, while both doctor and deploy report healthy). Caught a real case
  where the daily health scan never ran because only the hourly catalog cron was
  declared.
- Updated dependencies [73b70ec]
  - louise-toolkit@0.17.1

## 0.3.0

### Minor Changes

- feat: first-class support for a real storefront's patterns (coracle.coffee is the
  first adopter).

  - Two-instance auth: the `louise_` editor convention (editor tables prefixed
    `louise_`, `editorsRoute` + template + migration + seed aligned) with a
    configurable second (portal) instance — `basePath` / `cookiePrefix` /
    `tablePrefix` overridable + an `assertAuthIsolation` collision guard, so a
    site's existing shop-customer instance is expressible with no data migration.
    New `astroidjs` auth exports (`ASTROID_EDITOR_TABLE_PREFIX`, `astroidEditorTable`,
    `assertAuthIsolation`); `PortalUser` widened with typed `id` + `email`.
  - `config.sectionCatalog`: inject a site's own section catalog for server-side
    pages validation/sanitize (bespoke `_type`s validate instead of 422).
  - `config.settings` (`columns` / `customKeys` / `imageKeys`): thread into the
    generated `settingsRoute` + Actions; `columns: []` keeps a custom-heavy site's
    values in `site_settings.custom`.
  - `config.inquiries`: force the contact-form + inquiries surface on/off.
  - Commerce catalog `mode: "live"`: manage no D1 catalog table (read live from a
    cache; the owner-overlay is the site's own). Generated `schema.ts` re-exports a
    scaffold-once `src/schema.site.ts` for site-owned tables.

  Stock-config generation output is unchanged.

### Patch Changes

- Updated dependencies
  - louise-toolkit@0.17.0

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

- 0d3ef34: Add the 11 section types #260 called for, on the ADR 0005 contract: `gallery`, `media`, `splitImage`, `steps`, `banner`, `faq`, `pricingTiers`, `testimonial`, `aboutIntro`, `productGrid`, `locationHours`.

  Each is a catalog entry (schema the editor and the validator share) plus a render component that owns its markup. Settings are `select` tokens, so colorway and alignment are pickers rather than free text. A few choices worth naming:

  - **The asset-level alt fallback is now live.** `<Sections>` resolved media metadata in one query but nothing consumed it. Every image-bearing section takes its `alt` from the section row when set, and otherwise from the media library — so fixing alt text once propagates to every page showing that asset. When neither exists the alt is `""` (decorative), never a missing attribute, which is what makes a screen reader read the filename.
  - **`splitImage` puts the image side in `_layout`**, not `_settings` — it's a named arrangement of the same content, which is what layouts are for.
  - **`faq` uses native `<details>`**: keyboard- and screen-reader-correct with no script, works before hydration, and browser find-in-page can open a collapsed answer, which a div accordion silently breaks. It renders `open` in edit mode, since a collapsed answer can't be edited in place.
  - **`productGrid` is authored content, not a live catalog read.** The commerce mirror has its own loader and freshness story; wiring it into a section would mean the editor edits a value that isn't what renders.
  - **`locationHours` uses a `<dl>`** — each day is a term and its hours the description, which is what the pairing is.

  **Dispatch became data.** `<Section>` now resolves `_type` through a `COMPONENTS` map instead of a ladder of comparisons, and a test asserts that map's keys and the catalog's are the same set — in both directions. A catalog entry with no component renders nothing (a silent hole, no error anywhere); a component with no catalog entry can never be added or edited, since the palette and the validator both read the catalog.

  **A correction to what #270 claimed.** That PR said wiring the scaffold meant CI's `astro check` covered the section library. Only half true: `astro check` diagnoses files _inside the project_, so components imported from `node_modules/astroidjs` are invisible to it. It caught the `mountSections` bug because that lived in a scaffold file. Verified by putting a deliberate type error in a component — it passed straight through.

  CI now copies the library's components under `src/` for one extra check pass. That immediately found three real defects that had been shipping unchecked: two in `Editable.astro`, where a ternary widened to a union carrying `"data-louise-type"?: undefined` and wasn't assignable to `Record<string, string>`, and one in `<Section>`, where `isRenderableSection` narrows to `string` (because `SectionCatalog` is `Record<string, SectionDef>`) and so could not index the component map at all.

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

- 407c861: Add the workflow/pipeline module (#256): `defineWorkflow`, a guarded stage advance, an audited sign-off trail, and `<StageBar>`.

  **The framing correction first.** The reference this generalizes — ghostfire.coffee's production floor, the "order tracker" — is not queue- or Durable-Object-driven despite the name. It is a synchronous SSR + D1 state machine: an integer `stage` column advanced by sign-off rows, where "liveness" is an email plus a page reload. So this is its own module, distinct from the queues module and from #71's realtime DO. Live push layers on top later; it isn't required for the pattern.

  The domain is coffee; the mechanism is general. Fulfillment, onboarding, approval chains, and support tickets are all an ordered stage list, one audit row per completed stage, an advance that survives two operators pressing the button at once, and a per-stage side-effect hook.

  **The guarded advance is the part worth having.** A read-then-write advance runs an item forward twice under concurrency and writes two audit rows. `advanceWorkflowStage` makes the write assert its own precondition — `UPDATE … SET stage = ? WHERE id = ? AND stage = ?` — and treats "0 rows changed" as the conflict, so there is no window between checking and moving. Every failure is a status rather than a throw (409 stale, 404 gone, 422 malformed), because two people working at once is an ordinary outcome, not an exception. The 409 names the stage the item is _actually_ at, which is what lets an operator recover instead of pressing again.

  **Ordering is fixed relative to the reference.** ghostfire's route inserts the sign-off row and _then_ runs the guarded update, so a double submit records two sign-offs even though only one advance lands. Here the guarded update goes first and the audit row is written only if the item actually moved — with a unique index on `(entity_id, stage)` as the backstop. There's a test asserting the refused path writes no audit row, and another asserting the very first statement issued is the guarded `UPDATE`.

  `overrideWorkflowStage` covers the out-of-band moves and logs them. Sending an item **back** deletes the reopened stage's sign-off, so "a sign-off exists" keeps meaning "that stage is genuinely done" rather than claiming work that was undone.

  `generateWorkflowSchema` emits the audit table and override log but deliberately **not** the entity table — Astroid doesn't own `orders`/`applications`/`tickets`, so it returns the `stage` column to paste in instead of generating something that would collide. `generateWorkflowRoute` scaffolds the advance endpoint, with an explicit TODO to gate it rather than silently shipping an open privileged endpoint.

  `<StageBar>` renders any N-stage pipeline. The reference hard-coded six segments, the corner radii, brand hex codes, and a mascot image; here the stage list drives the layout, the colours are theme tokens, and the marker is an opt-in prop. It's an ordered list with `aria-current`, so a screen reader gets "step 3 of 6, current" instead of a row of anonymous divs, and the pulse drops under `prefers-reduced-motion`.

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

- 0a93ce6: Add a drizzle-free `louise-toolkit/content/sections` entry, and split the content validator so importing the structured-sections validators no longer drags in `drizzle-orm`.

  `content/validation.ts` imported `drizzle-orm` (`and`/`eq`/`ne`) as real values for its uniqueness/reference query path. Because ESM is eager, anything importing it pulled drizzle in — and `content/sections.ts` (`validateSections`/`assertValidSections`/`sanitizeSectionsRichText`) imported `validateValue` from it, so the section validators couldn't be used without the optional `drizzle-orm` peer installed. That's the same class of bug `content/define` was carved out to fix.

  The pure Rule engine (the `Rule` builder, `validateValue`, and the synchronous check evaluation) now lives in a new drizzle-free `content/rule.ts`; `validation.ts` keeps only the document-level `validateDocument`/`assertValid` and the two DB-backed checks, injecting them into the shared evaluator, and re-exports the pure API so `louise-toolkit/content` is unchanged. `content/sections.ts` imports the pure engine directly and is exposed at the new `louise-toolkit/content/sections` subpath, so a consumer can validate a page's `sections` without installing drizzle.

  With that entry in place, Astroid's `pages` collection (`astroidPagesCollection`) now imports `assertValidSections`/`sanitizeSectionsRichText` **statically** from `louise-toolkit/content/sections` in its `beforeChange` hook, replacing the dynamic `import("louise-toolkit/content")` it needed to keep create-astroid's schema-generation graph off the optional `drizzle-orm` peer — the seam that entry was built to remove.

- d3fd13d: Use pnpm consistently in every documented command. The repo pins pnpm via `packageManager` and its own scripts already used it, but the published READMEs, the `create-astroid` help text, and the `astroid` CLI banner still told users to run `npm` — including `npm run doctor` in `create-astroid`'s README while the template README it scaffolds said `pnpm doctor`.

  Install lines become `pnpm add`, one-off binaries become `pnpm exec`, and `npm create astroid` becomes `pnpm create astroid` (which also drops npm's `--` argument separator, since pnpm forwards flags directly).

  References to npm _the registry_ are left alone — "shipped to npm", "the npm package", "not an npm dependency" are all still accurate, and rewriting them would make them wrong.

- Updated dependencies [f4c33d8]
- Updated dependencies [6d99c52]
- Updated dependencies [1ac694c]
- Updated dependencies [cad8084]
- Updated dependencies [b54e39f]
- Updated dependencies [0a93ce6]
- Updated dependencies [b93d6d1]
- Updated dependencies [d3fd13d]
- Updated dependencies [ff5ab79]
- Updated dependencies [5b227b5]
  - louise-toolkit@0.16.0

## 0.1.2

### Patch Changes

- 6c6064b: Drop the `drizzle-orm` dependency — Astroid no longer needs it at runtime.

  `0.1.1` declared `drizzle-orm` to fix a crashing `npm create astroid`, but that was treating the symptom: Astroid only calls `defineCollection`, and the dependency existed solely because importing it from the `louise-toolkit/content` barrel eagerly dragged in the barrel's drizzle-dependent query/codegen chunks. Astroid now imports from the new `louise-toolkit/content/define` entry, which is genuinely free of it, so the declaration is no longer earning its place.

  Verified in a clean room: packed all three packages, installed them into an empty directory with `drizzle-orm` absent entirely, and ran a full scaffold plus `astroid doctor` — both succeed. The CI scaffold smoke test now runs exactly this way, so the regression can't come back unnoticed.

- Updated dependencies [6c6064b]
  - louise-toolkit@0.15.0

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
