#!/usr/bin/env bash
# Exercise create-astroid end-to-end the way a USER gets it: install the packed
# tarballs into an empty directory outside the repo and scaffold from the
# installed copy — then validate the result.
#
# Runs `astro check` + `astro build` on the scaffold, not just `doctor`. Doctor
# validates config and file freshness but never resolves an import, so it cannot
# see a dependency the template forgot to declare — which is how a scaffold that
# couldn't build shipped once already.
#
# Usage: smoke-storefront.sh <pack-dir> <room-dir>
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=./lib/clean-room.sh
. "$REPO/scripts/ci/lib/clean-room.sh"

PACK="${1:?usage: smoke-storefront.sh <pack-dir> <room-dir>}"
ROOM="${2:?usage: smoke-storefront.sh <pack-dir> <room-dir>}"

clean_room_init "$PACK" "$ROOM"

# `--commerce` exercises the widest scaffold: the queue consumer, the webhook
# receiver, and the cron on top of the baseline.
node node_modules/create-astroid/index.mjs smoke \
  --key smoke --name "Smoke Test" --archetype storefront \
  --color "#5b4bff" --host smoke.example --commerce square

for f in astroid.config.ts wrangler.jsonc src/schema.ts src/worker.ts \
         src/middleware.ts src/queue.ts src/pages/api/webhooks/square.ts \
         .github/workflows/ci.yml; do
  test -f "smoke/$f" || { echo "scaffold did not write $f"; exit 1; }
done

node "$REPO/scripts/ci/checks/scaffold-versions.mjs" smoke

# Apply every migration to a throwaway SQLite db and assert the tables the
# generated schema reads actually exist.
#
# Nothing used to run this SQL. `--commerce` declared a `products` table in
# src/schema.ts, the queue seam told you to sync into it, and no migration
# created it — `astro check` can't see that, and `doctor` only checks the
# migrations/ directory exists. The first real catalog sync was the discovery
# mechanism.
#
# Apply EVERY migration in order (glob sorts 0000→0003). A hardcoded subset
# skipped the portal's 0002_portal_auth, so `user`/`session` never got created
# for a storefront and this check failed on `user`.
DB="$ROOM/smoke.db"
rm -f "$DB"
for f in smoke/migrations/*.sql; do
  sqlite3 "$DB" < "$f"
done
for t in pages pages_versions media site_settings inquiries user session products; do
  found=$(sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='$t';")
  test "$found" = "$t" || { echo "migrations did not create table: $t"; exit 1; }
done
echo "all migrations apply; every generated table exists"

# The generated worker embeds RAW SQL and raw column names that nothing else
# checks against the schema: the Home dashboard's COUNT query, and the media
# delete-safety reference columns. `astro check` type-checks the strings but
# cannot know whether `pages_versions.parent_id` exists. Run the one and probe
# the other against the database just built.
sqlite3 "$DB" "SELECT (SELECT COUNT(*) FROM pages WHERE status = 'draft') AS drafts, (SELECT COUNT(DISTINCT parent_id) FROM pages_versions WHERE status = 'draft') AS unpublished, (SELECT MAX(updated_at) FROM pages) AS last_edited;" >/dev/null \
  || { echo "the generated overview SQL does not run against the generated schema"; exit 1; }
for c in body sections og_image title; do
  sqlite3 "$DB" "SELECT \"$c\" FROM pages LIMIT 1;" >/dev/null \
    || { echo "media reference column pages.$c does not exist"; exit 1; }
done
for c in logo_url favicon_url default_og_image_url site_name; do
  sqlite3 "$DB" "SELECT \"$c\" FROM site_settings LIMIT 1;" >/dev/null \
    || { echo "media reference column site_settings.$c does not exist"; exit 1; }
done
echo "generated overview SQL runs; every media reference column exists"

# The sign-in page must render the Turnstile widget under the SAME condition the
# server arms the captcha, and forward the token in the header Better Auth reads.
# Get this wrong and provisioning Turnstile — which .env.example invites you to
# do — locks the owner out of their own site with a 403 and no explanation.
# Nothing type-checks the relationship between the two halves, so assert it here.
grep -q "turnstileSiteKey" smoke/src/pages/login.astro \
  || { echo "login.astro no longer gates the widget on turnstileSiteKey"; exit 1; }
grep -q "x-captcha-response" smoke/src/pages/login.astro \
  || { echo "login.astro no longer sends the captcha token header"; exit 1; }
echo "sign-in captcha wiring present"

node "$REPO/scripts/ci/checks/crons-dispatched.mjs" smoke

node node_modules/astroidjs/bin/astroid.mjs doctor --cwd smoke

clean_room_build_scaffold "$PACK" "$ROOM/smoke"
