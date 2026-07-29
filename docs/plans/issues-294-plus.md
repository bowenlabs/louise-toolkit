# Plan — the open issues numbered 294 and up

**Scope.** The 33 issues numbered ≥ 294 that are open in `bowenlabs/louise-toolkit`,
read against `a684acc` (`feat(chrome)!: catalog-decides markers (A2 slice 5)`),
2026-07-29.

**Read this first.** A third of these issues are describing a codebase that no
longer exists. The Square and astroid set (#294–#312) was filed on 2026-07-26,
before `feat: Square multi-location + a pos commerce role (Wave 2)` (#318)
landed; #327's audit predates the fix to the one thing it calls blocking. The
first wave below is therefore not implementation — it is reconciling the record,
because planning against a stale audit is how you build something twice.

---

## 1. Where each issue actually stands

Verified by reading `main`, not by reading the issue.

Legend: **✅** shipped, close it · **◐** partly shipped, a named residue remains ·
**○** untouched.

### Square / commerce (`packages/louise/src/core/commerce/square.ts`)

| # | Issue | | State in `main` |
|---|---|---|---|
| 294 | cross-provider `refreshCatalog` storm | ○ | `refreshCatalog?: () => void \| Promise<void>` still takes no message (`astroid/src/queues/consumer.ts:26`), and the Square receiver still enqueues the generic `webhook` kind. The bug is live. |
| 295 | Locations API | ◐ | `listLocations` (`:232`) and `retrieveLocation` (`:238`) shipped. `createLocation` / `updateLocation` absent. |
| 296 | `location_overrides` + presence | ✅◐ | Read *and* write shipped — `SquarePresence` (`:347`), `SquareLocationOverride` (`:356`), `presentAt`, `priceAtLocation`, `overridesBody`, `presenceBody`. All three presence lists are there. **Residue:** the guard rail the issue asks for — assert a variation's location set ⊆ its parent item's — is not implemented, and the "can a `#temp` variation carry `location_overrides` in the same batch" question is unanswered. |
| 297 | `batchUpsertCatalogObjects` | ✅◐ | Shipped at `:928` with chunking and `idMappings`. **Residue:** no assert on the 250-variations-per-item cap. |
| 298 | inventory writes | ✅◐ | `batchChangeInventory` (`:1060`), `setPhysicalCount` (`:1111`), `PHYSICAL_COUNT` preferred in the ergonomics exactly as asked. **Residue:** no `TRANSFER` helper — but the issue itself accepts two `PHYSICAL_COUNT` writes as a correct fallback, so this is a close, not a task. |
| 299 | reporting `searchOrders` | ◐ | `searchOrders` shipped (`:1279`) with date/state filters, cursor paging and a page bound. **Two real gaps:** `locationIds` is passed straight through with no chunking at 10 — Square's documented hard ceiling, so any account with 11 locations gets a 400. And `calculateOrder` is absent. |
| 300 | catalog image + category writes | ○ | The read path maps `image_ids` (`:453`) and `categories` / `reporting_category` (`:676`), but `upsertCatalogItem`'s body emits neither, and there is no `/v2/catalog/images` upload. Exactly as filed. |
| 301 | `readModifyWriteCatalog` | ○ | Untouched. Still the silent-data-loss hazard the issue quotes Square on. |
| 302 | retry with backoff | ✅ | `SquareRetryConfig` (`:35`), handled inside the fetch verbs, 429 + 5xx with jitter. **One deviation:** default is OFF ("existing callers byte-for-byte unchanged"); the issue asked for conservative-on. See the decision in Wave 0. |
| 311 | QR + payment links | ◐ | The changeset released. `createPaymentLink` shipped. The QR encoder still has **zero consumers** outside `core/qr` and its test — the dead-surface half of the issue is untouched. #335 closes its docs half. |

### Astroid

| # | Issue | | State in `main` |
|---|---|---|---|
| 303 | `pos` commerce role | ✅ | In `commerce/roles.ts`, threaded through secrets and status. Close it. |
| 304 | unhardcode `SQUARE_LOCATION_ID` | ✅ | `commerce.square.locations: "single" \| "multi"` + `hasMultiLocation` (`roles.ts:100`), credentials resolved per configuration, and `SQUARE_APP_ID` / `SQUARE_ENVIRONMENT` declared through `astroidCheckoutVars` with the separate-gating pattern the issue asked for. Close it. |
| 305 | location-scoped pricing | ○ | `PriceLookup` is still `(variantIds) => Promise<Map<string, number>>` (`commerce/checkout.ts:45`); the adapters still collapse to `Math.min` (`adapters.ts:66,92`). |
| 306 | `AstroidConfig.crons` | ○ | `astroidCrons` still returns a fixed pair (`queues/messages.ts:47`). |
| 307 | tenancy seam + rewrite hook | ○ | Untouched. |
| 309 | `PwaConfig.offlineFallback` + `emitDir` | ○ | Untouched. |
| 310 | Fourthwall Platform API | ○ | Untouched. |

### Toolkit

| # | Issue | | State in `main` |
|---|---|---|---|
| 308 | `mountStudio` | ○ | Untouched. |
| 312 | explicit `rpID` | ○ | Still origin-derived (`core/auth/auth.ts:313`). |
| 332 | image-optimization docs lag | ○ | `reference/media.md` documents neither `cfImageSrcset` nor `transformImage`; `<MediaSlot>` and `<JustifiedGallery>` appear only as names at `reference/astroid.md:66`. |
| 333 | chrome loads full-size originals | ○ | All six call sites confirmed still raw. |
| 334 | one flag to disable AI generation | ○ | Four accessors still `ai: (env) => env.AI`. |
| 335 | five modules with no reference page | ○ | `reference/` has 18 pages; `browser`, `analytics`, `health`, `realtime`, `qr` have none. |

### TanStack (#313–#317)

All untouched. #315 is a decision already written down — it needs recording and
closing, not building.

### Epics

| # | | State |
|---|---|---|
| 341 | ADR 0010 | **A1 ✅ released** (0.21.0). **A2 ✅ complete in `main`, unreleased** — all five slices merged (#350, #353, #354, #355, #356), five changesets sitting in `.changeset/`. A3/A4 pending. B blocked. |
| 348 | A3 marker migration | Pending, and **cross-repo** — four site repos, none of them this one. |
| 349 | A4 the release | **Cuttable today.** The changesets are staged. |
| 347 | Phase B | Blocked on five questions in an external spec. Leave blocked. |
| 327 | split astroid out | ◐ Its own "blocking" bullet — astroid importing `louise-toolkit/src/core/content/rule` — **is already fixed**; astroid now imports only public subpaths (`schema/collections.ts` uses `content/define` + `content/sections`, and the internal path survives only in a comment). The audit needs amending before anyone plans from it. |

---

## 2. Ordering

Five waves. The ordering is driven by three real constraints, not by priority
feeling:

1. **The A2 release is time-sensitive and everything else is not.** Five
   changesets are staged, four production sites are pinned at `0.20.0`, and the
   longer the marker migration waits the more stamps accumulate against the old
   contract.
2. **Docs before the split.** #335 says it plainly: all five undocumented modules
   are framework-agnostic and stay in this repo either way, so writing them now
   means authoring once instead of authoring then relocating.
3. **The split goes last** because it moves the floor under everything else, and
   its Phase-1 client work touches the same three files as #333 and #308.

```
Wave 0  reconcile the record            ── no dependencies
Wave 1  cut the A2 release              ── 349 → 348 (cross-repo) → close 341's A-phases
Wave 2  the docs debt                   ── 335 → 332 → 314
Wave 3  library correctness             ── 294 · 299r · 301+296r+297r · 300 · 295r · 333 · 334 · 312
Wave 4  the studio + multi-tenant set   ── 312 → 307 → 309 → {316,317} → 308 · 305 · 306 · 310
Wave 5  the split (327)                 ── after 333, 308 and Wave 2
```

---

## 3. Wave 0 — reconcile the record

Half a day, almost no code. Everything downstream reads cleaner afterwards.

- **Close as shipped:** #303, #304. Both fully landed in #318.
- **Close with a note:** #298 (the `TRANSFER` helper is explicitly optional in
  the issue's own text), #296 and #297 (see the residue below — file it, don't
  keep the issue open for a one-line assert).
- **Retype with the residue in the title/body:** #295 → *create/update location*,
  #299 → *chunk `locationIds` at 10 + `calculateOrder`*, #311 → *give the QR
  encoder a consumer* (its docs half moves to #335).
- **#302 — one decision.** The implementation defaults retry OFF; the issue asked
  for on-by-default because "the failure mode without it is a half-applied
  catalog push". **Recommendation: keep OFF as the library default and turn it ON
  in the astroid-generated queue consumer and cron handlers.** That is where the
  unattended pushes actually run, and it keeps a hand-wired caller's behaviour
  predictable. One line in `astroid/src/queues/scaffold.ts`; then close #302.
- **Amend #327's audit** — strike the internal-path-leak bullet, note it landed
  ahead of the epic.
- **Record and close #315.** The decision is already written; move the substance
  into `docs/` (a short note beside the ADRs, or a `guide/tanstack.md` section
  produced in Wave 2) so it survives the issue being closed, then close as
  `wontfix`.

**Net:** roughly 8 open issues become 3, and the Square backlog stops looking
like ten unstarted features when it is really four.

---

## 4. Wave 1 — cut the A2 release (#349 → #348 → #341)

The highest-value thing available today, and it is mostly a release chore.

**In this repo:**

1. Amend ADR 0010's Migration section — the promised codemod becomes the measured
   `perl -pi -e` one-liner with the `(?!s)` guard, per #348. Do it here so the
   ADR is right *before* four sites follow it.
2. `pnpm changeset version` over the five staged changesets → `louise-toolkit`
   0.22.0 / `astroidjs` 0.6.0. Check the `catalog-decides-markers` prose reads as
   breaking, since pre-1.0 semver won't say so for you.
3. Publish, then **deprecate `louise-toolkit@0.21.0` on npm** —
   `npm deprecate louise-toolkit@0.21.0 "A1-only marker contract; use 0.22.0"`.
   This is #349's open question and the answer is clear: 0.21.0 is a marker
   contract no site consumes, and leaving it undeprecated means the next person
   who finds it adopts a version that exists only as a stepping stone.

**Cross-repo (not this session's scope — see §9):** the one-liner across
coracle.coffee (39 stamps / 16 files), themidwestartist.com (11/5),
ghostfire.coffee (6/3), louise-web (6/3, may need the `louisecms` rename first).
Coracle first — it is the only site with all 13 link value-nodes, so it is the
only place the field-scoped CTA inspector can be verified in a browser at all.
Live-QA by reading resolved chrome state off the page, per #348.

Then close #348, #349, and the A-phases of #341. #341 stays open for Phase B.

---

## 5. Wave 2 — the docs debt

No runtime risk, high leverage, and #335 argues convincingly for doing it before
the split.

**#335, in dependency order** — `browser`, `analytics` and `health` are one
feature (the site-health co-pilot), which is why none of them got a page:

1. `reference/browser.md` — the two `OgRenderer` implementations behind one
   interface, both peers optional and dynamically imported, cache-on-miss, the
   link checker, the `BROWSER` binding.
2. `reference/analytics.md` — written as the pipeline it is: `cwvBeaconScript` →
   `vitalsRoute` → dataset → `cwvSqlQuery` → `parseCwvRows` → `summarizeCwv` →
   `CwvSummary`. An alphabetical export list is useless here.
3. `reference/health.md` — assembly + KV persistence, and the gotcha that the
   card stays hidden until the first scan writes a summary.
4. `reference/realtime.md` — the ownership split (the site owns the
   `DurableObject` subclass and the binding; this module owns the session logic
   and the guard route), the soft-lock, and `REALTIME_PROTOCOL_VERSION`.
   Cross-link ADR 0002.
5. `reference/qr.md` — encoder + SVG, why it is vendored, and the PNG path
   through `core/browser/resvg.ts`. Close #311's docs half here.

**#332** — `cfImageSrcset` and `transformImage` into `reference/media.md` with
the cost distinction (URL rewrite vs. billed re-encode), the two option types
into the Types list, a `<MediaSlot>` prop reference led by `sizes` and the LCP
guidance, a `<JustifiedGallery>` reference covering the SSR-floor/client-refine
split, and the `mediaMeta` threading paragraph. One worked example, end to end.

**#314** — the solid-table guidance as standing constraint: `flexRender` is fine
read-only, wrong for editable grids, and for server-paginated CRUD a plain
`<For>` plus a sort signal wins. This directly constrains the studio's inventory
screen in Wave 4, so it wants to exist before that gets designed.

---

## 6. Wave 3 — library correctness

Small, independently shippable, one changeset each.

- **#294 first.** It is the only issue here with a live production failure mode —
  a Square `inventory.count.updated` on every sale driving a sync against
  Fourthwall's rate limit. Reproduce in dev before fixing, per the issue. Fix in
  both places: widen the seam to `refreshCatalog?: (message) => …` so a site can
  branch on provider, and have the Square receiver enqueue site-owned `square_*`
  kinds rather than the generic `webhook`.
- **#299 residue.** Chunk `locationIds` at 10 (latent 400 on any 11-location
  account today) and add `calculateOrder`.
- **#301 + #296r + #297r as one PR.** All three are the same shape — making the
  correct pattern the easy one: `readModifyWriteCatalog` carrying `version` and
  the pinned `Square-Version`, the variation ⊆ item location assert, the
  250-variation assert. The round-trip test #301 asks for is not optional; the
  failure it guards is silent by definition.
- **#300** image + category writes, including the multipart `createCatalogImage`.
- **#295 residue** `createLocation` / `updateLocation`.
- **#333** the `thumb(url, px)` helper across six call sites. Self-contained, and
  the largest felt improvement for the people using the product most. Keep
  `RichText.tsx`'s transform on the rendered node view only — never on the stored
  `src` — and assert that in the existing `set:html` round-trip test.
- **#334** the AI kill switch. Two decisions the issue leaves open, with
  recommendations: **(a) gate generation only** — embeddings keep binding-presence
  as their switch, or turning off "AI content" silently breaks site search;
  **(b) ship the distinct disabled-vs-unconfigured signal in the same PR**, not as
  a follow-up. A 503 that renders as an absent button is right for an
  unprovisioned binding and wrong for a deliberate opt-out, and a kill switch
  nobody can see the state of is the thing the issue itself warns against.
  One exported `aiRunner(env)` so the four accessors share one definition.
- **#312** explicit `rpID`. Ten lines plus the doc note about pairing it with
  host-only cookies and a distinct `cookiePrefix`. It lands here rather than in
  Wave 4 because #307 and #308 both assume it.

---

## 7. Wave 4 — the studio and multi-tenant set

Seven issues, one product: per-merchant storefronts on a wildcard host, with a
full-page admin PWA. Sequencing matters more here than anywhere else, because
each piece constrains the next.

```
312 rpID ──► 307 tenancy seam ──► 309 PWA emitDir/offlineFallback ──► 308 mountStudio
                                        ▲                                  ▲
                        317 router spike ┘                316 form bugs ───┘ 313 form scaffold
305 scoped pricing · 306 crons  (parallel, storefront-side)
310 fourthwall platform         (independent, no dependents)
```

- **#307** the tenancy seam: `AstroidConfig.tenancy`, a wrangler generator that
  emits the proxied wildcard route **plus** a separate apex route, generated
  middleware calling a scaffold-once `resolveTenant`, and `rewrite?:` on
  `createLouiseMiddleware`. The site keeps 100% of the policy. While in there,
  clarify the one-brand-per-project comment at `config.ts:11-16` — this is the
  audiences axis, not multi-brand.
- **#309** before #308: a studio served at `studio.example.com/` → `/studio/`
  needs its SW and manifest under `public/studio/`, or the browser fetches a
  path that doesn't exist.
- **#317 and #316 are spikes, and they go before #308's shell lands**, because
  they answer whether the studio is router-driven and whether nested/array forms
  are viable on Solid. #317 in particular is undocumented anywhere upstream —
  budget it as a spike with a written outcome, not as a feature.
- **#308** `mountStudio` with `presentation: "drawer" | "page"`, reusing every
  existing panel. Bake in the design constraint: the page shell renders no data
  and no session-specific markup, so it stays service-worker cacheable.
- **#313** the form scaffold — confirm the module referenced at
  `client/forms.tsx:9` exists; build it if not. One `defineForm` config driving
  both `validateSubmission` and `@tanstack/solid-form` is a good design that is
  currently invisible.
- **#305** and **#306** are storefront-side and parallel to all of the above.
- **#310** has no dependents and no dependencies. Slot it wherever there is
  capacity. Keep it in a separate file from the storefront client — different
  base URL, different auth, and a different trust boundary.

---

## 8. Wave 5 — the split (#327)

Last, and deliberately so. Recommendations on its four open questions:

1. **`louise-toolkit/astro` moves into `astroidjs`**, not a separate
   `@louise-toolkit/astro` adapter. Symmetry with a `/remix` or `/nuxt` that
   does not exist is not worth a package to maintain; extract one when a second
   host is real.
2. **`workers/site` stays here.** It has exactly one astroid import —
   `Editable.astro` in `src/sections/FeatureGrid.astro`. Drop that one usage
   rather than give the marketing site a published `astroidjs` dependency.
3. **The non-Astro consumer fixture is worth it, and it is nearly free**: the
   export-map check that has to replace the lost `pack` gate already imports all
   33 subpaths from a packed tarball in a clean room with no Astro installed.
   That *is* the agnosticism proof. No separate fixture.
4. **Repo name `astroid`**, package name `astroidjs` — the `js` suffix exists
   only to clear the npm namespace.

Phase 1 order, by risk:

1. The CI grep guard first (fail on any `astro` occurrence under
   `packages/louise/src`), so every step after it is measurable rather than
   asserted.
2. `astro` as an explicit optional peerDep of `astroidjs`, matched to what
   `create-astroid`'s template pins.
3. The `@astrojs/cloudflare` cache-header contract out of `core/worker/edge-cache.ts`
   (take the header name as config), and `import.meta.env` out of
   `core/email/index.ts` (explicit config from the host).
4. **The client lifecycle seam last of the Phase-1 items** — replacing the
   `astro:before-swap` / `after-swap` / `page-load` listeners with a documented
   `onNavigate`/teardown hook astroid wires up. It is the only Phase-1 item with
   real design content, and it touches the same three files as #333 and #308,
   so it goes after both.
5. Prose scrub, then move `src/astro/` + its tests + the `./astro` export, then
   drop `astro` from peerDeps/devDeps, `vite.config.ts`'s `neverBundle`, the knip
   entry, and `keywords`.

Phases 2 and 3 are mechanical once Phase 1 is done, and the epic already
enumerates them accurately.

---

## 9. What this plan cannot do from this repo

- **#348's site migrations** touch `coracle.coffee`, `themidwestartist.com`,
  `ghostfire.coffee` and `louise-web` — four repos this session has no access to.
  They need either separate sessions or explicit repo attachment.
- **#349's publish + `npm deprecate`** need registry credentials.
- **#296's open verification** (does a `#temp` variation accept
  `location_overrides` in the same batch upsert?) and **#298's** (is `TRANSFER`
  free-plan-usable?) are live-API questions against a Square sandbox — they
  cannot be answered from source, and both determine whether onboarding a
  merchant is one call or two.

## 10. Parked, on purpose

- **#347 / #341 Phase B** — blocked on five unresolved questions in
  `coracle.coffee/docs/phase-3-reference-rings.md` §9. A1 already reserved
  `NodeTone`'s `shared` and `external`, and `describeNode` picks tone by depth
  provisionally, so swapping depth for source is a change to one function when
  the answers arrive. Designing it blind is the exact mistake ADR 0010 exists to
  correct.
- **#315** — closed in Wave 0 once its substance lands in docs.

---

## 11. If you only do one thing this week

Wave 1. Five changesets are staged, four sites are pinned one version behind a
breaking marker contract, and the migration is a single `perl` one-liner that
only gets more expensive to run as sites accumulate stamps. Everything else here
keeps.
