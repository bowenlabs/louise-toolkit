# ADR 0011 — TanStack adapters on Solid: adopt Query and Form, constrain Table, decline Pacer

- **Status:** Accepted (2026-07-29) — **Query adopted (in use), Form adopted with a caveat, Table read-only only, Pacer declined, Router unproven.** Revisit per adapter under the triggers below.
- **Deciders:** Baylee (solo maintainer)
- **Issues:** #313 (form scaffold), #314 (table limits), #315 (pacer decision), #316 (form array bugs), #317 (router spike)
- **Related:** ADR 0001 (opinionated Astro + Cloudflare), ADR 0007 (why the Solid client lints separately)

## Context

The toolkit's client is SolidJS mounted in Astro islands, and TanStack is the
default answer for most of what an admin surface needs. But **TanStack's Solid
adapters are not one thing.** They share a name, a docs site and a release
cadence, and they differ enormously in maturity — from `solid-query`, which the
settings drawer already runs on in production, to `solid-pacer`, which is
labelled beta by its own maintainers and carries a design flaw that makes it
unusable in a signal-based framework.

Deciding adapter-by-adapter matters now rather than later because the full-page
studio shell (#308) is about to lean on several of them at once, and because
"TanStack ships a Solid adapter" keeps getting re-proposed as though it settles
the question. It doesn't. This ADR records what each adapter is actually worth
here, so the answer is looked up rather than re-derived.

The common thread in every negative finding below is the same one: **React is
the reference implementation and Solid is a port.** Adapters that hand the
framework a plain options object evaluated once at setup work fine under React's
re-render model and break under Solid's, where nothing re-runs to pick up a new
value. Where an adapter solved that — Query and Hotkeys accept a function in
their signal-based adapters — the Solid version is genuinely good. Where it
didn't, no amount of care at the call site fixes it.

## Decision

### `@tanstack/solid-query` — adopted, already load-bearing

Every settings panel runs on it (`client/settings/*.tsx`, `^5.101.2`, an optional
peer). It solves caching, dedup, refetch pacing and retry, and its Solid adapter
takes accessor functions, so options stay reactive. Nothing here is under review.

**Consequence for the others:** retry, refetch pacing and request dedup are
Query's job and are already solved. An adapter proposing to solve them again
needs to beat a dependency the toolkit already ships.

### `@tanstack/solid-form` — adopted, but build the hardest form first

`core/forms/tanstack.ts` already ships `tanstackFieldValidator` /
`tanstackFormValidators`, dependency-free by design, so one `defineForm` config
drives both server validation (`validateSubmission`) and client validation. That
is the right shape and it stays.

The adapter itself is at genuine API parity with React's (same version, mirrored
exports, stable since March 2025). But three open upstream issues land squarely
on dynamic and array fields —
[form#1188](https://github.com/TanStack/form/issues/1188) (field arrays throw on
submit; the reporter notes the same setup works in React),
[form#1256](https://github.com/TanStack/form/issues/1256) (validation doesn't
fire following the official Solid guide),
[form#2131](https://github.com/TanStack/form/issues/2131) (`removeValue` marks
shifted siblings touched) — which is exactly the shape the validator bridge
exists to serve.

**So: adopt, and build the most nested, most array-heavy form first rather than
last.** If it reproduces, the workaround is documented in the toolkit once
instead of rediscovered per site (#316).

### `@tanstack/solid-table` — read-only tables only

`flexRender` is fine for reports and sortable/groupable lists with column
visibility — client-side row modelling is Table's real strength.

It is **wrong for editable grids.** [table#4702](https://github.com/TanStack/table/issues/4702)
(cells not reactive against a Solid store, open since Feb 2023) and
[table#5019](https://github.com/TanStack/table/issues/5019) (every row and cell
re-renders on data change, following the official Solid examples) mean an inline-edit
pricing or inventory grid re-renders wholesale on every keystroke — the opposite
of why you'd pick Solid. The known workaround, replacing `flexRender` with manual
rendering, breaks row selection and column ordering.

**And for server-paginated CRUD, prefer neither.** When filter, sort and
pagination happen in SQL, a plain `<For>` plus a sort signal is less code, less
bundle, and keeps granular reactivity. Table's value is client-side row
modelling; if D1 is doing that work, Table is paying for nothing.

Both issues have been open over two years. Treat this as a standing constraint,
not a soon-to-be-fixed bug.

### `@tanstack/solid-pacer` — declined

- **Beta** by the maintainers' own docs label.
- ~2,768 weekly downloads against React Pacer's ~380k — a 0.7% cohort, which
  means finding the Solid bugs yourself.
- [pacer#162](https://github.com/TanStack/pacer/issues/162) — the Solid adapter
  takes a plain options object evaluated once at setup, so **options can never
  update reactively.** React's are reactive. This is the failure described in
  Context, in its purest form.
- [pacer#131](https://github.com/TanStack/pacer/issues/131) — Solid Pacer
  devtools throw on an export that doesn't exist.
- `async-retryer` exists in `@tanstack/pacer` core and in `packages/react-pacer`,
  but **not** in `packages/solid-pacer`.

**Instead:** debounced inputs and autosave use `createSignal` + `setTimeout` +
`onCleanup`, or `@solid-primitives/debounce`. Retry, refetch pacing and dedup are
Query's. Server-side rate limiting belongs in KV, where the toolkit already does
it (`matchRateRule`).

### `@tanstack/solid-router` — unproven, spike before committing

Mounting it inside an Astro `client:only="solid-js"` island appears to be
undocumented anywhere upstream; the Router repo's Solid examples are all
standalone Vite or Start-based. A full-page admin app inside an island is going
to be a recurring shape here, so it is worth the spike (#317) — deep-link
refresh through the Astro catch-all, `basepath` behaviour, history across the
island boundary — but not worth adopting on faith.

**Not TanStack Start**, in any case: Start owns its own Vite build graph on
Cloudflare and therefore wants its own Worker, which is incompatible with the
single-Worker composition this toolkit is built on (`composeWorker` composes
*handlers*, not *builds*). A standalone router in an island keeps one Worker, one
build, one auth surface.

## Consequences

- The studio's inventory and pricing screens (#308) cannot be TanStack Table
  editable grids. That constraint is known **before** the screens are designed,
  which is the point of writing it down now.
- One dependency for data fetching (Query), one for forms (Form), and hand-rolled
  primitives for pacing. The dependency count stays where it is.
- Any future "should we adopt `@tanstack/solid-*`?" starts by checking whether
  the adapter's options are reactive on Solid. That single question predicted
  every finding above.

## Revisit when

- **Pacer** — the Solid adapter gains function-form options the way Query and
  Hotkeys have, *and* `async-retryer` lands in `packages/solid-pacer`.
- **Table** — either upstream issue closes with real cell-level reactivity
  against a Solid store.
- **Router** — the #317 spike returns a working island mount, at which point this
  ADR gains a decision rather than a spike.
- **Form** — #316's reproduction comes back clean, which would let the caveat
  drop to a footnote.
