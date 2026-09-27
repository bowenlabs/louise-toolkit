#!/usr/bin/env sh
# Build the docs for Cloudflare Workers Builds.
#
# workers/docs is a static Starlight site served by an assets-only Worker
# (workers/docs/wrangler.jsonc). Its pages don't import the library, so there's
# nothing to pack first: install, then build the docs to workers/docs/dist.
set -e

corepack pnpm -C workers/docs run build

# Workers Builds doesn't run the deploy step from one place: depending on the
# build, it runs `npx wrangler preview` from the repository root or
# `cd workers/docs && npx wrangler deploy` (or `versions upload`), whatever the
# dashboard says. Two deploy redirects make both work. From the root, Wrangler
# finds no config, so the root redirect points it at the docs config. From
# workers/docs, Wrangler would find that same root redirect beside a config in
# a different directory and refuse to pick one, so workers/docs gets its own
# redirect, to the config next to it, which it finds first. Wrangler resolves
# `assets.directory` relative to the config either way. Only in Workers Builds,
# so a local `wrangler` is unaffected.
if [ -n "$WORKERS_CI" ]; then
  mkdir -p .wrangler/deploy workers/docs/.wrangler/deploy
  printf '{ "configPath": "../../workers/docs/wrangler.jsonc" }\n' > .wrangler/deploy/config.json
  printf '{ "configPath": "../../wrangler.jsonc" }\n' > workers/docs/.wrangler/deploy/config.json
fi
