# ADR 0015: Two audiences, one product: the developer toolkit and the owner platform

- **Status:** Proposed (2026-09-26)
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0001 (opinionated Astro-on-Cloudflare), ADR 0009 (agents edit over the Local API), ADR 0016 (privacy-first), ADR 0019 (one owner interface), epic #481, the platform plan in louise-ops

## Context

Every entry point to Louise speaks to a developer: the README tagline, CONTRIBUTING, the docs description, the quickstart, and the reference site's home ("Stop building admin panels"). That's accurate. `louise-toolkit` is a set of primitives, `@louise-toolkit/astro` is the adapter, and astroidjs holds the opinions.

The people who use what those developers build are small business owners. Three client sites run on the kit, and the owner's experience of Louise is the editor, the sign-in page, and whatever the site's developer wired for them. Nothing in the docs speaks to that owner except one guide page. The comparison page's non-goals go further and say there's "no dashboard-as-a-service" and "no SLA," and that a website plus a mobile app is the wrong fit. Those lines were true of the open source project and were never meant as limits on what someone builds with it, but a reader can't tell.

The plan of record now adds an owner-facing layer: an owner bar and home at `/louise` (ADR 0019), tickets and feedback in the site, an operator surface in louise-ops, service tiers, and later an iOS app. Bowen Labs runs that layer for its clients. Without a positioning decision, the project would either drift into "a platform, not a toolkit" and lose the developers it exists for, or keep its non-goals and contradict the owner layer it's building.

## Decision

### 1. Louise is both, and the toolkit builds the platform

Louise has two audiences and one product line:

- **The developer toolkit:** `louise-toolkit`, `@louise-toolkit/astro`, and astroidjs. Open source, MIT licensed, unopinionated at the package level, opinionated in astroidjs. A developer adopts it to build an editable site on Astro and Cloudflare.
- **The owner platform:** what those packages build for the person who runs the site. The owner interface, `/louise`, self-service settings, tickets, and the monitoring and support that sit behind them. It's privacy-first (ADR 0016) and it ships in the same packages, so any developer who adopts the toolkit gets it.

The platform is a consequence of the toolkit, not a fork of it. A feature that only a managed engagement would use still ships in the open source packages when it's reusable, per the framework-first rule in CLAUDE.md. What stays outside the packages is Bowen Labs' own operation: its site registry, its Watchtower, its contracts, and its tiers.

### 2. Bowen Labs' managed service is one way to run the platform

A managed engagement (provisioning, monitoring, support tiers, handoff) is how Bowen Labs runs the platform for its clients. It isn't the only way. A developer can run the same packages on their own Cloudflare account with no relationship to Bowen Labs, and the docs must keep reading that way.

### 3. The docs get two doors, not a rewrite

The developer positioning stays. The README leads with the toolkit tagline and adds a short paragraph that sends an owner to their door. The docs sidebar gains a **For owners** section beside Guide and Reference, grown from the existing editing guide: sign in, edit, publish, settings, ask for help, and what your site stores about you. CONTRIBUTING stays developer-facing and gains the owner-feedback path. The docs description and the reference site's home mention both audiences in one sentence each.

### 4. Tone follows the reader

Developer pages keep their voice under the Google developer documentation style guide (ADR 0013). Owner-facing pages, and every string an owner reads in the owner bar, the sign-in page, the Help panel, and Settings, use second person, plain business words, and no content-management jargon. Owner strings are linted like every other user-facing string.

### 5. The non-goals are amended, not reversed

On acceptance, `guide/comparison.md` changes as follows:

- **Keep** "not multi-cloud" and "Astro-first."
- **Drop** "no dashboard-as-a-service." The owner home is a dashboard, and it ships in the packages.
- **Drop** the exclusion of "a website and a mobile app." The owner app (when it exists) is a thin client over the site's own owner routes, not a headless content API for a second frontend. The non-goal that stays is "not a headless content API for many frontends."
- **Reword** "no SLA" to "no SLA from the open source project; a managed engagement carries its own."

ADR 0001 is amended at the same time, only where it implies a single audience. Its rule, "framework-agnostic where it's free, opinionated where it's expensive," and its three typed layers are unchanged.

## Consequences

- **The README and the docs gain owner-facing prose** that the `lint:docs` ratchet covers. The Vale house style already has the vocabulary; a glossary (#537) gives each content-model term one owner-facing meaning.
- **Naming stays as it is.** The npm package is `louise-toolkit`; the brand tokens stay `louise`; the owner entry is `/louise`. "Platform in your pocket" is a description of the owner experience, not a product name.
- **Client names stay out of the public repositories** (`scripts/ci/checks/no-client-names.mjs`). Owner-facing docs use the Google example conventions.
- **Feature decisions get a second test.** Beside "does a site or a client need it," a change to an owner-facing surface asks "does an owner understand it without a developer in the room."

## Alternatives considered

- **Reposition as a platform for owners, with the toolkit as an implementation detail.** Rejected: the toolkit is what makes the platform possible, and developers are the people who bring owners to it. Hiding the toolkit would lose both.
- **Keep the developer-only positioning and treat the owner layer as Bowen Labs' private work.** Rejected: the owner interface, tickets, and self-service are reusable, so the framework-first rule puts them in the packages, and the docs would then describe features they don't admit exist.
- **A separate brand for the owner platform.** Rejected: a second name for the same packages, and the owner already knows the editor as Louise.
