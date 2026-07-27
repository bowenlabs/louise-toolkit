#!/usr/bin/env bash
# A second scaffold, for the PORTFOLIO archetype. Not redundant with the
# storefront run: that one never emits src/pages/work.astro, so it never compiles
# JustifiedGallery.astro or MediaSlot.astro — and .astro files are invisible to
# tsgo and vitest, so without this they ship with nothing having type-checked
# them at all. `astro check` is the only thing in the repo that reads them.
#
# Usage: smoke-portfolio.sh <pack-dir> <room-dir>
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=./lib/clean-room.sh
. "$REPO/scripts/ci/lib/clean-room.sh"

PACK="${1:?usage: smoke-portfolio.sh <pack-dir> <room-dir>}"
ROOM="${2:?usage: smoke-portfolio.sh <pack-dir> <room-dir>}"

clean_room_init "$PACK" "$ROOM"

# --map --pwa on purpose. Both modules generate code that NOTHING else compiles:
# the tile route and MapEmbed.astro are written into the project, and sw.js / the
# manifest are static files under public/. Without them here they would ship
# having been checked nowhere.
#
# Passing both together also guards the merge hazard they created — each
# contributes to `modules`, and a naive resolution lets one overwrite the other
# silently.
#
# --portal is here for the same reason: it generates src/portal-auth.ts and the
# portal auth catch-all, and until it was added to a scaffold that runs `astro
# check`, NOTHING compiled either of them. The portal's 28 unit tests assert the
# generator's output as strings; only this step type-checks the code it produces.
node node_modules/create-astroid/index.mjs folio \
  --key folio --name "Folio" --archetype portfolio --color "#5b4bff" \
  --map --pwa --portal --realtime

test -f folio/src/pages/work.astro || {
  echo "portfolio scaffold did not write src/pages/work.astro"; exit 1; }
for f in src/pages/map/basemap.pmtiles.ts src/components/MapEmbed.astro \
         public/sw.js public/manifest.webmanifest \
         src/portal-auth.ts "src/pages/api/portal-auth/[...all].ts" \
         migrations/0002_portal_auth.sql src/edit-session.ts; do
  test -f "folio/$f" || { echo "module scaffold did not write $f"; exit 1; }
done

# The Durable Object binding is worthless without its migration, and the class
# must be exported from the ENTRY or wrangler can't resolve `class_name`. Both
# are deploy-time failures nothing else here catches.
grep -q 'new_sqlite_classes' folio/wrangler.jsonc || {
  echo "realtime DO has no migration block"; exit 1; }
grep -q 'export { EditSessionDO }' folio/src/worker.ts || {
  echo "the DO class is not exported from the worker entry"; exit 1; }
grep -q 'modules: \["map","pwa","realtime"\]' folio/astroid.config.ts || {
  echo "the modules array lost a module"; cat folio/astroid.config.ts; exit 1; }

# sw.js is plain JS in public/ and the manifest is data — neither is type-checked
# by anything, so parse them explicitly.
node --check folio/public/sw.js
node -e 'JSON.parse(require("fs").readFileSync("folio/public/manifest.webmanifest","utf8"))'
node -e 'JSON.parse(require("fs").readFileSync("folio/package.json","utf8"))'

clean_room_build_scaffold "$PACK" "$ROOM/folio"

# Type-check ASTROID'S OWN .astro components.
#
# `astro check` only diagnoses files inside the project, so components imported
# from node_modules/astroidjs are invisible to it — verified with a deliberate
# type error, which passed straight through. That left the whole section library
# compiling nowhere: tsgo doesn't read .astro, vitest doesn't either, and a
# scaffold only surfaces errors in its OWN files (which is how the mountSections
# bug was caught).
#
# Copying them under src/ makes them project files for one check pass. Run after
# the build so the copies can't reach the output.
cp -r node_modules/astroidjs/src/components src/_astroid_probe
corepack pnpm exec astro check
rm -rf src/_astroid_probe
