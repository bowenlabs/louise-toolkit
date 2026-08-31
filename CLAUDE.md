# Working in this repo

Conventions that CI or a reviewer enforces, written down so you meet them before
they meet you. Deliberately short — a long file rots, and a rotted one is worse
than none.

## The one rule everything else serves

**Framework-first, non-negotiable.** Every reusable change lands in the
framework, not in a site. If you find yourself solving something in
`coracle.coffee`, `ghostfire.coffee` or `themidwestartist.com` that another site
would also want, it belongs here or in `astroidjs` instead.

Dependencies flow **one way**: `astroidjs` → `louise-toolkit`, never the reverse.
`louise-toolkit` stays unopinionated; the opinions live in Astroid.

## Toolchain

- **Node 26** — `.nvmrc` and `engines`, matching the CI runner. An older Node
  runs fine right up until it doesn't, and the mismatch is invisible in a diff.
- **Installs go through `corepack pnpm`**, against the pinned version in
  `packageManager`. A globally-installed pnpm produces a store error rather than
  a clear message.
- **`vite-plus` is coupled to `.github/actions/setup`.** That action fails the
  run when the `vp` binary and the `vite-plus` devDependency disagree — a skew
  once turned a green PR red overnight with no code change. They move together,
  in one commit. Renovate is configured to leave it alone.

## Verifying a change

**Run the full check suite, not just the tests.** This is the one that bites
hardest, because a green `pnpm test` is not evidence of a working change:

| what broke                                   | what caught it                        | what `pnpm test` said |
| -------------------------------------------- | ------------------------------------- | --------------------- |
| Better Auth 1.7 changed a required interface | `tsgo` typecheck                      | 1,159 passed          |
| A test stub missing a method                 | Vitest's _unhandled rejection_ report | 1,159 passed          |

Both times the suite reported success while the run failed. Grepping the vitest
summary for `Tests` hides it — **check the exit code**, and read the `Errors`
line if there is one.

The full set, roughly in the order CI runs it:

```sh
corepack pnpm -C packages/louise run typecheck
corepack pnpm -C packages/louise run test
corepack pnpm -C packages/astroid run test
corepack pnpm -C packages/louise run check     # lint + format + type-aware rules
corepack pnpm -C packages/astroid run check
corepack pnpm run fmt:check                    # everything the two above don't reach
corepack pnpm run lint:astro
corepack pnpm run lint:solid
corepack pnpm run knip                         # dead code
```

Then the builds, which catch what nothing above can — an export map that omits a
new subpath, or a `dist/` that never emitted it.

## `packages/create-astroid/template/` is not source

It is scaffold **payload**, and three separate tools are configured to leave it
alone (`.oxfmtignore`, `knip.jsonc`, `renovate.json5`). All three exclusions
exist for the same reason:

- Its files carry `__ASTROID_*__` placeholders and several are not valid
  TypeScript standalone. Formatting one produces `SQUARE_ENVIRONMENT: string;;`
  in every scaffolded project.
- Its toolkit versions are sentinels (`0.0.0-replaced-at-scaffold`) that
  create-astroid **derives** at pack time. `scripts/ci/checks/scaffold-versions.mjs`
  fails the build if they become literals — which is exactly what a well-meaning
  edit writes.

Nothing type-checks the template until it is scaffolded, so the clean-room smoke
test is the only thing that catches damage to it, and that runs late.

## Architectural rules are enforced, not just documented

`corepack pnpm run lint:arch` runs [ast-grep](https://ast-grep.github.io) over
`.ast-grep/rules/`. Those rules exist for invariants that are **syntax-shaped**
rather than name-shaped, which is precisely what oxlint and knip cannot see:

- `cloudflare:workers` must not be imported **as a value** in the library — but
  `import type` from it is correct and load-bearing (`core/workflows`). Same
  module, same specifier; only the import kind separates right from wrong.
- `louise-toolkit` must never import from `astroidjs`. Dependencies flow one way.
- No `process.env` in library source. On workerd it silently evaluates to
  `undefined` rather than failing, so a configured feature quietly acts
  unconfigured.

Alongside it, `corepack pnpm run lint:core` enforces the framework-agnostic
claim: **`packages/louise/src` must not mention Astro at all**, in code or in
prose. A text scan rather than an AST rule, because what leaks back in is
comments — "e.g. `astro dev`" is a constant temptation, since Astro genuinely is
the clearest example to reach for. It also catches "Astroid", which in library
source is the dependency direction backwards: the floor naming the ceiling.
Astro-specific code belongs in `@louise-toolkit/astro`; opinions belong in
`astroidjs`.

Every rule carries a `note` explaining the invariant, because a rule nobody
understands gets deleted the first time it is inconvenient. Keep the set small:
anything expressible as an ordinary lint rule belongs in oxlint instead.

## Documentation style

`corepack pnpm run lint:docs` runs [Vale](https://vale.sh) against the **Google
developer documentation style guide** over the published Starlight docs — the
surface a reader actually meets, covering both louise-toolkit and astroidjs.
Source comments are out of scope: they are written for maintainers, and the
Google guide is a guide for user-facing prose.

Adopting a guide is not the same as surrendering to it. Two rules are off, each
with its reason in `.vale.ini`: `LyHyphens` (it assumes any `ly`-ending word is
an adverb, so "**supply**-chain" trips it) and `Quotes` (it wants the period
inside `says "editor."`, which in a technical doc implies the period is part of
the literal value). Everything else is on, including `EmDash` — the house
spaced-em-dash style was converted in the docs to meet it.

Note the resulting split: **docs use `word—word`, source comments still use
`word — word`**. Vale only lints the docs, so nothing enforces the comment style
either way.

## Decisions get an ADR

`docs/adr/`. And an ADR that has stopped being true gets **amended**, not quietly
outdated — see 0009's amendment for the shape. A stale ADR is worse than no ADR,
because people trust it.

## Changesets

Pre-1.0, so a **breaking change ships as `minor`** — there is no deprecation
cycle to lean on. Write the changeset for someone upgrading blind: what changed,
why, and what they have to do about it. If there is an upgrade edge (in-flight
state, a deploy-time window), say so plainly rather than letting them find it.
