# Contributing to Louise Toolkit

Thanks for your interest. Louise is an opinionated, V8-native toolkit for building
editable sites on Cloudflare Workers, dogfooded on real production sites, so
contributions are grounded in real usage, and correctness matters more than volume.

## Ways to contribute

- **Report a bug**: open an issue with a minimal repro (the Worker/Astro version,
  the binding involved, and what you expected).
- **Pick up an issue**: the four milestones under
  [epic #481](https://github.com/bowenlabs/louise-toolkit/issues/481) track the
  active work, and issues labeled **good first issue** are the gentlest entry
  points. Comment before you start so nobody doubles up.
- **Propose work**: an issue goes into a milestone only when a site or a client
  needs it. Everything else is labeled `parked`. Parked issues stay open, and a
  real need is enough to bring one back.
- **Improve the docs**: [docs.louisetoolkit.com](https://docs.louisetoolkit.com)
  is built from `workers/docs` (Starlight); fixes there are always welcome.

## Project layout

This is a [pnpm](https://pnpm.io) workspace driven by [Vite+](https://viteplus.dev)
(`vp`). See the [README](README.md#repository-layout) for the full map. In short:

- `packages/louise`: `louise-toolkit`, the published library (core primitives,
  the SolidJS + ProseKit inline client, the editor theme).
- `packages/louise-astro`: `@louise-toolkit/astro`, the optional Astro adapter:
  middleware, Actions, content-layer loaders, the forms bridge. Everything that
  imports Astro's types lives here so the core stays framework-agnostic.
- `workers/site`, `workers/docs`: the marketing site and docs, both deployed by
  one Worker.

## Dev setup

Install [Vite+](https://viteplus.dev) once, then set up the workspace:

```sh
curl -fsSL https://vite.plus | bash
vp install
```

Common commands (from the repo root unless noted):

```sh
corepack pnpm build          # pack the library and the adapter, then build the site
corepack pnpm test           # the Vitest suites of the library and the Astro adapter
corepack pnpm typecheck      # tsgo over the library
corepack pnpm dev            # run louisetoolkit.com locally (marketing + docs)
```

Always write `corepack pnpm`, never bare `pnpm`: the CI runner has only
corepack, so a bare `pnpm` passes on your machine and fails in CI.

## Checks to run before opening a PR

Run the full set in [`CLAUDE.md`'s "Verifying a change"](CLAUDE.md#verifying-a-change)
before you open a PR. It mirrors `.github/workflows/ci.yml` job by job, plus the
secret scan from `secrets.yml`, and it's the one list: when a workflow gains a
step, that list gains it too, so this file doesn't keep a copy that can drift.

A green `corepack pnpm test` isn't enough on its own. The type-check, the
export-map check after a build, and the site build each catch breakage that the
test suite reports as a pass.

The library's `check` script, `vp check`, runs Vite+'s **type-aware lint + full type-check** (tsgolint on
the TypeScript-Go toolchain, the same TS7 engine as `tsgo`); the standalone
`tsgo --noEmit` stays as the authoritative whole-program gate. See
[ADR 0008](docs/adr/0008-type-aware-lint-typecheck.md) for the enabled rule set
and why a couple of rules are scoped off.

The lint split is deliberate (see [ADR 0007](docs/adr/0007-lint-toolchain.md)):
**Oxlint/Oxfmt for `.ts`**, **Biome for `.astro`** (oxlint can't parse Astro).
The SolidJS client is linted by a **direct** `oxlint` run that loads
`eslint-plugin-solid` through oxlint's `jsPlugins`, a separate step because `vp`'s
bundled oxlint drops `jsPlugins`. Biome 2 can't absorb these (it runs no ESLint
plugins and has no Solid rules), so the split stays.

## Changesets

Any change to `louise-toolkit` (or `@louise-toolkit/astro`) that users would notice needs a
changeset, because it drives the version bump and changelog:

```sh
corepack pnpm changeset
```

Louise is **pre-1.0**, so the many granular subpath exports aren't frozen yet.
Until 1.0, **breaking changes ship as a `minor` bump** (not major) and must be
described in the changeset so consumers can upgrade deliberately. Additive
features are `minor`; fixes and small enhancements are `patch`. Changes scoped to
`workers/site` / `workers/docs` (both in the changeset `ignore` list) don't need one.

## Pull requests

- **One focused change per PR**, on a feature branch off `main` (for example,
  `feat/<slug>-<issue>`); reference the issue it closes.
- Keep new code in the surrounding style: match the file's comment density,
  naming, and idiom; the codebase leans on thorough "why" comments.
- Include tests for behavior changes. The client tests run in happy-dom.
- Green CI is required to merge.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
