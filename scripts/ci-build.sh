#!/usr/bin/env sh
# Build the docs for Cloudflare Workers Builds.
#
# workers/docs is a static Starlight site served by an assets-only Worker
# (workers/docs/wrangler.jsonc). Its pages don't import the library, so there's
# nothing to pack first: install, then build the docs to workers/docs/dist,
# which the deploy command (`wrangler deploy` in workers/docs) uploads.
set -e

corepack pnpm -C workers/docs run build
