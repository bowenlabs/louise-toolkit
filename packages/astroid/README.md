# astroidjs

**Astroid** — an opinionated meta-framework over
[Louise Toolkit](https://github.com/bowenlabs/louise-toolkit/tree/main/packages/louise)
and Astro for building editable, multi-editor sites on Cloudflare Workers.

> **Status: pre-1.0, experimental.** The API will change between minor versions —
> pin an exact version if you depend on it. Astroid lives in the same workspace as
> Louise so its opinions co-evolve with the toolkit.

## What it is

Louise is the unopinionated toolkit — primitives you assemble by hand. Astroid is
the opinionated preset on top: a theme system, a section library, and a single
config that generates the Louise wiring (worker routes, middleware, schema,
theme) a site would otherwise hand-write per repo.

```
Astro        →  renderer / router / build
  Louise     →  unopinionated primitives + framework glue   (louise-toolkit)
    Astroid  →  opinions: theme, sections, config, scaffold  (astroidjs)
```

## Design rule

Dependencies flow one way: **`astroidjs` → `louise-toolkit`, never the reverse.**
Louise must never import Astroid, and nothing opinionated is allowed into Louise's
exports. This keeps the toolkit neutral while Astroid holds the opinions.

## Configure

The whole shape of a project — its brand + theme + editable home, its commerce
backend and optional modules — collapses into one typed config. **One brand per
project:** every site Astroid targets serves a single brand from a single deploy,
so the config describes one brand, not an array. What actually multiplexes is
*editors* (Louise's org plugin) and *audiences* (a gated portal beside the public
site) — both options on the one brand. The vocabulary is drawn from the real
sites Astroid targets: a storefront (coracle.coffee), a wholesale front
(ghostfire.coffee), an artist portfolio (themidwestartist.com), and a plain
marketing baseline (louise-web).

```ts
import { defineAstroid } from "astroidjs";

export default defineAstroid({
  key: "coracle",
  archetype: "storefront",
  theme: { name: "Coracle Coffee", colors: { brand: "#1f6f78" } },
  sections: ["hero", "banner", "productGrid", "locationHours", "contact"],
  commerce: { provider: "square" },
  deploy: { platform: "cloudflare" },
});
```

A portfolio with a gated client area, for contrast:

```ts
export default defineAstroid({
  key: "megbowen",
  archetype: "portfolio",
  theme: { name: "Meg Bowen Studio", colors: { brand: "#2b2b2b" } },
  sections: ["hero", "gallery", "aboutIntro", "contact"],
  portal: { enabled: true },
  deploy: { platform: "cloudflare" },
});
```

## Commerce

**Providers fill roles.** Not "the commerce provider" — the toolkit's clients
make that impossible: `commerce/stripe` has no catalog API, `commerce/fourthwall`
has no invoicing, Square does both. So `storefront` and `invoicing` are assigned
independently, and a provider put in a role it can't serve fails at config load
rather than at runtime on the first invoice.

```ts
commerce: { storefront: "fourthwall", invoicing: "stripe" }   // two providers
commerce: { provider: "square" }                              // shorthand → storefront
```

**The catalog is mirrored with a pulled/owned split.** The provider is the source
of truth; D1 holds the owner's edits. `mode: "mirror"` keeps the catalog fields
in D1 (fast reads, briefly stale); `mode: "overlay"` keeps only the owner's
columns (never stale, one provider round-trip per read). The sync **never writes
an owned column** — a sync that does silently reverts the owner's work, and
they find out days later. `slug` is owned for that reason: it's the public URL,
so a provider rename must not break links.

```ts
commerce: {
  provider: "square",
  catalog: { owned: { tone: { type: "text", values: ["cream", "teal"] } } },
}
```

Everything else follows from that table. `astroidCatalogLoaderConfig` reads it
for the Live Content Collection, and the adapters normalize before the row is
written — so one loader definition serves a Square site and a Fourthwall site,
which is the drift the module exists to kill.

**Checkout is server-authoritative.** `verifyCheckout` treats the client's price
as a staleness check, never an input to the charge: re-price server-side, refuse
on mismatch. `checkoutIdempotencyKey` derives a stable key from the verified cart
**and a required `identity`**, so a double-clicked Pay button charges once —
while two customers buying the same thing stay two charges.

```ts
const key = await checkoutIdempotencyKey(check, "order", cartId);
```

Pass something stable across a retry of this attempt and distinct between buyers
(a cart id, checkout-session id, or portal user id). It is required, and empty is
refused, because a key derived from cart contents alone collides between
customers: providers scope idempotency keys per account for ~24h, so the second
buyer's charge is deduped into the first buyer's order and never happens.

## The webhook pipeline

Configure `commerce` and the generated worker stops being fetch-only: it composes
Astro's SSR handler with a **queue consumer** and a **cron**, and the scaffold
gains a webhook receiver plus a consumer seam. `--commerce <provider>` on
`pnpm create astroid` sets it all up.

The receiver's ordering is the part worth knowing. `handleWebhook` verifies the
HMAC over the **raw body before anything parses it** — parse first and an
unauthenticated caller reaches the JSON parser and everything downstream, and
re-serializing a parsed body to check a signature is how signature checks quietly
stop checking anything. It then enqueues and returns, so the response doesn't
wait on the work.

Status codes are the only backpressure signal a provider gives you, so each one
is picked for what it tells the sender to do:

| Situation | Code | Why |
|---|---|---|
| Secret unprovisioned | 503 | Dormant is temporary — keep retrying so events delivered before you set the secret still land |
| Bad / missing signature | 401 | Terminal. It won't verify on retry either, and retrying turns a misconfiguration into a flood |
| Body isn't JSON | 400 | Terminal for the same reason |
| Enqueue failed | 503 | The signature checked out, so the event is real — ask for redelivery |
| Enqueued | 202 | Accepted, not done. That's the point of a queue |

On the consumer side `astroidQueueHandler` owns the dispatch every site wrote: a
periodic refresh re-syncs, a webhook re-syncs *only* if it touched the catalog,
and everything else acks as a no-op. That last part matters — order and payment
events arrive in volume and have nothing local to update, so treating them as
actionable turns a busy sales day into a refresh storm.

The cron **enqueues** rather than running inline, so the safety-net re-sync takes
the same retry and DLQ path as everything else. Retries and DLQ routing live in
`wrangler.jsonc`, because they're Cloudflare's job, not the consumer's.

## Transactional email

Four templates — sign-in link, password reset, and the inquiry pair (notify the
owner, confirm to the sender) — over the toolkit's email shell. Each renders HTML
**and** plaintext from one definition: a message with no text/plain part scores
worse with spam filters, and for a sign-in link the plaintext body is what a
terminal client shows and what the dev log prints.

`astroidMailTheme(config)` derives the whole mail theme from `theme.colors`.
Neutrals stay fixed (they're typography choices, not brand ones); what varies is
the accent and the five-cell masthead band, built as a ramp so it reads as
designed whether you configured one brand colour or three. The accent is
**contrast-corrected** — a brand yellow used verbatim as 11px uppercase text on a
near-white card is unreadable, and mail clients have no dark-mode escape hatch.
Pass overrides for any slot you want to own.

Delivery is best-effort and never throws. Mail here is always the notification of
something already durable — the inquiry row is inserted, the account exists — so
a failure must not fail the request that caused it, and messages send
independently so the owner's copy still arrives when a visitor typos their
address. With no `EMAIL` binding the mailer is **dormant**: it logs the rendered
message instead of dropping it, which is what makes "click the magic link" work
under `wrangler dev`.

```ts
formRoute({
  form: contactForm,
  // Fires after the insert, off the response path — store-and-forward.
  onSubmit: (values, env) => sendInquiryMail(astroidConfig, env, values),
});
```

## SEO

A settings-driven head, structured data, and the two crawler files — first-party,
no `astro-seo` dependency.

`<Seo>` resolves three levels (page override → the page's own default →
`site_settings`) with one rule worth knowing: an **empty string is unset**, so
clearing a field in the editor falls back instead of publishing a blank `<meta>`.
The title template applies only when a page supplies its own title, so the home
page reads `Acme Coffee`, not `Acme Coffee | Acme Coffee`. `disableIndexing` in
settings is a site-wide kill switch that beats any page asking to be indexed —
useful for staging.

`<StructuredData>` emits a schema.org `@graph`: the business, the `WebSite`, and
optionally the entity the page is *about* (a Product, a VisualArtwork). The
business `@type` comes from the archetype (`storefront` → `Store`, `portfolio` →
`Person`); set `seo.businessType` to a narrower subtype whenever you know one.
The payload is escaped with `escapeJsonLd`, not `JSON.stringify` — `stringify`
doesn't escape `<`, so an editor-authored value containing `</script>` would
close the tag early and inject markup into `<head>`.

`robots.txt` and `sitemap.xml` derive their disallow list from the same config
(`astroidNoindexPaths`), so the two files can't disagree about what's crawlable.
Both are **origin-aware** — built from the serving origin rather than a
configured domain, because a preview deploy advertising the production host
invites its content to be indexed under the real domain.

## Security defaults

Two stack-wide concerns every site was re-deriving by hand, moved into the
framework.

**Rate-limit rules are data, derived from the config.** The generated middleware
calls `astroidRateRules(config)`: the editor magic-link always (the
email-bombing target, so the tightest budget in the set), the portal's
credential surfaces when `portal.enabled`, checkout when `commerce` is set. The
session-gated editor API stays out on purpose — a limiter that can lock the
owner out of their own studio is worse than the abuse it stops. Add or override
via `security.rateRules`, which is matched *before* the defaults, so you replace
one budget rather than the whole set.

**The CSP is composed, and it's split for a reason.** `astroidSecurity(config)`
gives `astro.config.mjs` its `security` block. Astro owns `script-src` — it
hashes every script it processes, so the policy needs no `'unsafe-inline'` — and
Astroid adds the one hash Astro can't produce itself: Solid's hydration
bootstrap, injected by `@astrojs/solid-js` on every page with an island.
Computing it from `generateHydrationScript()` means it tracks solid-js upgrades
instead of going stale as a copy-pasted literal. Meanwhile the generated
middleware rewrites *only* `style-src`, because Louise's data-driven `style=""`
carriers need `'unsafe-inline'` and a single hash in that directive would void
it per spec — the two cannot share one directive.

```js
// astro.config.mjs
import { ASTROID_VITE_BUILD, astroidSecurity } from "astroidjs/astro";
import astroidConfig from "./astroid.config.ts";

export default defineConfig({
  security: astroidSecurity(astroidConfig),
  vite: { build: { ...ASTROID_VITE_BUILD } },  // assetsInlineLimit: 0 — an
});                                            // inlined asset can't be hashed
```

Enabled modules contribute their own origins (a commerce provider's SDK hosts,
the captcha frame); `security.cspOrigins` adds anything Astroid can't see.

## Modules are dormant, not broken

Astroid's optional modules are opt-in at the *config* level, never at the
*account* level: switching commerce on must not require a Square account before
`pnpm dev` will boot. So a module whose secrets aren't provisioned is **dormant**
— it renders, it serves, it says out loud that it's simulated, and it never calls
upstream with a dummy credential. A fresh clone runs with zero external accounts.

`create-astroid` seeds every module secret with one loud sentinel,
`DUMMY_REPLACE_ME`, so a scaffold has a complete and valid binding set and no
real credentials. Reading a secret back that still holds the sentinel — or that
is absent, empty, or bound to an unprovisioned store — yields `null`:

```ts
import { resolveModuleSecrets, describeModuleStatus } from "astroidjs";

const secrets = await resolveModuleSecrets({
  SQUARE_ACCESS_TOKEN: env.SQUARE_ACCESS_TOKEN,
  SQUARE_WEBHOOK_SECRET: env.SQUARE_WEBHOOK_SECRET,
});

if (!secrets.configured) {
  console.warn(describeModuleStatus("commerce", secrets));
  // → commerce: dormant (simulated) — unprovisioned secret(s): SQUARE_WEBHOOK_SECRET
  return simulatedCheckout();
}
```

Partial provisioning counts as dormant. A half-configured integration fails
mid-checkout rather than at boot, which is precisely the failure this convention
exists to prevent.

The scaffold ships one worked example: Turnstile captcha on the **editor
sign-in**, seeded with the sentinel secret plus Cloudflare's always-passing test
site key, enforcing only once **both** halves are real — so provisioning one of
them can't lock you out of your own sign-in.

Both halves matter, and the second one is the reason this is worth spelling out.
`getLouiseAuth` registers Better Auth's captcha plugin on `/sign-in/magic-link`
as soon as the pair is real, and that plugin rejects any request without an
`x-captcha-response` header. So the login page renders the widget under exactly
the same condition the server arms the check — `turnstileSiteKey` returns null
for the test key, the same test `activeCaptchaSecret` applies — and forwards the
token in that header. A gate that turns on server-side while the page keeps
posting without a token is not a half-configured integration; it is a locked
door with the owner outside.

The **public contact form** is a separate surface and is not captcha-gated: its
spam defence is the honeypot, the minimum time-to-submit, and the rate limit.
`FormSpamConfig.turnstile` exists in the toolkit if you want to add it, but
`formRoute` is generated without `turnstileSecret`, so switching the flag on
alone would not enforce anything.

## CLI

The `astroid` command turns the config into the Louise wiring and keeps it in
sync. It loads your `astroid.config.ts` with Node's native TypeScript stripping,
so there is no separate config-compile step.

```
astroid generate   regenerate src/schema.ts, src/worker.ts, src/middleware.ts from the config
astroid doctor     validate the config, the wrangler bindings, and generated-file freshness
astroid dev        regenerate, then run `astro dev`
astroid build      regenerate, then run `astro build`
astroid deploy     provision bindings + migrate + secrets + deploy (--dry-run / --yes)
```

`deploy` is plan-first: it prints exactly what it will run and refuses to
provision non-interactively without `--yes` (use `--dry-run` to preview).

The generated trio carries a "do not hand-edit" banner — `generate` (and
`dev`/`build`) rewrite them on every run, and `doctor` diffs them against your
config to catch drift. Your `wrangler.jsonc` is scaffolded once and then yours to
edit (real binding ids, secrets); `generate` never touches it.

New projects come from the `create-astroid` scaffold (`pnpm create astroid`), which
writes the floor — config, the generated trio, `wrangler.jsonc`, and the baseline
Astro app — in one step.

## Roadmap

1. ✅ **Config surface** (`defineAstroid`) — single brand per project.
2. ✅ Config → generated Drizzle schema.
3. ✅ Config → generated `worker.ts` + middleware (no hand-wired route ordering).
4. ✅ `<Section>` / `<Editable>` / `<Collection>` component primitives.
5. ✅ **CLI** — `astroid generate / doctor / dev / build / deploy`; `create-astroid`
   scaffold (`pnpm create astroid`).

## License

[MIT](https://github.com/bowenlabs/louise-toolkit/blob/main/LICENSE) © BowenLabs
