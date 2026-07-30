---
title: analytics
description: "louise-toolkit/analytics — cookieless Core Web Vitals from real visitors, on Cloudflare Analytics Engine."
sidebar:
  order: 14.5
---

```ts
import {
  cwvBeaconScript,
  vitalsRoute,
  cwvSqlQuery,
  parseCwvRows,
  summarizeCwv,
} from "louise-toolkit/analytics";
```

Real-visitor LCP/INP/CLS, owned and queryable, so a site can show its own
performance badge. **No third-party analytics and no cookies.** Binding: an
Analytics Engine dataset. No required peers.

## It's a loop, not a toolbox

These five exports are one pipeline, and an alphabetical list of them is useless.
Each step feeds the next:

```
cwvBeaconScript   inline on public pages — observes LCP/INP/CLS
      ↓  navigator.sendBeacon
vitalsRoute       POST /api/louise/vitals → one data point
      ↓
Analytics Engine dataset
      ↓  scheduled job
cwvSqlQuery  →  parseCwvRows  →  summarizeCwv
      ↓
CwvSummary  →  folded into the HealthSummary the dashboard reads
```

**Every step degrades gracefully.** With no dataset binding the route
accepts-and-drops and the badge reads "not measured yet" — the beacon never
becomes an error the visitor can see.

### 1. The beacon

```ts
function cwvBeaconScript(opts?: { endpoint?: string; sampleRate?: number }): string;
```

Returns the script source to inline in a `<script>` on **public** pages. It
observes the three metrics via `PerformanceObserver` and reports each once, on the
first `visibilitychange` to hidden, via `sendBeacon` — so it never delays
navigation. Self-contained with no dependency, which is what lets it inline
CSP-safely.

**INP is approximated** as the longest interaction. That is enough for an
owner-facing "fast / slow" badge and is not a lab-grade number; don't report it as
one.

Inline it only when not in edit mode — the editor's own interactions aren't
visitor data.

### 2. The route

```ts
function vitalsRoute<Env>(config: VitalsRouteConfig<Env>): WorkerRoute<Env>;
```

Mounts `POST /api/louise/vitals`. **Unauthenticated but same-origin only** — it
has to accept anonymous visitor beacons, so a cross-origin `Origin` is refused
rather than letting anyone spam your dataset from elsewhere.

Always answers `204`: the beacon ignores the body, and a malformed payload or a
missing dataset is dropped silently. There is nothing useful to tell a visitor's
browser about your telemetry.

### 3. Query and summarize

```ts
function cwvSqlQuery(dataset: string, sinceHours?: number): string; // default 24
function parseCwvRows(rows): { lcp?; inp?; cls?; sampleSize };
function summarizeCwv(input): CwvSummary;
```

`cwvSqlQuery` asks for the **p75** of each metric — the standard CWV statistic,
not the mean. It uses `quantileWeighted` with `_sample_interval` because Analytics
Engine samples adaptively under load: ignoring that weight silently biases the
result on exactly the busy days you most want to measure.

`summarizeCwv` rates the overall result as **the worst metric present**, matching
how Core Web Vitals are assessed — a page is not "good" because two of three are.
With no sample it returns `rating: "none"` rather than a misleading "good".

## Rendering your own badge

```ts
const CWV_THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 }, // ms
  INP: { good: 200, poor: 500 }, // ms
  CLS: { good: 0.1, poor: 0.25 }, // unitless
};
function rateMetric(name: CwvMetric, value: number): "good" | "needs-improvement" | "poor";
```

Both are exported so a site can render its own indicator without re-deriving the
boundaries. `CWV_METRICS` lists the three in display order.

`CwvSummary` carries `{ lcp?, inp?, cls?, rating, sampleSize }`, where
`sampleSize` is approximate and `0` means not measured. Show that state as "not
measured yet", not as a score.

## Types

`CwvMetric`, `CwvRating`, `CwvSummary`, `VitalReading`, `VitalsRouteConfig`,
`AnalyticsEngineLike`. Constants: `CWV_METRICS`, `CWV_THRESHOLDS`. Also
`parseVital` and `vitalDataPoint` for a hand-rolled ingestion path.

`AnalyticsEngineLike` is declared structurally so a real
`AnalyticsEngineDataset` binding fits without this module importing Workers types.
