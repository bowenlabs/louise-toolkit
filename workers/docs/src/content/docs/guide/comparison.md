---
title: Comparison & non-goals
description: How Louise differs from Tina, Sanity, and Payload — and the deliberate non-goals that tell you when it isn't the right tool.
sidebar:
  order: 13
---

Louise is a **toolkit for building editable sites on Astro + Cloudflare Workers**.
Editable content is the headline, but it's one of ~two dozen primitives —
alongside commerce, media, forms, auth, queues, email, AI, analytics, realtime,
and workflows. So a head-to-head "which CMS" table undersells it. This page is
still useful for evaluating the part that _does_ overlap — the editing model —
and, just as important, for telling you when Louise is the **wrong** choice.

## The short version

Tina, Sanity, and Payload are excellent, mature content platforms with large
ecosystems. Reach for one of them when you want a **headless content backend** —
a decoupled API that feeds any number of frontends, hosted infrastructure or a
database server, and a large editorial team.

Reach for **Louise** when your site _is_ the product: an Astro app on Cloudflare
where owners edit the live, server-rendered page in place, everything runs
V8-native on your own Cloudflare account, and you want commerce / forms / media /
auth / AI from the same toolkit rather than stitched-together services.

## On the editing axis

| | **Louise** | TinaCMS | Sanity | Payload |
| --- | --- | --- | --- | --- |
| Editing model | Edit the real, server-rendered page **in place** | Contextual editing (React overlay) | Sanity Studio (separate React app) | Generated admin app (React) |
| Runtime | **V8 / Cloudflare Workers** (no Node) | Node / Git backend | Hosted "Content Lake" (SaaS) | Node (Express or Next.js) |
| Datastore | **Your D1 + R2** | Git (Markdown/MDX) + Tina Cloud | Sanity-hosted | MongoDB or Postgres |
| Hosting | **Self-hosted on your Cloudflare account** | Self-host + optional Tina Cloud | SaaS | Self-host |
| Frontend framework | **Astro** (core primitives framework-agnostic) | React-oriented | Any (headless) | Any (headless) |
| Separate admin app? | **No** — the site is the surface | No (overlay) | Yes | Yes |
| Scope | **Full toolkit** (commerce, forms, media, auth, AI, …) | Content | Content | Content (+ plugins) |
| License / cost | **MIT, no per-seat pricing** | OSS + paid cloud | Free tier → usage pricing | OSS + paid cloud |

_Competitor details are summarized in good faith and evolve; check each project's
current docs. The point is architectural shape, not a feature scorecard._

### What actually differs

- **No separate admin.** There's no Studio, no `/admin` React app, no overlay
  bolted onto your frontend. An editor logs in and the live page becomes
  editable where the content lives — text where the text is, structured sections
  through your own components.
- **V8-native, edge-first.** Everything runs in workerd / Cloudflare Workers with
  D1 and R2 as the datastore. No Node runtime, no database server to operate, no
  hosted content lake in the loop. Published pages ship **no editor JS** (the
  client self-gates to edit mode).
- **It owns render + edit + schema, but not your markup.** Louise is not headless
  — it renders, edits, and stores — yet the site still owns every pixel; editors
  change content and structured sections through _your_ components.
- **Content is one primitive of many.** Commerce (Stripe / Square / Fourthwall),
  forms, media, auth, AI (Workers AI: alt text, rewrite, SEO, embeddings),
  queues, email, realtime, and workflows are all first-party, dependency-injected
  primitives — not a marketplace of third-party plugins.

## Non-goals

These are deliberate. Knowing them up front saves you from adopting Louise for a
job it isn't built for.

- **Not multi-cloud.** The batteries assume **Cloudflare** — D1, R2, KV, Queues,
  Workers. The core primitives are dependency-injected and framework-agnostic
  (they run in any Worker or a unit test), but Louise is not trying to abstract
  over AWS / Vercel-Node / a self-managed Postgres. If you're not on Cloudflare,
  it's the wrong tool.
- **Astro-first.** The inline-edit client, the theme, and Astroid target **Astro
  on Cloudflare**. Bare Workers or another framework can consume the core
  primitives, but the batteries-included path is Astro.
- **Not a hosted SaaS.** There's no dashboard-as-a-service, no managed backend,
  no SLA. You run it on your own Cloudflare account.
- **Not a headless content API for many frontends.** Louise renders where it's
  edited. If you need one content backend feeding a website _and_ a mobile app
  _and_ a kiosk, a headless CMS (Sanity / Payload) fits better.
- **Not a freeform page builder.** It is not a drag-and-drop canvas that authors
  markup. The site owns the design; editors work within your components and a
  structured section catalog, never a blank HTML canvas.
- **Pre-1.0.** The many granular subpath exports may still change; breaking
  changes ship as a `minor` bump until 1.0 (see [Contributing](https://github.com/bowenlabs/louise-toolkit/blob/main/CONTRIBUTING.md)).

## Louise vs. Astroid

If Louise's "assemble the primitives yourself" model sounds like a lot of wiring:
that's what **Astroid** — the opinionated meta-framework layered over Louise —
exists to remove. One typed `defineAstroid` config generates the worker routes,
middleware, schema, and theme a site would otherwise hand-write, and
`pnpm create astroid` scaffolds the whole app in one command.

Both are published and both are pre-1.0. The rule of thumb: **adding editing to an
app you already have → Louise; starting a new site on Cloudflare → Astroid.**
Astroid lives in the same workspace so its opinions co-evolve with the toolkit.
See the [Astroid guide](/guide/astroid/).

## Credibility

Louise is **pre-1.0 and dogfooded on four production sites** —
[coracle.coffee](https://coracle.coffee), [ghostfire.coffee](https://ghostfire.coffee),
and [themidwestartist.com](https://themidwestartist.com) among them — so its
primitives are shaped by real usage, not a spec. The
[public roadmap](https://github.com/bowenlabs/louise-toolkit/milestone/1) tracks
what's next in the open.
