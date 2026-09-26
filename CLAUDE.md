# Working in this repo

Conventions that CI or a reviewer enforces, written down so you meet them before
they meet you. Deliberately short, because a long file rots, and a rotted one is worse
than none.

## The one rule everything else serves

**Framework-first, non-negotiable.** Every reusable change lands in the
framework, not in a site. If you find yourself solving something in a client
site's repository that another site would also want, it belongs here or in
`astroidjs` instead.

Dependencies flow **one way**: `astroidjs` → `louise-toolkit`, never the reverse.
`louise-toolkit` stays unopinionated; the opinions live in Astroid.

## Toolchain

- **Node 26:** `.nvmrc` and `engines`, matching the CI runner. An older Node
  runs fine right up until it doesn't, and the mismatch is invisible in a diff.
- **Installs go through `corepack pnpm`**, against the pinned version in
  `packageManager`. A globally-installed pnpm produces a store error rather than
  a clear message. The CI runner has **only** corepack, so a script or workflow
  that calls bare `pnpm` passes on your machine and fails in CI. Always write
  `corepack pnpm`.
- **`vite-plus` is coupled to `.github/actions/setup`.** That action fails the
  run when the `vp` binary and the `vite-plus` devDependency disagree. A skew
  once turned a green PR red overnight with no code change. They move together,
  in one commit. Renovate is configured to leave it alone.

## Verifying a change

**Run the full check suite, not just the tests.** This is the one that bites
hardest, because a green `pnpm test` isn't evidence of a working change:

| what broke                                   | what caught it                        | what `pnpm test` said |
| -------------------------------------------- | ------------------------------------- | --------------------- |
| Better Auth 1.7 changed a required interface | `tsgo` typecheck                      | 1,159 passed          |
| A test stub missing a method                 | Vitest's _unhandled rejection_ report | 1,159 passed          |

Both times the suite reported success while the run failed. Grepping the vitest
summary for `Tests` hides it: **check the exit code**, and read the `Errors`
line if there's one.

One more the suite can't replace: `node scripts/ci/checks/export-map.mjs`, run
after a build. Vitest aliases `louise-toolkit/*` to source, so every test in the
workspace is blind to a symbol that exists in `src/` and was never re-exported:
the bug that only bites someone installing the package. Three such symbols were
found this way while extracting the Astro adapter.

The full set, mirroring `.github/workflows/ci.yml` job by job, plus the secret
scan from `secrets.yml` and the model check from `ai-models.yml`. When a
workflow gains a step, this list gains it too; a step missing here is one nobody
runs before pushing.

```sh
# Lint & dead code
corepack pnpm -C packages/louise run check        # lint + format + type-aware rules
corepack pnpm -C packages/louise-astro run check
corepack pnpm run fmt:check                       # everything the two above don't reach
corepack pnpm run lint:astro
corepack pnpm run lint:solid
corepack pnpm run lint:arch                       # ast-grep invariants
corepack pnpm run lint:core                       # no Astro in the core
corepack pnpm run lint:names                      # no client site names
corepack pnpm run lint:docs                       # Vale ratchet (after `vale sync`)
corepack pnpm run knip                            # dead code
corepack pnpm run lint:release
corepack pnpm audit --prod

# Secrets (its own workflow, secrets.yml)
gitleaks git --redact .                           # every commit; `brew install gitleaks`

# AI model catalog (its own workflow, ai-models.yml), when you touch core/ai
node scripts/ci/checks/ai-model-catalog.mjs       # needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID

# Type-check & unit tests
corepack pnpm -C packages/louise run typecheck
corepack pnpm -C packages/louise run test
corepack pnpm -C packages/louise-astro run test

# Build & pack — in this order: the adapter type-checks against the BUILT library
corepack pnpm -C packages/louise run build
node scripts/ci/checks/export-map.mjs
corepack pnpm -C packages/louise-astro run typecheck
corepack pnpm -C packages/louise-astro run build

# Build the site — the reference site, against both built packages
corepack pnpm run build:site
```

The last block catches what nothing before it can: an export map that omits a new
subpath, a `dist/` that never emitted it, or an adapter that compiles against
`src/` but not against what actually ships.

## Astroid lives in another repo

`astroidjs` and `create-astroid` moved to
[bowenlabs/astroidjs](https://github.com/bowenlabs/astroidjs) (#327). Anything
opinionated (themes, section libraries, the scaffold, the command-line tool)
belongs there, not here. The dependency runs one way and only one way: `astroidjs` →
`louise-toolkit`.

What stays here is `@louise-toolkit/astro`, the _unopinionated_ Astro adapter:
middleware, Actions, content-layer loaders, the forms bridge. The test is whether
a change encodes an opinion about how a site should be built. Middleware that
mounts editor routes doesn't. A section library does.

## Architectural rules are enforced, not just documented

`corepack pnpm run lint:arch` runs [ast-grep](https://ast-grep.github.io) over
`.ast-grep/rules/`. Those rules exist for invariants that are **syntax-shaped**
rather than name-shaped, which is precisely what oxlint and knip can't see:

- `cloudflare:workers` must not be imported **as a value** in the library, but
  `import type` from it is correct and load-bearing (`core/workflows`). Same
  module, same specifier; only the import kind separates right from wrong.
- `louise-toolkit` must never import from `astroidjs`. Dependencies flow one way.
- No `process.env` in library source. On workerd it silently evaluates to
  `undefined` rather than failing, so a configured feature quietly acts
  unconfigured.

Alongside it, `corepack pnpm run lint:core` enforces the framework-agnostic
claim: **`packages/louise/src` must not mention Astro at all**, whether that's code or
prose. A text scan rather than an AST rule, because what leaks back in is
comments: "for example, `astro dev`" is a constant temptation, since Astro genuinely is
the clearest example to reach for. It also catches "Astroid", which in library
source is the dependency direction backwards: the floor naming the ceiling.
Astro-specific code belongs in `@louise-toolkit/astro`; opinions belong in
`astroidjs`.

`corepack pnpm run lint:names` runs the same kind of scan over the whole
repository for client site names. The repository is public, so it names no
client site in code, tests, or docs: keep the reason and drop the name ("a site
whose sign-out lived in Settings"). CHANGELOGs and the two pages that feature
the sites, with their consent, are the exceptions.

Every rule carries a `note` explaining the invariant, because a rule nobody
understands gets deleted the first time it's inconvenient. Keep the set small:
anything expressible as an ordinary lint rule belongs in oxlint instead.

## Documentation style

**Every doc and all prose in code follow the [Google developer documentation
style guide](https://developers.google.com/style)** (ADR 0013). That covers the
Starlight docs, ADRs, this file, READMEs, changesets, CHANGELOGs, code comments,
JSDoc, and user-facing strings. JSDoc ships in the `.d.ts` files, so for most
people who use the package, a hover is the documentation.

Write new prose to the guide from the start. The details that trip people up:

- **Dashes:** `word—word`, with no space on either side of the dash, in
  comments too.
- **Separators:** a dash is only for sentences. Page titles use a pipe
  (`Overview | Example Organization admin`); items side by side use a middle dot
  (`Jane Doe · Founder`, an image's alt text, a button label with a price).
- **Contractions:** use them ("isn't," "doesn't").
- **Voice:** second person and present tense, with no "we," "will," or "simply."
- **Examples:** use Google's [example conventions](https://developers.google.com/style/examples)
  as written: `example.com` domains, "Example Organization" for a company, names
  from Google's list (Alex, Kai, Quinn), `800-555-0100` through `0199` for phone
  numbers, and `192.0.2.0/24` for IP addresses. No real brands, characters, or
  pop-culture references; they don't translate, and a trademark in a sample can
  read as an endorsement.

`corepack pnpm run lint:docs` runs [Vale](https://vale.sh) with the Google
style plus the house style, from the house package in `vale/package/`. Run
`corepack pnpm --package=@vvago/vale@3.17.1 dlx vale sync` once first to fetch
the Google package. The bar is Vale's error level. Two Google rules are off,
each with its reason in `vale/package/.vale.ini`: `LyHyphens` and `Quotes`.

`lint:docs` runs the house package's lint runner (`vale/package/styles/Louise/lint-docs.mjs`) over Markdown, code comments, and `.astro` templates, and also lints **user-facing strings**: error messages from `new
Louise…Error(…)`, `error` and `message` in a `json(…)` body, JSX text, and the
JSX attributes people read (`title`, `aria-label`, `placeholder`, `alt`,
`label`). `vale/package/styles/Louise/copy-extract.mjs` defines the list, and it
ships in the house package, so the sites run it too. A finding in one shows up
as `path/to/file.tsx (strings)`.

`lint:docs` is a **per-file ratchet** against `vale/baseline.json`, which holds
the few findings that remain:

- A file that gains findings fails, and the output lists the new ones. Fix them;
  don't raise the baseline.
- A file that loses findings also fails until the baseline records it. Run
  `corepack pnpm run lint:docs -- --update`, which only ever lowers counts.

A style-only rewrite of an ADR isn't an amendment, as long as no decision, date,
or status line changes.

## Site facts are parameters

A fact about a site or its business (time zone, currency, country, locale,
preparation time, brand) is a parameter, never a constant, and never guessed from
the Worker's clock or the browser. A default is fine only for a fact about an
external API (a provider's field limits, its SDK hosts), or when it's overridable
and harmless. When you pull code up from a site, turn every site constant into a
parameter, and call out any default that remains in the PR body.

## Naming

The npm package is `louise-toolkit`, because `louise` belongs to someone else on
npm. Only the package specifier carries that name. The brand tokens stay `louise`:
`mountLouise`, the `data-louise-*` markers, the `louise` CLI binary, and the
`packages/louise` directory.

## The reference site

`workers/site` is louisetoolkit.com, and it deploys through Cloudflare Workers
Builds. Know these before you change it:

- **Every push deploys production,** branches included (#521). A branch's code
  goes live against the same data `main` reads.
- **There's one D1 database** for every deploy. Change a stored section's shape
  with expand and contract: seed both the old and new keys, then drop the old key
  once every deploy runs the new code. Seeds are in `workers/site/seed/`.
- **Provision a named resource before you merge its binding.** A binding to a
  Queue, D1 database, R2 bucket, or KV namespace that doesn't exist fails the
  deploy, while the build and CI stay green.
- **Sign-in is one shared password,** checked against the
  `LOUISE_EDITOR_PASSWORD` secret. There's no user table, so there's no user to
  seed. Locally, copy `.env.example` to `.env` and set it.
- **Running it locally:** `corepack pnpm dev` on Node 26. A `POST` needs a
  matching `Origin` header, because of Astro's origin check. A stale Durable
  Object alarm error after you add a DO clears with `rm -rf
workers/site/.wrangler/state` and a fresh local migration.
- **The `/examples` code panes slice real source** with `?raw` and `#region`
  markers (`src/lib/examples/region.ts`). Mark a region in the real file; never
  paste a copy into the page.

Lessons that don't fit a rule here are in `docs/LESSONS.md`.

## Decisions get an ADR

`docs/adr/`. And an ADR that has stopped being true gets **amended**, not quietly
outdated. See 0009's amendment for the shape. A stale ADR is worse than no ADR,
because people trust it.

## Changesets

Pre-1.0, so a **breaking change ships as `minor`**, because there's no deprecation
cycle to lean on. Never mark one `major`: Changesets takes a `major` on a 0.x
version straight to 1.0.0. Write the changeset for someone upgrading blind: what changed,
why, and what they have to do about it. If there's an upgrade edge (in-flight
state, a deploy-time window), say so plainly rather than letting them find it.
