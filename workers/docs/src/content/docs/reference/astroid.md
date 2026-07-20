---
title: astroid
description: "astroidjs — the opinionated meta-framework over Louise: config, sections, modules, and the generators behind the astroid CLI."
sidebar:
  order: 20
---

```ts
import { defineAstroid } from "astroidjs";
```

A separate package from `louise-toolkit`, layered on top of it. See the
[Astroid guide](/guide/astroid/) for the overall shape; this page is the API.

:::note
Astroid is pre-1.0 and breaking changes ship as a **minor** bump. Component
subpaths (`astroidjs/components/*`) ship as **source** — they're `.astro` files,
compiled by your project, not prebuilt.
:::

## Config

### `defineAstroid(config)`

```ts
function defineAstroid(config: AstroidConfig): AstroidConfig;
```

An identity function in the shape of Astro's `defineConfig`: returns the config
verbatim with full inference, and validates the invariants that would otherwise
fail deep inside generation. Throws [`AstroidConfigError`](#errors) on:

- an empty `key` (it names every generated binding)
- a missing `theme.name` or `theme.colors.brand`
- a commerce provider assigned to a role its client can't serve
- `portal.gated`, which is **not implemented** and refused rather than silently
  wiring no guard

Key types: `AstroidConfig`, `Archetype` (`marketing | storefront | wholesale |
portfolio`), `ModuleKind` (`map | pwa | wholesaleInquiry`), `SectionKind`,
`Theme`, `Portal`, `CommerceConfig`, `SeoConfig`, `SecurityConfig`, `PwaConfig`.

`ASTROID_ARCHETYPE_SECTIONS` maps each archetype to its default home sections.

## Sections

```ts
import { astroidSectionCatalog, isRenderableSection } from "astroidjs/components/sections";
```

`astroidSectionCatalog` is schema only — the same object drives the on-canvas
editor and the write-time validator, so a field can't be editable-but-invalid.
`SectionKind` is **derived** from its keys, which is what makes a section name
with no component a compile error.

Helpers for writing a section component: `field`, `setting`, `list`, `itemField`,
`mediaAlt`, `mediaCaption`, `colorwayClass`, `alignClass`. Token maps
`COLORWAY_CLASS` / `ALIGN_CLASS` are the site-owned half of the contract — Louise
stores `_settings.colorway = "brand"` and never learns what it renders as.

### Components

Imported from `astroidjs/components/*.astro`:

`<Editable>`, `<Section>`, `<Sections>`, `<Seo>`, `<StructuredData>`,
`<MediaSlot>`, `<JustifiedGallery>`, `<PortalShell>`, `<StageBar>`,
`<RegisterSW>`, plus the 15 section components under `components/sections/`.

## Commerce

```ts
import { verifyCheckout, checkoutIdempotencyKey } from "astroidjs";
```

### `verifyCheckout(lines, lookup)`

```ts
function verifyCheckout(lines: unknown, lookup: PriceLookup): Promise<CheckoutVerification>;
```

Re-prices a cart server-side. The client's price is a **staleness check, never an
input to the charge** — on mismatch it refuses rather than charging a different
amount. Rejects non-integer, negative, and absurd quantities.

### `checkoutIdempotencyKey(verified, scope, identity)`

```ts
function checkoutIdempotencyKey(
  verified: { lines: VerifiedLine[]; subtotalCents: number },
  scope: string,
  identity: string,
): Promise<string>;
```

A deterministic key so a double-clicked Pay button charges once.

**`identity` is required and empty is refused.** Pass a cart id, checkout-session
id, or user id — something stable across a retry of this attempt and distinct
between buyers. Without it the key is a function of the cart alone, so two
customers buying the same items collide, and since providers scope idempotency
keys per account for ~24h the second buyer is never charged. `scope` is the
*operation* (`"order"` vs `"refund"`), not an identity.

### Card checkout

`usesCardCheckout`, `generateAstroidCheckoutRoute`, `generateAstroidSquareCard`,
`astroidCheckoutVars`, `generateAstroidCheckoutEnv`.

Square storefronts only — Fourthwall redirects to its own hosted checkout (no
token to charge) and Stripe fills `invoicing`, not `storefront`. Generates the
payment route and the card component; the **cart is not generated**, because
where it lives is a project decision.

`SQUARE_APP_ID` and `SQUARE_ENVIRONMENT` are emitted as wrangler **vars**, not
secrets: the app id ships to the browser by design, and folding either into the
credential roster would also fold it into the dormancy gate — which asks whether
we can safely *call* Square, a different question from whether a card field can
render.

### Catalog mirror

`astroidCatalogSync`, `astroidCatalogUpsert`, `astroidCatalogMirror`,
`readCatalog`, `readCatalogItem`, `astroidCatalogLoaderConfig`,
`generateCatalogTable`, `generateCatalogMigrationSql`.

The provider is the source of truth; D1 holds the owner's edits. **The sync never
writes an owned column** — one that does silently reverts the owner's work.
`slug` is owned for exactly that reason: it's the public URL.

`astroidCatalogSync` returns `{ created, updated, failed, errors }` and **throws
when every item failed** — a total failure that returned zeros was
indistinguishable from an empty catalog, so the queue acked and the site served a
frozen catalog silently. Partial failures don't throw.

Adapters `squareToCatalogItem` / `fourthwallToCatalogItem` normalize to one shape,
which is what lets a single loader serve both.

### Roles

`astroidCommerceRoles`, `astroidCommerceProviders`, `assertCommerceRoles`,
`hasStorefront`, `resolveCommerceStatus`. Providers fill **roles**, not "the"
provider slot — a provider in a role it can't serve fails at config load.

## Portal

`astroidPortal`, `astroidPortalGuardConfig`, `portalGuard`, `guardResponse`,
`requireCustomer`, `resolvePortalSession`, `isSameOrigin`, `definePortalNav`.

A second Better Auth instance for customers. The mount, cookie prefix, and
`portal_*` table prefix are **fixed, not configurable** — the studio keeps Better
Auth's defaults because the editor client hardcodes them, so the portal is the one
that moves. Two instances sharing a cookie prefix fails intermittently in
production and looks like a session bug.

The guard is fail-closed: a session resolver that throws degrades to *signed out*,
never to signed-in.

## Analytics

`ASTROID_VITALS_BINDING`, `astroidVitalsDataset`, `ASTROID_VITALS_SECRET_NAMES`,
`generateAstroidVitalsBeacon`, `generateAstroidCwvQuery`.

Real-visitor Core Web Vitals. The dataset name is derived from the project key so
two Astroid sites on one account don't blend their p75s. The beacon ships as a
**static file** (`public/vitals.js`) rather than an inline script: Astro hashes
processed scripts into `script-src`, and an inline script carrying generated
content can't be hashed, so it would be blocked.

Note `vitalsRoute` comes from `louise-toolkit/analytics`, not `/editor`.

## Realtime

`usesRealtime`, `generateAstroidEditSession`, `generateAstroidRealtimeEnv`,
`ASTROID_REALTIME_BINDING`, `ASTROID_EDIT_SESSION_CLASS`,
`ASTROID_REALTIME_MIGRATION_TAG`.

The per-page live editing session (ADR 0002), opt-in via `modules: ["realtime"]`.
Astroid generates the wrangler `durable_objects` binding + migration block, mounts
`realtimeRoute`, and scaffolds the DO subclass — which is scaffold-once because it
imports `cloudflare:workers` and because its `persist` is the seam you tune.

Note `realtimeRoute` comes from `louise-toolkit/realtime`, not `/editor`: it is
the one factory in the route plan that isn't an editor route.

## Email

`sendTransactional`, `resolveMailer`, `resolveMailerStatus`, `createMailer`,
`astroidMailTheme`, and the templates `magicLinkEmail`, `passwordResetEmail`,
`inquiryNotificationEmail`, `inquiryConfirmationEmail`, `sendInquiryMail`.

Always build options with **`resolveMailer(env)`** rather than by hand — it's the
only thing that applies the placeholder-sentinel check, so a hand-built options
object can call the Email API with an envelope sender of literally
`DUMMY_REPLACE_ME`.

When a send is skipped the message is logged, but the **body is withheld unless
the environment reads as development** — it carries single-use sign-in and reset
links, and `logOnly` engages in production whenever `MAIL_FROM` is unset. Pass
`devLog: true` to force it (e.g. under bare `wrangler dev`).

## SEO

`astroidSitemapXml`, `astroidRobotsTxt`, `astroidStructuredData`,
`resolvePageSeo`, `escapeJsonLd`, `astroidNoindexPaths`.

`escapeJsonLd` escapes `<`, `>`, `&` as `\uXXXX` so a `</script>` in CMS content
can't break out of a JSON-LD block.

## Security

`astroidSecurity` (the Astro integration config), `astroidCspOrigins`,
`astroidRateRules`, `solidHydrationHash`.

The CSP has no `'unsafe-inline'` or `'unsafe-eval'` in `script-src`. Origins for
enabled modules are merged automatically.

## Secrets

`readModuleSecret`, `resolveModuleSecrets`, `ASTROID_SECRET_PLACEHOLDER`,
`astroidSecretNames`, `astroidModuleStatus`, `describeAstroidStatus`.

The dormant-until-provisioned convention: a module whose secrets are
unprovisioned renders, serves, says it's simulated, and never calls upstream.
Partial provisioning counts as dormant — a half-configured integration fails
mid-checkout rather than at boot.

## Queues and crons

`handleWebhook`, `astroidQueueHandler`, `astroidUsesQueues`, `astroidQueueNames`,
`affectsCatalog`.

`astroidCrons(config)` returns every cron expression the project needs —
`ASTROID_HEALTH_CRON` (daily, always) plus `astroidCron(config)` (the hourly
catalog re-sync, commerce only). Cloudflare fires **one** `scheduled` handler for
all triggers and identifies which by `controller.cron`, so `wrangler.jsonc`'s list
and the handler's dispatch must agree exactly — a string in one and not the other
is a job that silently never runs. Both derive from this function for that reason.

`handleWebhook` verifies the HMAC over the **raw body before anything parses it**
— parse first and an unauthenticated caller reaches the JSON parser and everything
downstream. It then enqueues and returns, so the response doesn't wait on the work.

## Generators

The functions behind the `astroid` CLI and `create-astroid`. You rarely call these
directly.

`generateAstroidProject` returns the regenerated trio (`src/schema.ts`,
`src/worker.ts`, `src/middleware.ts`). `generateAstroidScaffoldFiles` returns every
**scaffold-once** file the config implies — written when absent, never
overwritten. Sharing that one list between the CLI and the scaffolder is what lets
`astroid generate` complete a config change that adds a module.

Also: `generateAstroidWrangler`, `generateAstroidSchema`, `generateAstroidWorker`,
`generateAstroidMiddleware`, `astroidEditorRoutePlan`, `generateServiceWorker`,
`generateWebManifest`, `generateMapTileRoute`, `generateAstroidPortalAuth`.

## Errors

`AstroidConfigError` — a config violates an invariant, at load/build time.

`AstroidUsageError` — a runtime helper was called with arguments that would
produce a silently wrong result (a checkout key with no identity, a catalog sync
where nothing landed). Distinct from the config error because it fires on a live
request, so a handler can catch it and return a 5xx.
