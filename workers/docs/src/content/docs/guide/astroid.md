---
title: Astroid
description: The opinionated meta-framework over Louise and Astro — one typed config that generates the worker, middleware, and schema a site would otherwise hand-write.
sidebar:
  order: 14
---

Louise is the unopinionated toolkit: primitives you assemble yourself. **Astroid**
is the opinionated preset on top — a section library, a theme system, and a single
typed config that generates the Louise wiring a site would otherwise write by hand.

```
Astro        →  renderer / router / build
  Louise     →  unopinionated primitives + framework glue   (louise-toolkit)
    Astroid  →  opinions: theme, sections, config, scaffold  (astroidjs)
```

Dependencies flow one way — `astroidjs` → `louise-toolkit`, never the reverse.

:::caution[Pre-1.0, and moving fast]
Both packages are published (`astroidjs`, `create-astroid`) but pre-1.0. Breaking
changes ship as a **minor** bump, so pin an exact version if you depend on one.
:::

## Which one do I want?

| | Louise | Astroid |
|---|---|---|
| You already have an Astro app | ✅ add it | ❌ scaffolds a new one |
| You want to choose your own schema, routes, auth | ✅ | ❌ it chooses for you |
| You want a running editable site today | assembly required | one command |
| You need a page-builder + section library | build it | ships 15 sections |

If you're adding editing to an app you already have, use [Louise directly](/guide/quickstart/).
If you're starting a brand-new site on Cloudflare, start here.

## Scaffold

```sh
pnpm create astroid my-site
```

Every option is prompted for; in a non-TTY each prompt takes its default, so the
command is CI-safe. The target directory must be empty.

```
pnpm create astroid [directory] [options]

  --name <name>         Brand / site name
  --key <slug>          Project key (slug); names the generated bindings
  --archetype <type>    marketing | storefront | wholesale | portfolio
  --color <hex>         Brand color
  --host <domain>       Primary domain, e.g. example.com
  --commerce <provider> square | stripe | fourthwall
  --map                 Self-hosted PMTiles/MapLibre location map
  --pwa                 Installable PWA (scoped service worker + manifest)
  --portal              Customer/member portal (a second, isolated auth instance)
  --realtime            Live multi-editor editing (a per-page Durable Object)
```

You get a working floor, not a blank page: an inline-editable home page,
magic-link editor sign-in, the editor drawer wired up, migrations, and a
`wrangler.jsonc` with every binding stubbed.

## One config

The whole shape of the project is one typed file. `astroid generate` turns it
into `src/schema.ts`, `src/worker.ts`, and `src/middleware.ts`.

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

**One brand per project.** Every site Astroid targets serves a single brand from a
single deploy, so the config describes one brand, not an array. What multiplexes
is *editors* (Louise's org plugin) and *audiences* (a gated portal beside the
public site).

### Archetypes

`marketing` (the lean brochure floor), `storefront` (DTC shop), `wholesale`
(B2B/private-label), `portfolio` (gallery + client portal). An archetype is a
preset of defaults — which sections are on, which tables exist — that the site
then tunes, not a fork.

### Sections

The editable home page is an ordered list of section types. Astroid ships 15:
`hero`, `featureGrid`, `cta`, `gallery`, `media`, `splitImage`, `steps`, `banner`,
`faq`, `pricingTiers`, `testimonial`, `aboutIntro`, `productGrid`,
`locationHours`, `contact`.

The vocabulary is **derived from the catalog**, so a section name that has no
component is a compile error rather than a page that silently fails to render.

## The CLI

```sh
pnpm dev        # astroid dev     — regenerate, then astro dev
pnpm build      # astroid build   — regenerate, then astro build
pnpm doctor     # astroid doctor  — validate config, bindings, generated files
pnpm generate   # astroid generate — rewrite the generated trio
wrangler deploy # or: astroid deploy (plan-first provisioning)
```

### Generated vs. scaffold-once

This distinction is the one worth internalising:

- **Generated** — `src/schema.ts`, `src/worker.ts`, `src/middleware.ts`. A pure
  function of your config, rewritten on every `generate`, and they carry a
  do-not-hand-edit banner. `doctor` fails if one has drifted.
- **Scaffold-once** — `wrangler.jsonc`, `src/auth.ts`, `src/queue.ts`,
  `src/portal-auth.ts`, the service worker, the map embed. Written when absent and
  never overwritten, because each exists to be edited. `wrangler.jsonc` is in this
  set specifically so a provisioned binding id is never clobbered.

Switching a module on later is a config edit plus `astroid generate` — it writes
whatever scaffold-once files the new module needs and leaves your existing ones
alone.

## Modules

Opt-in capabilities, each pulling real infrastructure:

- **`commerce`** — a catalog mirror in D1 with a pulled/owned split, a webhook
  receiver, a queue consumer, and a cron safety net. Providers fill **roles**
  (`storefront` / `invoicing`) rather than being "the" provider, because
  `commerce/stripe` has no catalog API and `commerce/fourthwall` has no invoicing.
  A **Square** storefront also gets the server-authoritative payment seam:
  `src/pages/api/checkout.ts` re-prices every line from the D1 mirror (the
  client's price is a staleness check, never an input to the charge), derives an
  idempotency key from the cart *and* a cart id, and charges only once commerce
  is really provisioned — otherwise it simulates rather than calling Square with
  a placeholder credential. `<SquareCard>` mounts the Web Payments card field,
  which is an iframe from Square's CDN, so the raw card number never reaches the
  Worker. **The cart itself is yours** — where it lives and what it holds is a
  project decision, and a half-opinionated cart is worse than none.
- **`portal`** — a second, fully isolated Better Auth instance for
  customers/members: its own mount, cookie prefix, and `portal_*` tables, so a
  portal account can't sign into the studio.
- **`map`** — a self-hosted PMTiles basemap served from R2, brand-recoloured. No
  API key, no external tile host.
- **`pwa`** — a scoped service worker that never caches `/api/*` or the editor,
  plus a derived manifest.
- **`realtime`** — live multi-editor editing on a page: a per-page Durable Object
  holding presence, field sync, and a rich-text soft-lock. See below.

## What's on by default

Three things are wired into every scaffold rather than hidden behind a flag,
because each has a client half that already ships in the editor drawer — leaving
them unmounted meant rendering UI for a subsystem that could never have data.

- **The Home dashboard** (`overviewRoute`) — draft counts, unpublished changes,
  last edit. It's the drawer's initial panel, so it's the first screen an owner
  sees.
- **AI assists** (`aiRoute`, `seoFixRoute`, alt-text on upload) — rewrite a
  selection, suggest SEO, describe an image. All editor-gated, and all degrade to
  a hidden button when the `AI` binding is absent, so they cost nothing unused.
- **The typed Actions surface** (`src/actions/index.ts`) — `save`, `saveDraft`,
  and `settings` as Astro Actions beside the raw routes. Not a second
  implementation: each shares its route's store path, so a field is validated
  once and written in one place however it was called. Add your own beside them.
- **Real-visitor Core Web Vitals** — a beacon in `public/vitals.js` posts LCP,
  CLS, and INP to an Analytics Engine dataset, and the daily health scan reads
  the p75 back. Collection is free and needs nothing; the read-back needs
  `CF_ACCOUNT_ID` + `CF_API_TOKEN` (the SQL API is account-scoped and has no
  binding), and until those are real the badge reads "not measured yet".
- **Site health** (`healthRoute` + a daily cron) — broken links, images missing
  alt text, published pages with SEO gaps. The summary is stored in the existing
  `RL` namespace under its own key, so there's no extra binding to provision.
  Until the first scan runs the panel says "not checked yet". The inbox card
  counts unhandled inquiries — the whole table, because the Inquiries tab
  reviews and *clears* submissions, so a surviving row is one still waiting.

### Edge caching (off by default)

The generated worker wraps Astro's SSR fallback in `withEdgeCache`, Louise's
**cookie-aware** Worker Cache API layer. It ships wrapped but inert: the var
`ASTROID_EDGE_CACHE` is `"false"`, so every render emits `no-store` and the layer
stores nothing.

Why cookie-aware matters: Cloudflare's *automatic* edge cache is keyed by URL and
runs **before** your Worker, so it cannot see the edit cookie — it will serve a
cached public page to a signed-in editor, drafts and all. `withEdgeCache` runs
inside the Worker, inspects the request first, and strips the CDN directive from
every response so the automatic cache never engages. This feature was reverted
twice before that distinction was understood.

**Do not enable it straight on production.** `caches.default` is not cleared by
Cloudflare Dev Mode or "Purge Everything," so a bad flip is hard to walk back.
Turn it on for a preview deploy and walk the activation runbook in
`docs/adr/0004-edge-caching.md` first: verify an anonymous second request is
served from cache, an editor always renders fresh, and a publish shows up within
the 60s TTL.

That TTL is short on purpose — `caches.default` is per-colo with no global purge,
so `maxAge` is the real worldwide freshness floor after a publish.

### Crons

`wrangler.jsonc` gets a `triggers.crons` list, and the generated worker's one
`scheduled` handler dispatches on `controller.cron` — Cloudflare fires a single
handler for every trigger and that string is the only way to tell them apart.

| Cron | What runs |
|---|---|
| `17 4 * * *` | The daily site-health scan. Always. |
| `0 * * * *` | The catalog re-sync safety net. Commerce only; `queues.cron: false` disables it. |

### Realtime editing

`modules: ["realtime"]` turns editing into a live session. A per-page Durable
Object holds presence and authoritative field state, broadcasts changes to the
other editors on that page, and coalesces writes to D1 on an alarm.

Two properties are worth knowing:

- **It augments, it does not replace.** With the module off, the socket unopened,
  or the connection dropped, the client falls back to the existing debounced
  auto-save. Realtime is an accelerator, never a dependency.
- **There is one write path.** The session's flush goes through `applySaveDraft`
  — the same merge-over-pending-draft the fetch auto-save uses — so drafts,
  version history, publish semantics, and read-your-writes are all unchanged. The
  DO is a new front end to that path, not a parallel store.

The rich-text body takes a **soft-lock** (one editor at a time) rather than being
last-writer-wins clobbered, and locked values are never fanned out to peers — so
raw rich text doesn't cross sockets.

Astroid scaffolds `src/edit-session.ts` (the DO subclass — it must import
`cloudflare:workers`, so it can't live in the toolkit), the `durable_objects`
binding, and the migration block. That last one is the part nobody gets right
from memory: a DO class needs a migration tag, it must be `new_sqlite_classes`
rather than `new_classes`, and the storage backend **cannot be changed after the
class is first deployed**.

## Dormant until provisioned

Astroid's modules are opt-in at the **config** level but not at the **account**
level: switching commerce on must not require a Square account before `pnpm dev`
will boot.

So every module follows one rule — a module whose secrets are unprovisioned is
**dormant**. It renders, it serves, it says out loud that it is simulated, and it
never calls upstream with a dummy credential. `create-astroid` seeds every secret
with a loud `DUMMY_REPLACE_ME` sentinel, so a fresh clone has a complete, valid
binding set and zero real credentials.

`astroid doctor` reports which modules are dormant and exactly which secrets are
still missing.

## Next steps

- [Astroid API reference](/reference/astroid/) — the exported surface.
- [Sections](/guide/sections/) — the underlying section/block model Astroid's
  catalog is built on.
- [Inline editing](/guide/inline-editing/) — how the edit markers work.
