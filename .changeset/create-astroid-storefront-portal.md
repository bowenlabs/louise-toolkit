---
"create-astroid": patch
---

Storefront scaffolds now ship a working customer portal. `--archetype storefront`
auto-enables the portal (a shop has customers who sign in), and the portal's Better
Auth instance uses **unprefixed** `user`/`session` tables with email + password —
matching the studio's `louise_`-prefixed tables without collision, and mirroring the
reference storefront. The generated `0002_portal_auth.sql` now creates those tables
with `customers: true` (the `account.password` column the seam needs), the scaffolded
`astroid.config.ts` persists the portal's `tablePrefix`/`signUp` so a later `astroid
generate` stays consistent, and the CI scaffold smoke test applies **every** migration
(a hardcoded subset had skipped `0002`, so `user`/`session` were never created).
