#!/usr/bin/env sh
# Build the docs for Cloudflare Workers Builds.
#
# workers/docs is a static Starlight site served by an assets-only Worker
# (workers/docs/wrangler.jsonc). Its pages don't import the library, so there's
# nothing to pack first: install, then build the docs to workers/docs/dist.
set -e

corepack pnpm -C workers/docs run build

# Workers Builds runs its deploy step from the repository root, and a branch
# build's step is always `npx wrangler preview`, whatever the dashboard's
# preview command or root directory says. From the root, Wrangler finds no
# config and fails. A deploy redirect file points it at the docs config
# instead; Wrangler resolves `assets.directory` relative to that config.
# Only in Workers Builds, so a local `wrangler` at the root is unaffected.
if [ -n "$WORKERS_CI" ]; then
  mkdir -p .wrangler/deploy
  printf '{ "configPath": "../../workers/docs/wrangler.jsonc" }\n' > .wrangler/deploy/config.json
fi
