# Releasing

How to publish `louise-toolkit`, `astroidjs`, and `create-astroid` to npm.
Publishing is **manual** (no release Action). The version bump is a separate step
that happens in its own PR (`pnpm changeset` → `changeset version`, reviewed and
merged); this doc covers the publish that follows.

> **The pending 0.16.0 / 0.2.0 / 0.2.0 release matters:** published
> `astroidjs@0.1.2` has no `./astro` export, but the scaffold template imports
> `astroidjs/astro`, so `npm create astroid` from the registry dies before Astro
> loads its config. `astroidjs@0.2.0` carries that export — this is the release
> that makes `pnpm create astroid` work off npm.

## Publish

The version-bump PR is already merged (`main` is at `astroidjs 0.2.0`), so this
is all that's left:

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

```sh
npm view louise-toolkit version    # 0.16.0
npm view astroidjs version         # 0.2.0
npm view create-astroid version    # 0.2.0
# the ./astro export actually shipped:
npm view astroidjs exports --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('./astro published:', './astro' in JSON.parse(s)))"
```

**The real smoke test — scaffold from the LIVE registry** (dies on 0.1.2, builds
on 0.2.0):

```sh
cd "$(mktemp -d)"
pnpm create astroid@latest my-site --key mysite --name "My Site" --archetype marketing
cd my-site && pnpm install && pnpm exec astro check && pnpm exec astro build
```

## If something goes wrong

- **Interrupted mid-publish** (e.g. louise-toolkit published, astroidjs didn't):
  just re-run `pnpm changeset publish`. It skips versions already on npm and
  publishes the rest.
- **You cannot cleanly unpublish.** If a bad version ships, roll forward with a
  patch (`pnpm changeset` → `changeset version` → publish `0.2.1`), don't
  unpublish.
