# ADR 0001 — Opinionated Astro-on-Cloudflare, fully typed

- **Status:** Accepted (2026-07-15)
- **Deciders:** Baylee (solo maintainer)
- **Supersedes:** the implicit "framework-agnostic toolkit" positioning

## Context

Louise began as a **framework-agnostic** toolkit: generic wrappers over Cloudflare
primitives (a hand-rolled Worker router, a bespoke `s.*` schema builder, a
Payload-style content layer) so the code could be reused across any stack. The
justification for that abstraction tax was _"the same code runs in all my
repos."_

That premise no longer holds, and the consuming sites prove it:

- **Version/identity drift.** `themidwestartist.com` and `coracle.coffee` are on
  `louisecms@0.9` (the _old_ package name); `ghostfire.coffee` is on
  `louise-toolkit@0.13`. Three sites, two package identities. There is no single
  shared version to speak of.
- **The sites already left the abstraction behind.** All three already use
  `@astrojs/solid-js` islands, `src/actions/` (Astro Actions), `src/islands/`,
  `src/loaders/`, and `live.config.ts`. `themidwestartist.com` already depends on
  `hono`. The toolkit's own `workers/site` reference app is the _only_ one without
  these — the reference is behind the real sites.
- **The recommended split is already in production.** `themidwestartist.com`'s
  `actions/index.ts` header reads: _"Astro-native mutation surface … Editor
  mutations live under `/api/louise/_`."* Its `ContactForm.tsx`island already
calls`actions.inquiry(...)`. The architecture below is largely **ratifying
  what the sites already do**, not inventing something new.

The real constraint is **supportability for one person**. Bespoke wrappers
(`composeWorker`, `s.*`) are code _the maintainer_ owns forever. Replacing them
with maintained, popular libraries (Astro-native APIs, Hono, Zod) is _less_ code
owned, not more — and it matches what the sites already reach for.

At the same time, the framework-agnostic property is genuinely valuable **where
it costs nothing** — a rate limiter, an OG renderer, a sanitizer, an R2 media
helper import no framework; they just take Cloudflare bindings. That portability
is a free side effect of a thin wrapper, not a tax.

## Decision

**Commit to being an opinionated Astro-on-Cloudflare toolkit.** Stop treating
framework-agnosticism as a _requirement_; keep it only where it is free.

### The rule (apply per module)

> **Framework-agnostic where it's free; opinionated where it's expensive.**
>
> For each module ask: _does this earn its keep for an Astro + Cloudflare site
> specifically, or does it only exist to stay stack-independent / avoid a
> dependency?_ If the latter, collapse it toward the native tool. If it's a thin
> binding wrapper that's portable for free, leave it.

### Target: three typed layers (built bottom-up)

Goal — _everything as typed and structured as possible._ **Types flow from
schemas, not from transport**, so the schema layer is the foundation.

1. **Schema — Zod as the single source of truth.** Collections, forms, settings,
   and API inputs expressed as Zod; `z.infer` yields document, API-I/O, and
   client-payload types from one definition. `defineCollection`/`defineForm`
   already accept any Standard Schema, so Zod becomes the _default_, not a
   rewrite. `collectionToAstroSchema` (issue #92) already derives Zod from a
   collection — extend the same bridge to forms.
2. **Typed API — split by surface, never duplicated:**
   - **Astro Actions** for **in-app mutations** (editor save/settings/publish,
     public forms). Native, Zod-validated, structured errors, no new dependency.
   - **Hono** as an optional `louise-toolkit/worker/hono` adapter for the
     **standalone / agent-facing API** (the MCP server #103, external consumers,
     the sandbox) where a typed router + an `hc<AppType>` RPC client is wanted.
3. **Typed client — falls out for free.** `actions.*` inside the app (from Solid
   islands, as the sites already do); `hc` for the external/MCP client.

### What stays as the differentiated core

The Cloudflare-native primitives that actually make CF easier: the D1
content/editor layer, media/R2, OG rendering, rate limiting, and — the flagship —
the **MCP server** (#103). Product framing shifts from "framework-agnostic CF
toolkit" to **"batteries-included Astro-on-Cloudflare CMS"** (a sharper, more
adoptable story), delivered via `create-louise` (#104) + the OSS surface (#105).

### On the routing question (issues #78 / #94)

Keep `composeWorker` as the **zero-dependency default** entrypoint — it is the
only thing that attaches `queue`/`scheduled` (the `@astrojs/cloudflare` adapter
entry exports `fetch` only). Hono enters as an **optional peer** behind its own
export subpath (exactly like the 11 optional peers already gated this way), so
sites that don't import it never pay for it. `src/fetch.ts` stays an optional
Astro-adapter detail, not a replacement for the primitive.

## Consequences

**Positive**

- Less bespoke code owned by one maintainer; more leverage on maintained libs.
- The reference `workers/site` gets pulled _up_ to the sites' real patterns
  (islands + Actions + Zod), so it stops lying about how the toolkit is used.
- Sharper positioning and a cleaner path to `create-louise` / OSS adoption.
- End-to-end types across schema → API → client.

**Negative / risks**

- A migration surface across the sites (mitigated: the maintainer is the only
  consumer, so it's incremental and self-paced — no external breakage).
- Some current framework-agnostic seams get retired; that's intended, not a
  regression.

**Non-goals**

- This is **not** "turn Louise into a framework." The move is to _shrink_ the
  abstraction surface, not add a framework layer on top.
- No big-bang rewrite. Migrate per module, on the maintainer's timeline.

## Migration checklist (incremental, per module)

- [ ] Retire the package-name/version drift: get every site onto
      `louise-toolkit@latest` (off `louisecms`).
- [ ] **Schema:** make Zod the default; derive collection/form schemas via the
      `collectionToAstroSchema`-style bridge; treat `s.*` as legacy/optional.
- [ ] **Actions:** give public/editor mutations Zod `input` schemas (close the
      `accept:"form"` + hand-written-interface gap seen in `themidwestartist`'s
      `inquiry` action) for end-to-end inference.
- [ ] **Reference site:** bring `louise-toolkit/workers/site` up to the sites'
      pattern — `@astrojs/solid-js` islands, `src/actions/`, typed Action save.
      _(This ADR ships with a first proving slice of exactly this.)_
- [ ] **Hono adapter:** add optional `louise-toolkit/worker/hono` (optional peer)
      for the MCP/agent/external API when RPC types are wanted; keep
      `composeWorker` as the default.
- [ ] **Per module**, apply the rule above; delete wrappers whose only job was
      portability that no site uses.
