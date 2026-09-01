# Releasing

How to publish `louise-toolkit`, `astroidjs`, and `create-astroid` to npm.
Publishing is **manual** (no release Action). The version bump is a separate step
that happens in its own PR (`pnpm changeset` → `changeset version`, reviewed and
merged); this doc covers the publish that follows.

## Publish

Once the version-bump PR is merged:

```sh
cd ~/GitHub/louise-toolkit
git checkout main && git pull --ff-only
nvm use                    # Node 26. Homebrew's node shadows it if nvm isn't loaded.
corepack pnpm install

corepack pnpm release      # ← the release. Sign in to npm when it prompts.
```

**Use `pnpm release`, not a bare `changeset publish`.** It runs
`build:packages` first — one ordered pass, louise-toolkit → @louise-toolkit/astro
→ astroidjs — and only then publishes.

That ordering is load-bearing. `changeset publish` runs every package's
`prepublishOnly` **concurrently**, and these packages are not independent:
`@louise-toolkit/astro` and `astroidjs` type-check against `louise-toolkit`'s
emitted `dist/*.d.ts`, while `louise-toolkit`'s own build rewrites that same
directory. Building during publish is therefore a race, and it is not theoretical
— it took out the 0.27.0 release after three of four packages had already gone
out. So `prepublishOnly` no longer builds anything; it asserts the build happened
(`scripts/ci/checks/dist-present.mjs`) and cannot race, because it only reads.

`changeset publish` then rewrites the `workspace:*` deps to the exact published
versions and publishes in dependency order (louise-toolkit → astroidjs →
create-astroid). It **prompts you to sign in to npm** partway through (browser
login / OTP) — that's expected; complete it and it continues. It also creates a
git tag per package, so push them:

```sh
git push --follow-tags origin main
```

Notes:

- `vp` must be on your PATH (`louise-toolkit`'s build runs `vp pack`). If it isn't:
  `curl -fsSL https://vite.plus | VP_NODE_MANAGER=no bash`, then reopen the shell.
- If `pnpm install` errors with a store mismatch, use `corepack pnpm install`
  (the repo pins pnpm 11.13.0).

## Verify

Read the expected numbers off `main` rather than out of this file — a version
hardcoded in a runbook is a version that goes stale between releases:

```sh
for p in packages/louise packages/astroid packages/create-astroid; do
  node -e "const p=require('./$p/package.json');console.log(p.name, p.version)"
done
```

Then check npm agrees:

```sh
npm view louise-toolkit version
npm view astroidjs version
npm view create-astroid version
```

**The real smoke test — scaffold from the LIVE registry.** CI's scaffold smokes
build from local tarballs, so they cannot catch a broken export map, a missing
`files` entry, or a dependency that resolves in-workspace and nowhere else. This
is the only check that exercises what a stranger actually gets:

```sh
cd "$(mktemp -d)"
pnpm create astroid@<just-published> my-site --key mysite --name "My Site" --archetype marketing
cd my-site && pnpm install && pnpm exec astro check && pnpm exec astro build
```

The scaffold's declared toolkit ranges are derived from `create-astroid`'s own
resolved dependencies, not hand-written, and `scripts/ci/checks/scaffold-versions.mjs`
fails the build if anyone re-hardcodes a literal. So a version bump needs no edit
to `template/package.json` — if you find yourself making one, that check is about
to fail and the derivation is what needs fixing.

## If something goes wrong

- **Interrupted mid-publish** (e.g. louise-toolkit published, astroidjs didn't):
  just re-run `corepack pnpm release`. It skips versions already on npm and
  publishes the rest. This is a normal state, not a corrupt one — 0.27.0 went out
  three-of-four and was finished by a re-run.

- **npm lies to you for a minute after a publish, and it lies convincingly.**
  `npm view <pkg> version` and `https://registry.npmjs.org/<pkg>` can both keep
  serving the 404 they cached while the package genuinely did not exist. During
  0.27.0 this produced a package that was live on npm and reported "not
  published" by every read for several minutes. Do not conclude a publish failed
  from a 404. The reliable tells:

  - `npm view <pkg> --prefer-online`, and the versioned endpoint
    `registry.npmjs.org/<pkg>/<version>`, which is cached separately.
  - A `403 ... cannot publish over the previously published versions` on retry
    means it **succeeded**. That error is the proof.
  - A git tag proves changesets _attempted_ the publish, not that npm accepted
    it — `git push --follow-tags` pushes tags either way.

- **`pnpm create astroid@latest` can serve a cached older version**, which
  scaffolds the _previous_ release's toolkit ranges and looks exactly like a
  broken version derivation. Pin the version when smoke-testing a release
  (`pnpm create astroid@<just-published>`) rather than trusting `@latest`.
- **You cannot cleanly unpublish.** If a bad version ships, roll forward with a
  patch (`pnpm changeset` → `changeset version` → publish), don't unpublish.

## Pre-1.0

Versions are pre-1.0, so a minor bump is where breaking changes live and there is
no deprecation cycle. Read the changelogs before publishing — `changeset version`
writes them from the changesets, and they are the only place a behaviour change
is explained at the length it deserves.
