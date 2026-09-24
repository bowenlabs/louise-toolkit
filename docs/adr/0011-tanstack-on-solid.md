# ADR 0011: TanStack adapters on Solid—adopt Query and Form, constrain Table, decline Pacer

- **Status:** Accepted (2026-07-29). **Query adopted (in use), Form adopted with a caveat, Table read-only only, Pacer declined, Router adopted.** Revisit per adapter under the triggers below. Amended 2026-07-31 after the #316 and #317 spikes, and 2026-09-24 with how the router ships (#488).
- **Deciders:** Baylee (solo maintainer)
- **Issues:** #313 (form scaffold), #314 (table limits), #315 (pacer decision), #316 (form array bugs, spiked), #317 (router spike, done)
- **Related:** ADR 0001 (opinionated Astro + Cloudflare), ADR 0007 (why the Solid client lints separately)

## Context

The toolkit's client is SolidJS mounted in Astro islands, and TanStack is the
default answer for most of what an administration surface needs. But **TanStack's
Solid adapters aren't one thing.** They share a name, a docs site, and a release
cadence, and they differ enormously in maturity. At one end is `solid-query`,
which the settings drawer already runs on in production. At the other is
`solid-pacer`, which its own maintainers label beta and which carries a design
flaw that makes it unusable in a signal-based framework.

Deciding adapter by adapter matters now rather than later for two reasons: the
full-page studio shell (#308) is about to lean on several of them at once, and
"TanStack ships a Solid adapter" keeps getting re-proposed as though it settles
the question. It doesn't. This ADR records what each adapter is actually worth
here, so the next person looks the answer up instead of re-deriving it.

The common thread in every negative finding that follows is the same one:
**React is the reference implementation and Solid is a port.** Adapters that hand
the framework a plain options object, evaluated once at setup, work fine under
React's re-render model and break under Solid's, where nothing re-runs to pick up
a new value. Where an adapter solved that (Query and Hotkeys accept a function in
their signal-based adapters), the Solid version is genuinely good. Where it
didn't, no amount of care at the call site fixes it.

## Decision

### `@tanstack/solid-query`: adopted, already load-bearing

Every settings panel runs on it (`client/settings/*.tsx`, `^5.101.2`, an optional
peer). It solves caching, dedup, refetch pacing, and retry, and its Solid adapter
takes accessor functions, so options stay reactive. Nothing here is under review.

**Consequence for the others:** retry, refetch pacing, and request dedup are
Query's job and are already solved. An adapter proposing to solve them again
needs to beat a dependency the toolkit already ships.

### `@tanstack/solid-form`: adopted, but build the hardest form first

`core/forms/tanstack.ts` already ships `tanstackFieldValidator` /
`tanstackFormValidators`, dependency-free by design, so one `defineForm` config
drives both server validation (`validateSubmission`) and client validation. That's
the right shape, and it stays.

The adapter itself is at genuine API parity with React's (same version, mirrored
exports, stable since March 2025). But three open upstream issues land squarely
on dynamic and array fields, which is exactly the shape the validator bridge
exists to serve:
[form#1188](https://github.com/TanStack/form/issues/1188) (field arrays throw on
submit; the reporter notes the same setup works in React),
[form#1256](https://github.com/TanStack/form/issues/1256) (validation doesn't
fire following the official Solid guide), and
[form#2131](https://github.com/TanStack/form/issues/2131) (`removeValue` marks
shifted siblings touched).

**So: adopt, and build the most nested, most array-heavy form first rather than
last.** #316 spiked this against 1.33.2 and found two things worth carrying:

- **form#2131 reproduces exactly.** Removing an array row marks the shifted
  siblings `isTouched`: with three rows, remove the first, and two rows nobody
  edited come back `true`. It isn't cosmetic in combination with Louise
  validators, because most UIs gate error display on `isTouched`, so the user sees
  a validation error against data they never touched. Key rows by a stable ID
  rather than index.
- **The bigger find was in the toolkit's own code.** `tanstackFieldValidator` is
  async by contract, and the toolkit documented it into TanStack's _sync_
  `onChange` slot. There, a promise-returning validator is stored as the promise,
  so the error is a pending `Promise` rather than a string, and validation
  silently never appears. That reads identically to form#1256, which is worth
  knowing before blaming upstream. It's fixed: use `onChangeAsync`.

The premise of reproducing against a nested `defineForm` config turned out to be
unbuildable: `FormConfig.fields` is flat by construction, one column per field. A
repeating-row form uses TanStack's own array API with these validators on the
leaves.

### `@tanstack/solid-table`: read-only tables only

`flexRender` is fine for reports and sortable or groupable lists with column
visibility. Client-side row modeling is Table's real strength.

It's **wrong for editable grids.** [table#4702](https://github.com/TanStack/table/issues/4702)
(cells not reactive against a Solid store, open since February 2023) and
[table#5019](https://github.com/TanStack/table/issues/5019) (every row and cell
re-renders on data change, following the official Solid examples) mean an inline-edit
pricing or inventory grid re-renders wholesale on every keystroke, the opposite
of why you'd pick Solid. The known workaround is to replace `flexRender` with
manual rendering, and that breaks row selection and column ordering.

**And for server-paginated CRUD, prefer neither.** When filter, sort, and
pagination happen in SQL, a plain `<For>` plus a sort signal is less code, less
bundle, and keeps granular reactivity. Table's value is client-side row
modeling; if D1 is doing that work, Table is paying for nothing.

Both issues have been open for over two years. Treat this as a standing
constraint, not a soon-to-be-fixed bug.

### `@tanstack/solid-pacer`: declined

- **Beta** by the maintainers' own docs label.
- ~2,768 weekly downloads against React Pacer's ~380k. That's a 0.7% cohort, which
  means finding the Solid bugs yourself.
- [pacer#162](https://github.com/TanStack/pacer/issues/162): the Solid adapter
  takes a plain options object evaluated once at setup, so **options can never
  update reactively.** React's are reactive. This is the failure described in
  Context, in its purest form.
- [pacer#131](https://github.com/TanStack/pacer/issues/131): the Solid Pacer
  devtools throw on an export that doesn't exist.
- `async-retryer` exists in `@tanstack/pacer` core and in `packages/react-pacer`,
  but **not** in `packages/solid-pacer`.

**Instead:** debounced inputs and autosave use `createSignal` + `setTimeout` +
`onCleanup`, or `@solid-primitives/debounce`. Retry, refetch pacing, and dedup are
Query's. Server-side rate limiting belongs in KV, where the toolkit already does
it (`matchRateRule`).

### `@tanstack/solid-router`: adopted; the island mount works

Mounting it inside an Astro `client:only="solid-js"` island is undocumented
anywhere upstream. The Router repository's Solid examples are all standalone Vite
or Start-based, so #317 spiked it rather than adopting on faith. **It works**,
against `astro@7.1.6` + `@tanstack/solid-router@1.170.18`, and all four questions
came back clean:

- **Deep-link refresh.** An Astro catch-all (`src/pages/app/[...path].astro`)
  serving every sub-path to the same island renders the correct route on a cold
  load of `/app/orders/42`, and again after a refresh.
- **`basepath`.** Two configurations work identically: literal prefixed route
  paths (`/app/orders`), or `basepath: "/app"` with root-relative ones. Router
  #4888 (incomplete basepath handling) is filed against `@tanstack/solid-start`
  and doesn't bite here.
- **History.** Back and forward move between island routes correctly.
- **Navigation stays client-side**: a `window` global set before a link click
  survives it, so the island isn't silently doing document loads.

**The one caveat, and it's a deploy-time one.** Astro's static build emits
directory-style URLs (`/app/orders/` → `index.html`) while the router writes
history entries _without_ a trailing slash (`/app/orders`). So the URL a user
copies after navigating differs from the one Astro emitted. `astro preview` serves
both, but that's the preview server being lenient. Confirm the deployed
trailing-slash behavior before relying on it, because this is exactly the class
of thing that works in development and returns a 404 in production.

**Serving the studio from its own subdomain sidesteps `basepath` entirely.** With
the tenancy rewrite (#307) mapping `studio.example.com/` to an internal prefix,
the browser only ever sees root paths, so `basepath` is `/`.

**Amended 2026-09-24 (#488): how it ships.** Adopting the router left open whether
the toolkit depends on it. It does, as an **optional peer** on its own subpath,
`louise-toolkit/client/studio-shell`, the same arrangement as `@tanstack/solid-query`.
A site without a routed studio never installs it. The subpath holds `StudioShell`,
the frame every routed studio had rebuilt by hand: a title per screen, a skip link,
and focus moved to the new screen's heading after a navigation.

The rejected alternative was a router-agnostic shell that each site binds to its own
router. It would have left the route wiring, the basepath and the frame to every
site, which is the ~150 lines one client studio already hand-rolled. The behaviour
itself is still router-agnostic: `screenTitle`, `focusScreenHeading`,
`revealActiveNavLink`, `studioBasepath` and `studioHref` live in
`louise-toolkit/client/studio` with no router dependency, as `unsavedChanges` does.
`StudioShell` only connects them to TanStack Router, so a site on another router
loses the component, not the behaviour.

**A studio served on two hosts computes its basepath in the browser.** Under a path
on the main host and at the root of a subdomain, the browser sees different paths
for the same screen, so `studioBasepath(prefix)` reads the loaded URL rather than a
build-time setting.

**Not TanStack Start**, in any case. Start owns its own Vite build graph on
Cloudflare and therefore wants its own Worker, which is incompatible with the
single-Worker composition this toolkit is built on (`composeWorker` composes
_handlers_, not _builds_). A standalone router in an island keeps one Worker, one
build, one auth surface.

## Consequences

- The studio's inventory and pricing screens (#308) can't be TanStack Table
  editable grids. That constraint is known **before** the screens are designed,
  which is the point of writing it down now.
- One dependency for data fetching (Query), one for forms (Form), and hand-rolled
  primitives for pacing. The dependency count stays where it is.
- Any future proposal to adopt `@tanstack/solid-*` starts by checking whether
  the adapter's options are reactive on Solid. That single question predicted
  every finding in this ADR.

## Revisit when

- **Pacer**: the Solid adapter gains function-form options the way Query and
  Hotkeys have, _and_ `async-retryer` lands in `packages/solid-pacer`.
- **Table**: either upstream issue closes with real cell-level reactivity
  against a Solid store.
- **Router**: resolved by #317 (see the router decision). Revisit if the
  trailing-slash caveat turns out to bite on Cloudflare, or if Start ever stops
  owning its own build graph.
- **Form**: #316's reproduction comes back clean, which would let the caveat
  drop to a footnote.
