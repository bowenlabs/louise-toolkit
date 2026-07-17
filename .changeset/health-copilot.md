---
"louise-toolkit": minor
---

Add the site-health co-pilot data layer (#106) — a new `louise-toolkit/health` module that composes Louise's existing primitives into one persisted, owner-facing health snapshot the Home dashboard's Health card (#108) reads.

- **`HealthSummary`** — `{ brokenLinks, missingAlt, seoGaps, checkedAt, brokenLinkDetails? }`, shape-compatible with `overview.health` so a stored summary can be returned from the overview route directly.
- **`summarizeHealth(input)`** — assembles the snapshot from a scan's parts: exact counts, a capped sample of broken-link details (`MAX_BROKEN_LINK_DETAILS`), and the scan timestamp (injectable `now`). Bad counts are guarded to non-negative integers.
- **`readHealthSummary` / `writeHealthSummary`** — persist the snapshot in KV via a structural `HealthKV` interface (the real `KVNamespace` fits, no Workers-types dependency). A corrupt blob reads back as `null` rather than throwing. `healthIssueCount` sums the categories.

Why a persisted snapshot: broken-link checking is a crawl (seconds, network) that belongs on a Cron Trigger, so its result must be stored for the dashboard to read cheaply; the alt/SEO gap counts are cheap COUNTs a site computes at scan time. The Health card stays hidden until the first scan writes a summary.

Wired end-to-end on louisetoolkit.com: the cron `scheduled()` handler now runs a health scan (broken links + media missing alt + published pages with SEO gaps) and persists it, and the `overview.health` slice reads it back — lighting up the dashboard's Health card. The scan orchestration lives in the site (it owns the exact COUNTs); the toolkit ships the reusable summary + persistence primitive.
