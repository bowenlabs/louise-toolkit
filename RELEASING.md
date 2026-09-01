# Releasing

How to publish `louise-toolkit` and `@louise-toolkit/astro` to npm.

`astroidjs` and `create-astroid` are **no longer released from this repo** — they
live in [bowenlabs/astroidjs](https://github.com/bowenlabs/astroidjs) and have
their own runbook. They consume this repo's packages from npm, so a toolkit
release has to land here first before theirs can pick it up.
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
— and only then publishes.

That ordering is load-bearing. `changeset publish` runs every package's
`prepublishOnly` **concurrently**, and these packages are not independent:
`@louise-toolkit/astro` type-checks against `louise-toolkit`'s
emitted `dist/*.d.ts`, while `louise-toolkit`'s own build rewrites that same
directory. Building during publish is therefore a race, and it is not theoretical
— it took out the 0.27.0 release after three of four packages had already gone
out. So `prepublishOnly` no longer builds anything; it asserts the build happened
(`scripts/ci/checks/dist-present.mjs`) and cannot race, because it only reads.

`changeset publish` then rewrites the `workspace:*` deps to the exact published
versions and publishes in dependency order (louise-toolkit →
@louise-toolkit/astro). It **prompts you to sign in to npm** partway through (browser
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
for p in packages/louise packages/louise-astro; do
  node -e "const p=require('./$p/package.json');console.log(p.name, p.version)"
done
```

Then check npm agrees:

```sh
npm view louise-toolkit version
npm view @louise-toolkit/astro version
```

**The real smoke test — install from the LIVE registry.** CI builds and tests
against the workspace, where `louise-toolkit/*` resolves to source. That is
structurally blind to the one bug class only a consumer meets: a subpath in
`exports` whose `dist/` target was never emitted, a missing `files` entry, or a
symbol that exists in `src/` and was never re-exported. `export-map.mjs` covers
most of it from the inside; this covers it from the outside.

```sh
cd "$(mktemp -d)"
# NOT `pnpm init` — it writes `packageManager: pnpm@^11.x`, a RANGE, and corepack
# rejects anything but an exact version.
echo '{"name":"smoke","private":true,"type":"module"}' > package.json
corepack pnpm add louise-toolkit@<just-published> @louise-toolkit/astro@<just-published>

node --input-type=module -e '
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const pkg = JSON.parse(readFileSync("./node_modules/louise-toolkit/package.json", "utf8"));
const subs = Object.keys(pkg.exports).filter((s) => !s.includes("*") && s !== "./package.json");
let bad = 0;
for (const sub of [...subs.map((s) => "louise-toolkit" + s.slice(1)), "@louise-toolkit/astro"]) {
  try {
    if (!existsSync(fileURLToPath(import.meta.resolve(sub)))) { console.log("MISSING", sub); bad++; }
  } catch { console.log("UNRESOLVABLE", sub); bad++; }
}
console.log(`${subs.length + 1} subpaths checked, ${bad} broken`);
'
```

**Resolve, don't import.** `import.meta.resolve` walks the `exports` map and stops,
which is exactly the question being asked. Actually importing a subpath pulls in
the peer dependencies a consumer supplies — `drizzle-orm`, `better-auth`,
`solid-js` and eight more — so it fails in an empty project for reasons that have
nothing to do with the release.

**Astroid is a separate release.** `astroidjs` and `create-astroid` consume these
packages from npm and ship from
[bowenlabs/astroidjs](https://github.com/bowenlabs/astroidjs). A toolkit release
does not reach a scaffolded project until that repo bumps its dependency ranges
and publishes — a scaffold pins `^0.27.0`-style ranges, which are minor-locked
pre-1.0 and will not pick up a new minor on their own. If this release is meant
to reach users of Astroid, open the follow-up there.

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

- **pnpm and npm both cache `@latest`.** Pin the exact version when smoke-testing
  a release rather than trusting a floating tag; a cached older copy looks
  identical to a broken publish.
- **You cannot cleanly unpublish.** If a bad version ships, roll forward with a
  patch (`pnpm changeset` → `changeset version` → publish), don't unpublish.

## Pre-1.0

Versions are pre-1.0, so a minor bump is where breaking changes live and there is
no deprecation cycle. Read the changelogs before publishing — `changeset version`
writes them from the changesets, and they are the only place a behaviour change
is explained at the length it deserves.
