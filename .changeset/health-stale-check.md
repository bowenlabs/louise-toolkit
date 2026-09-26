---
"louise-toolkit": minor
---

The Health panel now marks the last check as out of date when the scheduled scan hasn't run for more than 36 hours. Before, a scan that stopped running a week ago looked the same as one that ran an hour ago, because the panel showed "Last checked" with no threshold.

- **`isStale(timestamp, maxAgeMs, now?)`** (`louise-toolkit/health`) is a new pure check for any scheduled job's last success. It takes an ISO string, epoch milliseconds, or a `Date`. A missing or unparseable timestamp counts as stale, a future one (clock skew) counts as fresh, and an age of exactly `maxAgeMs` counts as fresh. `HEALTH_STALE_AFTER_MS` is the 36-hour default.
- **The Health panel** shows a stale check in amber, with the words "Out of date" and a note to ask the developer, so the warning doesn't rest on color alone. `HealthPanel` takes `staleAfterMs`, and `Settings` and `Studio` take `dashboard.healthStaleAfterMs`.

**What to do:** nothing, if your health scan runs daily. If it runs less often, set `dashboard.healthStaleAfterMs` to a bit more than the interval, for example `8 * 24 * 60 * 60 * 1000` for a weekly scan, or the panel marks every check as out of date. A summary whose `checkedAt` can't be parsed now shows as out of date instead of "Last checked recently."
