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

### `<MediaSlot>`

The responsive image. Wraps [`cfImageSrcset`](/reference/media/) so a site never
hand-rolls `srcset` math.

```astro
<MediaSlot
  src={item.url}
  alt="Harbor Blend, bagged"
  width={400}
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
  ratio="4/3"
/>
```

| Prop                           |                                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`sizes`**                    | How wide the image renders at each breakpoint. **The highest-leverage prop here.** It defaults to the 1× `width`, which is right for a fixed placement and wrong for a fluid one — and getting it wrong is how a "responsive" image ends up slower than a fixed one. |
| **`alt`** _(required)_         | `""` is a legitimate value for a decorative image, and the correct one. What must never happen is the attribute going missing, which makes assistive tech read the filename aloud.                                                                                   |
| **`loading`** / **`priority`** | `lazy` by default. **Set `eager` and `priority` above the fold** — lazy-loading the LCP image delays it by a full network round-trip after layout, which is a self-inflicted Core Web Vitals failure.                                                                |
| `width`                        | The largest width in CSS px at 1×. Drives the ladder; not a hard render width. Default 1200.                                                                                                                                                                         |
| `ratio`                        | `"16/9"` — reserves the box, which is what keeps a gallery from shifting as it loads, and derives each derivative's height so the crop matches what's shown.                                                                                                         |
| `focal` / `zoom`               | Render-time framing (`object-position` / scale) for when `gravity: auto` picks wrong. Deliberately **not** a second CDN derivative of the same source — same bytes, different framing.                                                                               |
| `shape` / `size`               | `"circle"` uses a square focal crop at 2×; `size` is the rendered diameter (default 96).                                                                                                                                                                             |
| `fit` / `gravity` / `quality`  | Passed through to the transform. Defaults `cover` / `auto` / 82.                                                                                                                                                                                                     |
| `caption`                      | Renders `<figure>`/`<figcaption>` instead of a bare `<img>`.                                                                                                                                                                                                         |

### `<JustifiedGallery>`

A flexbox justified-rows gallery. Its layout is **two-layer, and both layers
matter**:

1. **SSR floor** — each tile's `flex-grow`/`flex-basis` come from the recorded
   dimensions in the media registry, so rows are roughly right in the HTML before
   any JavaScript runs.
2. **Client refinement** — once true dimensions are known, the rows are
   re-justified precisely.

Without recorded dimensions the SSR layer falls back to a default aspect, so the
first paint is less accurate — another reason `mediaMeta` is worth threading.

| Prop           |                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `items`        | `GalleryItem[]` — `src`, `alt`, and ideally `width`/`height` from the registry.                                                     |
| `targetHeight` | Row height to aim for, px. Default 260.                                                                                             |
| `gap`          | Tile gap, px. Default 8.                                                                                                            |
| `reveal`       | Fade/rise tiles in on scroll. Default `true`, and **inert under `prefers-reduced-motion`** — you don't need to disable it yourself. |

Tiles render through `<MediaSlot>` with `sizes` computed per tile, so the gallery
inherits the derivative behaviour above.

## Commerce

```ts
import { verifyCheckout, checkoutIdempotencyKey } from "astroidjs";
```

### `verifyCheckout(lines, lookup, options?)`

```ts
function verifyCheckout(
  lines: unknown,
  lookup: ScopedPriceLookup,
  options?: { scope?: { locationId?: string } },
): Promise<CheckoutVerification>;
```

Re-prices a cart server-side. The client's price is a **staleness check, never an
input to the charge** — on mismatch it refuses rather than charging a different
amount. Rejects non-integer, negative, and absurd quantities.

Refusal reasons: `"empty"`, `"invalid"`, `"price-changed"`, `"unavailable"`,
`"out-of-stock"`.

#### Per-location pricing

One catalog sold through several merchants carries a different price per
location — each shop's commission absorbed in its own Square
`location_overrides` entry. Re-pricing against **base** prices there lets a
customer pay the cheapest merchant's price at the dearest merchant's storefront:
the same exploit as trusting the client's `unitPriceCents`, one level further
back.

```ts
import { retrieveVariationPricesAt } from "louise-toolkit/commerce/square";

const pricesAt: ScopedPriceLookup = async (ids, scope) => {
  const money = await retrieveVariationPricesAt(sq, ids, scope!.locationId!);
  return new Map([...money].map(([id, m]) => [id, m.amount]));
};

const check = await verifyCheckout(body.lines, pricesAt, { scope: { locationId } });
```

Resolve `locationId` from the **host or an authenticated session, never the
request body** — a body-supplied location is the exploit above, wearing a
different hat.

`retrieveVariationPricesAt` omits any variation the merchant doesn't carry, so an
unstocked id fails closed as `"unavailable"` rather than selling at the base
price.

#### Sold out vs delisted

A lookup may return a `Map` (prices only) or `{ prices, outOfStock }`. The second
form is how `"out-of-stock"` is reached — a bare map can't express it, and
guessing would put the wrong sentence in front of a customer. Delisted is gone
and should leave the cart; sold out is coming back and is worth a notify-me.

Stock is checked **before** price, because a sold-out variation is usually still
priced.

```ts
const lookup: ScopedPriceLookup = async (ids, scope) => ({
  prices: await pricesFor(ids, scope),
  outOfStock: await soldOutAmong(ids, scope),
});
```

A plain `PriceLookup` stays assignable to `ScopedPriceLookup` — a single-location
store changes nothing.

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
_operation_ (`"order"` vs `"refund"`), not an identity.

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
we can safely _call_ Square, a different question from whether a card field can
render.

Under `square: { locations: "multi" }` the generated route is different, because
there is no ambient `SQUARE_LOCATION_ID` to charge against — Astroid drops it
from the credential roster precisely so nothing defaults to it. The route instead
scaffolds a `resolveLocationId(request)` you fill in, refuses the checkout when
it returns `null`, re-prices at that location live from Square, and charges the
same one. `SquareCard.astro` takes `locationId` as a prop rather than reading the
environment.

That route also runs the **dormancy gate before verification** rather than after
it: per-location re-pricing is itself a Square call, so checking provisioning
afterwards would call Square with a placeholder credential — the one thing the
route promises never to do. The cost is that an unprovisioned multi-merchant
store can't do the staleness check at all, and it reports that (`priced: false`)
instead of echoing the client's total back.

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

`squareToCatalogItem(item, { locationId })` resolves both halves at one merchant:
variations they don't carry are dropped, and the rest price through
`location_overrides` instead of the base price. The headline `price` is scoped
too — it means "from", so computing it over the whole catalog advertises a price
this merchant will never honour, and since the dropped variation is usually the
cheap one the error runs in the direction a customer notices at the till.

Filter with `squareItemSoldAt(item, locationId)` before syncing. An item sold
nowhere at that location has no variants and a price of 0, which mirrors as a $0
card:

```ts
const rows = items
  .filter((i) => squareItemSoldAt(i, locationId))
  .map((i) => squareToCatalogItem(i, { locationId }));
```

Omitting `locationId` is unchanged behaviour, and correct for a single-location
account.

### Roles

`astroidCommerceRoles`, `astroidCommerceProviders`, `assertCommerceRoles`,
`hasStorefront`, `resolveCommerceStatus`. Providers fill **roles**, not "the"
provider slot — a provider in a role it can't serve fails at config load.

## PWA

`modules: ["pwa"]` plus an optional `pwa` block. Two options matter for an app
that isn't the whole site:

**`offlineFallback`** — the page to serve when a navigation fails offline. Without
it the fallback is the scope root, i.e. the _dynamic app shell_, which is exactly
the wrong thing to precache on an auth-gated app: that response carries
`Cache-Control: no-store`, so either nothing is cached and the fallback is empty,
or a signed-in shell is stored and later served to whoever opens the app next.

Point it at a prerendered page with no session-specific markup. It's precached
with the shell — a fallback fetched on demand isn't there when it's needed.

**`emitDir`** — the subdirectory under `public/` to write `sw.js` and the manifest
into. For a PWA on its own subdomain that rewrites to a path prefix
(`studio.example.com/` → `/studio/`, see [Tenancy](#tenancy--serving-examplecom)),
the browser fetches `/sw.js` at _its_ origin root, which rewrites to
`/studio/sw.js`. Emitted at the public root, that's a 404 with nothing to explain
it.

```ts
modules: ["pwa"],
pwa: { scope: "/studio", emitDir: "studio", offlineFallback: "/offline" },
```

`_headers` stays at the public root — Cloudflare only reads it there — but its
stanza moves with the files, so the `no-cache` rule that stops a bad service
worker sticking around still applies.

With `scope` equal to the serving path, **no `Service-Worker-Allowed` header is
needed**: a worker may always control its own directory and below.

## Tenancy — serving `*.example.com`

```ts
tenancy: {
  hostPattern: "*.example.com",
  reserved: ["www", "studio", "api"],
  rewritePrefix: "/t",          // default
},
hosts: ["example.com"],          // required — see below
```

Serves **scoped views of this brand's data**, narrowed by host: a per-merchant
storefront, a per-client gallery. Same theme, same catalog, same editors. It is
the portal's _audiences_ axis one step further out, not multi-brand — a second
brand is still a second project.

`acme.example.com/prints` renders `/t/acme/prints`, so the pages live under
`src/pages/t/[tenant]/`. **The visitor's URL never changes** — it's an internal
rewrite, not a redirect, so links built from `Astro.url` stay public and correct.

**The apex must be in `hosts`.** A wildcard route does not match its own apex, so
without it `example.com` 404s the moment tenancy is switched on — a symptom that
reads as unrelated to the feature that caused it. `defineAstroid` refuses the
combination rather than letting you find out on deploy.

The wildcard is emitted as a **zone route** (`{ pattern, zone_name }`), never
`custom_domain: true` — Cloudflare refuses a wildcard custom domain, which is
precisely why `hosts` can't express this. `zone` defaults to the pattern minus
`*.`; set it explicitly for a deeper pattern, since `*.shop.example.com` is served
by the `example.com` zone.

### What Astroid does and doesn't decide

Astroid provides only what a site can't provide for itself: the wildcard Worker
route, and the wiring inside the single middleware file Astro permits. `reserved`
labels skip the lookup entirely and render the ordinary site.

**Everything that decides anything is yours**, in the scaffold-once
`src/tenancy.ts`:

```ts
export async function resolveTenant(label: string): Promise<Tenant | null> {
  // your lookup, your caching
  return { slug: label };
}
```

This runs on every request to a tenant host, so an uncached database lookup here
is a query per request.

**An unknown subdomain is a decision, not a default.** Returning `null` falls
through to the ordinary site — meaning a stranger who points a CNAME at you gets
your homepage. If that's wrong for the project, return `null` and refuse it in the
middleware's `guard` with a 404.

`tenantLabel(host, tenancy)` is exported and pure, so a site can unit-test its own
reserved list without standing up a request. It returns `null` for the apex, an
off-pattern host (a preview domain, `localhost`), a reserved label, and a dotted
label — Cloudflare's wildcard matches one level, and a dotted slug would put a
`/` in the rewrite path.

## Portal

`astroidPortal`, `astroidPortalGuardConfig`, `portalGuard`, `guardResponse`,
`requireCustomer`, `resolvePortalSession`, `isSameOrigin`, `definePortalNav`.

A second Better Auth instance for customers. The mount, cookie prefix, and
`portal_*` table prefix are **fixed, not configurable** — the studio keeps Better
Auth's defaults because the editor client hardcodes them, so the portal is the one
that moves. Two instances sharing a cookie prefix fails intermittently in
production and looks like a session bug.

The guard is fail-closed: a session resolver that throws degrades to _signed out_,
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
