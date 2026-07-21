---
"astroidjs": patch
---

`astroid doctor`: detect cron drift in `wrangler.jsonc`. The generated `scheduled`
handler dispatches on a fixed set of cron strings (`astroidCrons` — the daily
health scan plus the hourly catalog sync when commerce is on), but `wrangler.jsonc`
is scaffold-once, so a config that gains a cron can't update it. Doctor now parses
`triggers.crons` and errors when any expected cron is undeclared — the exact
silent-failure class it exists to catch (an undeclared cron means Cloudflare never
fires that job, while both doctor and deploy report healthy). Caught a real case
where the daily health scan never ran because only the hourly catalog cron was
declared.
