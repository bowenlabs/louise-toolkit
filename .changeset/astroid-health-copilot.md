---
"astroidjs": minor
"create-astroid": minor
---

Wire the site-health co-pilot, so the Health panel that already ships has a backend.

This is the same shape as the `overviewRoute` gap: `louise-toolkit/health` and `healthRoute` existed, and the Health card and panel ship in the editor drawer astroid mounts — but nothing provisioned the subsystem, so the panel was UI for something that could never have data.

Now generated: `healthRoute`, the `health` slice on `overviewRoute`, and a daily cron that crawls the site's own pages for broken links and counts images missing alt text and published pages missing SEO. The summary lands in the **existing `RL` namespace** under its own key rather than a new binding — it's one small singleton blob, and a binding you must remember to provision before the dashboard works is a binding people don't provision. Until the first scan runs the route returns `{ summary: null }`, which the panel renders as "not checked yet".

Every part of the scan degrades on its own: a failed crawl or a missing table yields zero rather than aborting, because a partial health report is worth strictly more than none.

**Crons are now a list, and the handler dispatches on `controller.cron`.** Cloudflare fires one `scheduled` handler for every trigger and identifies which fired by that string, so `wrangler.jsonc`'s `triggers.crons` and the handler's dispatch have to agree exactly — a string in one and not the other is a job that silently never runs, with no error and no log. Both now derive from `astroidCrons`, and CI asserts every declared cron is dispatched. The health scan is daily (`17 4 * * *`) and deliberately not on the hourly catalog cron: hourly would be a self-inflicted crawl 24× a day to recompute counts that move slowly.

Consequently `scheduled` is emitted for every project, not only those with queues, and `triggers` always has at least the health entry. Disabling `queues.cron` now drops only the catalog re-sync.

Also: `SITE_URL` is finally typed in the scaffold's `env.d.ts` — `wrangler.jsonc` declared the var but reading it was a type error.
