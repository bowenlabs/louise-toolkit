#!/usr/bin/env bash
# Everything else BUILDS scaffolds; this RUNS one. A whole class of defect is
# invisible until the worker actually serves a request — the section catalog not
# being enforced on the pages write path, a rejected write answering 500 instead
# of 422, the colorway utilities missing from the built CSS, a dead /contact
# link. Each was green in the unit suites, `astro check`, AND `astroid doctor`;
# each was caught by serving a scaffold on workerd.
#
# Usage: live-smoke.sh <built-scaffold-dir>
set -euo pipefail

cd "${1:?usage: live-smoke.sh <built-scaffold-dir>}"

W=node_modules/.bin/wrangler
B=http://localhost:8788
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
fail() { echo "LIVE SMOKE FAIL: $1"; [ -f dev.log ] && tail -40 dev.log; exit 1; }

# The colorway / alignment utilities live ONLY in astroidjs's section components
# — source under node_modules, which Tailwind v4 won't scan without the
# template's `@source`. Drop it and these vanish from the built CSS, and every
# `_settings` colorway silently renders on the default surface. (btn-primary
# survives because daisyUI ships it as component CSS — which is exactly what hid
# this.)
CSS=$(cat dist/client/_astro/*.css)
for u in "bg-primary" "text-primary-content" "items-center"; do
  grep -q "\.$u" <<<"$CSS" \
    || fail "section utility .$u missing from built CSS — Tailwind is not scanning astroidjs components"
done
echo "section-library utilities present in the built CSS"

# wrangler dev routes the request through the scaffold's `hosts` domain, so the
# app is NOT localhost and needs a real SESSION_SECRET — written beside the
# config wrangler actually loads (the adapter-emitted one).
printf 'SESSION_SECRET=ci-live-smoke-secret\nMAIL_FROM=no-reply@smoke.example\n' \
  > dist/server/.dev.vars

# Apply every migration + seed the home page and the first editor into the local
# D1 wrangler dev will read (same cwd ⇒ same default persist).
$W d1 migrations apply DB --local -c dist/server/wrangler.json --persist-to .wrangler/state
$W d1 execute DB --local -c dist/server/wrangler.json --persist-to .wrangler/state --file seed/home.seed.sql
OWNER_EMAIL=owner@smoke.example corepack pnpm seed:editors --local

# Serve on workerd; kill it however we exit. Capture the PID rather than a `%1`
# job spec — job control is off in a non-interactive runner shell, so `%1` would
# not resolve.
$W dev -c dist/server/wrangler.json --persist-to .wrangler/state --port 8788 --local > dev.log 2>&1 &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do if curl -sf -o /dev/null "$B/"; then break; fi; sleep 1; done

# Public surface + the gate.
[ "$(code "$B/")" = "200" ]         || fail "home did not serve 200"
[ "$(code "$B/contact")" = "200" ]  || fail "/contact did not serve 200 (dead link regressed?)"
[ "$(code "$B/api/louise/overview")" = "401" ] \
  || fail "editor API not gated — overview is not 401 when signed out"

# A real sign-in: request a magic link, read the message miniflare wrote to disk,
# follow the token, keep the session cookie.
curl -s -o /dev/null -X POST -H 'content-type: application/json' -H "Origin: $B" \
  -H 'CF-Connecting-IP: 10.0.0.1' \
  -d '{"email":"owner@smoke.example","callbackURL":"/?louise"}' \
  "$B/api/auth/sign-in/magic-link"
TOKEN=""
for _ in $(seq 1 30); do
  MD=$(find . -type d -name email-text 2>/dev/null | head -1)
  if [ -n "$MD" ]; then
    for f in $(ls -t "$MD"/*.txt 2>/dev/null); do
      t=$(grep -hoE 'magic-link/verify\?token=[A-Za-z0-9_-]+' "$f" | head -1 | sed 's/.*token=//')
      if [ -n "$t" ]; then TOKEN="$t"; break; fi
    done
  fi
  if [ -n "$TOKEN" ]; then break; fi
  sleep 1
done
[ -n "$TOKEN" ] || fail "no magic-link token was mailed — sign-in is broken"
curl -s -o /dev/null -c cookies.txt \
  "$B/api/auth/magic-link/verify?token=$TOKEN&callbackURL=/?louise"
grep -q better-auth cookies.txt || fail "no session cookie issued after verify"
[ "$(code -b cookies.txt "$B/api/louise/overview")" = "200" ] \
  || fail "signed-in overview is not 200"

PID=$(curl -s -b cookies.txt "$B/api/louise/pages" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).pages.find(x=>x.slug==="home");process.stdout.write(p?String(p.id):"")})')
[ -n "$PID" ] || fail "could not resolve the seeded home page id"

# The reason this leg exists: pagesRoute takes no collection config, so these
# pass ONLY if the generator wired the section sanitize + validate hooks into it.
# Each was a silent 200-and-store before the fix.
patch() { code -X PATCH -b cookies.txt -H 'content-type: application/json' -H "Origin: $B" -d "$1" "$B/api/louise/pages/$PID"; }
[ "$(patch '{"sections":[{"_type":"definitely-not-a-section","heading":"x"}]}')" = "422" ] \
  || fail "pagesRoute did not 422 an unknown section _type"
[ "$(patch '{"sections":[{"_type":"hero","heading":"x","_settings":{"colorway":"chartreuse"}}]}')" = "422" ] \
  || fail "pagesRoute did not 422 a _settings token outside its options"
curl -s -o /dev/null -X PATCH -b cookies.txt -H 'content-type: application/json' -H "Origin: $B" \
  -d '{"sections":[{"_type":"faq","heading":"p","items":[{"question":"q","answer":"<p>ok</p><script>window.__XSS__=1</script>"}]}]}' \
  "$B/api/louise/pages/$PID"
if curl -s "$B/" | grep -q '__XSS__'; then
  fail "pagesRoute did not sanitize section rich text — a <script> reached the public page"
fi

# versionsRoute must answer 422 (the collection hook's LouiseValidationError),
# not the unhandled 500 it used to leak. This is a FIRST draft write, so it
# flushes to D1 and validates synchronously.
vpost() { code -X POST -b cookies.txt -H 'content-type: application/json' -H "Origin: $B" -d "$2" "$B/api/louise/pages/$PID/$1"; }
[ "$(vpost versions '{"sections":[{"_type":"definitely-not-a-section"}],"title":"x"}')" = "422" ] \
  || fail "versionsRoute did not 422 a bad section (regressed to 500?)"

# The KV write-buffer defers validation: a valid draft opens the buffer (first
# write flushes → 201), a bad draft within the window COALESCES into KV
# unvalidated (200), and the bad section is validated for the first time when
# publish flushes the buffer. That flush ran OUTSIDE the publish try/catch and
# leaked a 500; it must now 422 (the content is kept off the live page either
# way).
[ "$(vpost versions '{"sections":[{"_type":"hero","heading":"ok","_settings":{"colorway":"brand"}}],"title":"x"}')" = "201" ] \
  || fail "a valid first draft write did not 201"
vpost versions '{"sections":[{"_type":"definitely-not-a-section"}],"title":"x"}' >/dev/null
[ "$(vpost publish '{}')" = "422" ] \
  || fail "publish did not 422 when flushing a buffered bad section (regressed to 500?)"
curl -s "$B/" | grep -q 'definitely-not-a-section' \
  && fail "a buffered bad section reached the live page on publish" || true

# And a VALID structural write still succeeds — the hooks reject bad input, not
# all input.
[ "$(patch '{"sections":[{"_type":"hero","heading":"Valid","_settings":{"colorway":"brand"}}]}')" = "200" ] \
  || fail "pagesRoute rejected a VALID section — the hooks are too strict"

echo "live smoke: served scaffold passed every check"
