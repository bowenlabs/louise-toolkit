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
pnpm install

pnpm changeset publish     # ← the release. Sign in to npm when it prompts.
```

`pnpm changeset publish` builds each package via its `prepublishOnly`
(`louise-toolkit` = `vp pack`, `astroidjs` = `tsgo`), rewrites the `workspace:*`
deps to the exact published versions, and publishes in dependency order
(louise-toolkit → astroidjs → create-astroid). It **prompts you to sign in to
npm** partway through (browser login / OTP) — that's expected; complete it and it
continues. It also creates a git tag per package, so push them:

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
pnpm create astroid@latest my-site --key mysite --name "My Site" --archetype marketing
cd my-site && pnpm install && pnpm exec astro check && pnpm exec astro build
```

The scaffold's declared toolkit ranges are derived from `create-astroid`'s own
resolved dependencies, not hand-written, and `scripts/ci/checks/scaffold-versions.mjs`
fails the build if anyone re-hardcodes a literal. So a version bump needs no edit
to `template/package.json` — if you find yourself making one, that check is about
to fail and the derivation is what needs fixing.

## If something goes wrong

- **Interrupted mid-publish** (e.g. louise-toolkit published, astroidjs didn't):
  just re-run `pnpm changeset publish`. It skips versions already on npm and
  publishes the rest.
- **You cannot cleanly unpublish.** If a bad version ships, roll forward with a
  patch (`pnpm changeset` → `changeset version` → publish), don't unpublish.

## Pre-1.0

Versions are pre-1.0, so a minor bump is where breaking changes live and there is
no deprecation cycle. Read the changelogs before publishing — `changeset version`
writes them from the changesets, and they are the only place a behaviour change
is explained at the length it deserves.
