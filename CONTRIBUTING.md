# Contributing to Louise Toolkit

Thanks for your interest. Louise is an opinionated, V8-native toolkit for building
editable sites on Cloudflare Workers, dogfooded on real production sites — so
contributions are grounded in real usage, and correctness matters more than volume.

## Ways to contribute

- **Report a bug** — open an issue with a minimal repro (the Worker/Astro version,
  the binding involved, and what you expected).
- **Pick up an issue** — the [Platform features push](https://github.com/bowenlabs/louise-toolkit/milestone/1)
  milestone tracks the active work; issues labelled **good first issue** are the
  gentlest entry points. Comment before you start so we don't double up.
- **Improve the docs** — [docs.louisetoolkit.com](https://docs.louisetoolkit.com)
  is built from `workers/docs` (Starlight); fixes there are always welcome.

## Project layout

This is a [pnpm](https://pnpm.io) workspace driven by [Vite+](https://viteplus.dev)
(`vp`). See the [README](README.md#repository-layout) for the full map. In short:

- `packages/louise` — `louise-toolkit`, the published library (core primitives,
  the SolidJS + ProseKit inline client, the editor theme).
- `packages/astroid` — `astroidjs`, the opinionated meta-framework over Louise +
  Astro. **Dependencies flow one way: `astroidjs → louise-toolkit`, never the
  reverse** — nothing opinionated is allowed into Louise's exports.
- `workers/site`, `workers/docs` — the marketing site and docs, both deployed by
  one Worker.

## Dev setup

Install [Vite+](https://viteplus.dev) once, then set up the workspace:

```sh
curl -fsSL https://vite.plus | bash
vp install
```

Common commands (from the repo root unless noted):

```sh
pnpm build          # pack the library + build the site
pnpm test           # the library's Vitest suite
pnpm typecheck      # tsgo over the library
pnpm dev            # run louisetoolkit.com locally (marketing + docs)
```

## Checks — run these before opening a PR

CI runs exactly these; run them locally first so review stays about the change:

```sh
# from packages/louise
vp check                                   # Oxlint + Oxfmt + type-aware lint & type-check (TS7)
vp test                                    # Vitest (happy-dom for the client)
tsgo --noEmit                              # type-check (authoritative gate, whole src+test scope)

# from the repo root
biome lint .                               # .astro component scripts (Biome)
npx oxlint@1.73.0 packages/louise/src/client   # SolidJS client (oxlint + eslint-plugin-solid)
```

`vp check` also runs Vite+'s **type-aware lint + full type-check** (tsgolint on
the TypeScript-Go toolchain — the same TS7 engine as `tsgo`); the standalone
`tsgo --noEmit` stays as the authoritative whole-program gate. See
[ADR 0008](docs/adr/0008-type-aware-lint-typecheck.md) for the enabled rule set
and why a couple of rules are scoped off.

The lint split is deliberate (see [ADR 0007](docs/adr/0007-lint-toolchain.md)):
**Oxlint/Oxfmt for `.ts`**, **Biome for `.astro`** (oxlint can't parse Astro).
The SolidJS client is linted by a **direct** `oxlint` run that loads
`eslint-plugin-solid` via oxlint's `jsPlugins` — a separate step because `vp`'s
bundled oxlint drops `jsPlugins`. Biome 2 can't absorb these (it runs no ESLint
plugins and has no Solid rules), so the split stays.

## Changesets

Any change to `louise-toolkit` (or `astroidjs`) that users would notice needs a
changeset — it drives the version bump and changelog:

```sh
pnpm changeset
```

Louise is **pre-1.0**, so the many granular subpath exports are not yet frozen.
Until 1.0, **breaking changes ship as a `minor` bump** (not major) and must be
described in the changeset so consumers can upgrade deliberately. Additive
features are `minor`; fixes and small enhancements are `patch`. Changes scoped to
`workers/site` / `workers/docs` (both in the changeset `ignore` list) don't need one.

## Pull requests

- **One focused change per PR**, on a feature branch off `main` (e.g.
  `feat/<slug>-<issue>`); reference the issue it closes.
- Keep new code in the surrounding style — match the file's comment density,
  naming, and idiom; the codebase leans on thorough "why" comments.
- Include tests for behaviour changes. The client is tested with happy-dom;
  the versioned-page publish happy path is covered by the astro-preview E2E.
- Green CI (the checks above) is required to merge.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
