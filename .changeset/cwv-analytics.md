---
"louise-toolkit": minor
---

Add the Core Web Vitals piece of the site-health co-pilot (#106) on Cloudflare Analytics Engine — owned, cookieless, real-visitor performance, surfaced as a plain "Fast / Slow" badge in the Health panel.

New `louise-toolkit/analytics` module:
- **`cwvBeaconScript(opts)`** — a self-contained, dependency-free JS beacon to inline on public pages. Observes LCP, CLS, and (approximate) INP via `PerformanceObserver` and reports each once, on `visibilitychange`, via `sendBeacon`. Cookieless; optional `sampleRate`.
- **`vitalsRoute`** — the public `POST /api/louise/vitals` ingestion route: **same-origin only** (a cross-origin `Origin` is refused), validates the payload, and writes an Analytics Engine data point (metric as index, page as blob, value as double). Always `204`; a malformed payload or unprovisioned dataset is accepted-and-dropped, so it's cleanly optional.
- **Query + summary** — `cwvSqlQuery(dataset, sinceHours)` builds the AE SQL for the p75 of each metric (sampling-aware via `quantileWeighted`/`_sample_interval`); `parseCwvRows` + `summarizeCwv` reduce it to a `CwvSummary` (per-metric p75 + an overall rating = the worst present metric, per Google's thresholds), or `"none"` when there's no field data.
- `HealthSummary` gains an optional `cwv` slice, and the Health panel renders a **Performance** section — a "Fast / Could be faster / Slow" badge plus plain-language Loading / Responsiveness / Visual-stability figures, or "not measured yet" until data arrives.

This is the library layer (fully unit-tested); wiring it on a site — inlining the beacon, binding an Analytics Engine dataset, mounting `vitalsRoute`, and folding the p75 into the scheduled health scan — is a per-site step (deploy-only verifiable).
