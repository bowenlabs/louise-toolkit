# Lessons

Things that cost real time to learn, written down so they don't cost it twice.
Each one names the symptom you see, the cause, and what to do instead. Decisions
live in [`adr/`](adr/); conventions that CI or review enforces live in
[`CLAUDE.md`](../CLAUDE.md). This file is for the traps between them.

Add a lesson when a problem took more than one attempt to diagnose, or when the
symptom pointed somewhere other than the cause.

## Verifying a change

### A check run proves only the files it saw

Every edit after a green run is untested, and those last edits are the ones most
likely to be wrong. Two CI failures in one PR came from running the checks, making
one more small edit, and pushing. Rerun the whole suite against the final state of
the files, not the state you tested an hour ago.

### Inspect the packed artifact before trusting a result from it

A clean-room run once reported seven errors that looked like bugs in new code. The
packed tarball hadn't been rebuilt, so it didn't contain the code under
test. Before you draw any conclusion from a tarball, confirm the change is in it:

```sh
tar -xzOf pack/louise-toolkit-*.tgz package/dist/core/auth/index.d.ts | grep -c newSymbol
```

### `check` doesn't type-check

`check` is format and lint only. Vitest doesn't type-check either, so a test with
a bad option type passes both `check` and the full test suite, then fails the
`tsgo` and type-aware lint jobs in CI. Always run `typecheck` as well. The full
list is in `CLAUDE.md` § Verifying a change.

## Toolchain

### CI has no bare `pnpm`

The GitHub runner has only corepack, so a script or workflow step that calls
`pnpm` directly fails with `pnpm: command not found`, even though it works on your
machine. Always write `corepack pnpm`. To reproduce the runner, run the command
with `pnpm` off your `PATH`:

```sh
env -u PNPM_HOME PATH="$(dirname "$(command -v corepack)"):/usr/bin:/bin" bash -c 'corepack pnpm run knip'
```

knip also stops seeing a package once it's behind `corepack pnpm dlx`, so a
dependency that knip resolved from a `pnpm dlx --package=…` script string can
reappear as unused after that change.

### The workspace Vitest tracks the major that `vp` bundles

`vp test` runs the Vitest bundled inside `vite-plus`. The workspace `vitest`
devDependency serves raw `vitest` runs and types, and it must stay on the same
major. The custom happy-dom environment (`packages/louise/test/happy-dom-env.ts`)
exports the Vitest 4 field `viteEnvironment: "client"`, which Vitest 3 rejects, so
a major skew breaks every client test under raw `vitest` only.

### Never put a backtick in a comment inside `client/styles.ts`

The editor CSS is one JavaScript template literal. A backtick in a CSS comment
closes it, and `${` starts an interpolation, so type-checking fails with
misleading errors far from the edit. Write class names in those comments without
backticks.

## Packaging

### Every subpath export needs a `default` condition

drizzle-kit loads a site's schema through Node's CommonJS resolver. An export map
with only `types` and `import` conditions fails there with
`ERR_PACKAGE_PATH_NOT_EXPORTED`, so a site can't import `louise-toolkit/db` into
its Drizzle schema. Every entry in `packages/louise/package.json` carries a
`default` that points at the same ESM file.

### An export that isn't a build entry ships broken

A subpath listed in `exports` but missing from the build's entry list never gets a
`dist/` file, and nothing inside the workspace notices, because Vitest aliases
`louise-toolkit/*` to source. That's why `scripts/ci/checks/export-map.mjs` runs
after every build.

### Test an unreleased toolkit with `file:` and `injected`, not `link:`

To try a local build in a site, point the dependency at the package with `file:`
and set `dependenciesMeta.<name>.injected: true`. A `link:` is a bare symlink, so
the linked package resolves its own copies of its optional peers (Drizzle, Better
Auth, Solid). The site then passes its Drizzle tables into functions typed against
a second Drizzle, which shows up as dozens of phantom `SQLiteColumn` type errors.
Injection copies the package into the site's store and resolves peers from the
site. Never deploy either kind of tree; pin the published version first.

## Deploying on Cloudflare

### A missing named resource fails the deploy, not the build

A binding to a Queue, D1 database, R2 bucket, or KV namespace that doesn't exist
yet makes `wrangler deploy` fail. The build and the GitHub checks still pass, so
the failure shows up only in Workers Builds. Provision the resource before you
merge the binding. Bindings to built-in services, such as Images or an Analytics
Engine dataset, need no provisioning.

### The Wrangler `name` must match the Worker that's deployed

Workers Builds deploys to the Worker it's attached to, whatever `wrangler.jsonc`
says. Local commands such as `wrangler secret put` use the name in the config. When
the two differ, `wrangler secret put` creates a new, empty Worker and stores the
secret there, and the live Worker has no secrets. A password check then fails for
every input. Keep the names identical.

Set secrets with `printf`, not `echo`. The trailing newline from `echo` becomes
part of the value and breaks an exact comparison.

### Migrate before you merge when a push deploys production

If merging deploys, code that reads a new column goes live before anyone runs the
migration, and the live page fails. Apply the remote D1 migration first, then merge.

### Change a stored section's shape with expand and contract

When several deploys share one D1 database, old and new code read the same rows at
the same time. To rename or restructure a stored field, first seed each row with
both the old and new keys, so both versions render. Drop the old key in a second
seed, only after every deploy runs the new code.

### Declare every host in `routes`

A host that's bound only in the dashboard is one deploy away from disappearing.
Turning on `preview_urls` changes a Worker's domain configuration, and one such
deploy dropped a dashboard-only apex custom domain. With nothing to intercept it,
requests to the apex hung instead of failing. Declare every host in `wrangler.jsonc`,
and remember that a `*.example.com/*` wildcard route doesn't cover the apex.

To list a Worker's custom domains through the API, pass `per_page`. The default
page size is 1, which hides every other domain.

### A retired AI model looks like a generic 502

The AI helpers are best-effort, so a model error, including one for a Workers AI
model that has reached end of life, comes back as a plain "unavailable." Check
`wrangler tail` for the logged error and the Workers AI model catalog before you
debug your own code. See the AI assists guide's troubleshooting section.

The `ai-models.yml` workflow now checks the toolkit's own defaults every week,
and fails when one is gone from the catalog or has a retirement date. It can't
see a model a site passes in itself, so check those against the catalog when
Cloudflare announces retirements.

### `caches.default` ignores Dev Mode and Purge Everything

Neither Cloudflare Development Mode nor Purge Everything reaches a Worker's
`caches.default`, and that cache is per data center. A short `max-age` is the only
freshness guarantee. Removing `Cloudflare-CDN-Cache-Control` from a response also
removes its `no-store` brake, so Cloudflare can then cache the response without
regard to cookies. [ADR 0004](adr/0004-edge-caching.md) has the full story and the
runbook.

## Astro and Vite

### Read bindings from `cloudflare:workers`

`@astrojs/cloudflare` 14 removed `Astro.locals.runtime.env`. Read bindings with
`import { env } from "cloudflare:workers"`. Astro's built-in origin check also
answers a form `POST` with 403 when the request has no matching `Origin` header,
so a `curl` test needs one.

### When `astro dev` exits before it's ready, read `.astro/dev.log`

The dev server's startup error goes to `.astro/dev.log` as JSON lines, not to the
console. The usual cause is a stale Vite dependency cache that points at files
that no longer exist. Delete `node_modules/.vite` and start again; the first start
after that is slow. If the missing file changes on every run, it's a
reoptimize-and-reload race, and clearing the cache doesn't help. Build the site
and run the Worker with `wrangler dev` instead, which is the better target for
verification anyway.

### A rename sweep has to include `.css`

A package rename that covered `.ts`, `.tsx`, `.astro`, `.mjs` and `.json` missed a
CSS `@import` of the old package name. Local builds passed because Vite's cache
still held the old CSS, and the deploy build failed. Include stylesheets, and
clear the Vite cache before you trust a local build after a rename.

## The editor client

### An editable-node marker needs a box

The on-canvas chrome anchors its ring and toolbar with `getBoundingClientRect()`.
A marker element with `display: contents` has no box, so it measures as a zero-size
rectangle at the page origin: the ring doesn't paint and the toolbar lands in the
top-left corner. Render markers as real boxes. The client logs a warning once when
it finds a boxless marker.

### Guard ProseKit view reads with `e.mounted`

`useEditorDerivedValue` is a Solid memo, and Solid evaluates memos during render,
before the editor mounts. Reading `e.view` before mount throws, and the throw
aborts the whole render, which leaves the field blank. Check `e.mounted` before
any `e.view` access. `e.state` and the mark and node `isActive()` helpers are safe
before mount.

### Switch a store object's shape with `reconcile`

A Solid store path write merges objects. Switching an array item to a different
variant with a plain `set` keeps the old variant's fields. Use `reconcile` so the
item takes exactly the new shape.

## Types and lint

- `@cloudflare/workers-types` declares a DOM `ParentNode` that rejects an
  `HTMLElement` argument. Type such parameters as `HTMLElement`.
- The variadic DOM `append()` collides with the `HTMLRewriter` `append` from
  workers-types when both type libraries are in scope. Use `appendChild`.
- oxlint reports a Solid `ref={x}` as an unassigned variable. Use a callback ref.

## Choices that didn't need an ADR

### The Local API keeps its own relationship resolver

Drizzle's relational queries v2 need static `relations()` and a schema-typed
`db.query`. The Local API's resolver is driven by a runtime registry, and it runs
each related collection's `access.read`, reducing a denied relationship to a bare
ID. Relational queries have no access hooks, so adopting them would drop that
per-relationship access control. The resolver already batches, so there's no
performance gain to trade for it.

### Check which axes a variable font arrives with

A font provider can quietly hand back fewer axes than the font has. Earlier
versions of `astro:fonts` asked only for weight and style, so Roboto Flex arrived
with `wght` alone, and every heading that used `font-stretch` lost its `wdth` axis
without an error. Astro 7.2.9 can request `wdth`, but check the axes of whatever
you're served before relying on them. An axis-instanced woff2 that you host
yourself keeps only the axes you ask for, and it's smaller: 55 KB against 191 KB
for the full-axis file from the CDN. The package inlines its `wght` subset, so it
makes no font request at all.
