// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/analytics — Core Web Vitals (RUM) on Cloudflare Analytics Engine
// (#106 CWV piece). Real-visitor LCP/INP/CLS, owned and queryable, so the health
// co-pilot can show a plain "Fast ✓ / Slow" performance badge — no third-party
// analytics, no cookies.
//
// The loop: a tiny cookieless beacon on public pages ({@link cwvBeaconScript})
// reports each metric to {@link vitalsRoute}, which writes a data point to an
// Analytics Engine dataset. A scheduled job later queries the p75 of each metric
// ({@link cwvSqlQuery} → {@link parseCwvRows} → {@link summarizeCwv}) and folds a
// {@link CwvSummary} into the persisted HealthSummary. Every step degrades
// gracefully: no dataset binding → the beacon route accepts-and-drops and the
// badge reads "not measured yet".

import { s, standardValidate } from "../schema/index.js";
import type { WorkerRoute } from "../worker/index.js";

/** The three Core Web Vitals Louise tracks. */
export type CwvMetric = "LCP" | "INP" | "CLS";
export const CWV_METRICS: readonly CwvMetric[] = ["LCP", "INP", "CLS"];

export type CwvRating = "good" | "needs-improvement" | "poor";

/** Google's field thresholds: `<= good` is good, `> poor` is poor, between is
 *  "needs improvement". LCP/INP in ms, CLS unitless. */
export const CWV_THRESHOLDS: Record<CwvMetric, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
};

/** Rate one metric value against its thresholds. */
export function rateMetric(name: CwvMetric, value: number): CwvRating {
  const t = CWV_THRESHOLDS[name];
  return value <= t.good ? "good" : value <= t.poor ? "needs-improvement" : "poor";
}

/** The p75 CWV snapshot folded into HealthSummary — values plus an overall
 *  rating (the worst present metric), or `"none"` when no field data yet. */
export interface CwvSummary {
  lcp?: number;
  inp?: number;
  cls?: number;
  rating: CwvRating | "none";
  /** Approximate number of measurements the p75 is over (0 → not measured). */
  sampleSize: number;
}

const RATING_ORDER: readonly CwvRating[] = ["good", "needs-improvement", "poor"];

/** Build a {@link CwvSummary} from per-metric p75 values: the overall rating is
 *  the worst of the metrics present, or `"none"` when there's no sample. */
export function summarizeCwv(input: {
  lcp?: number;
  inp?: number;
  cls?: number;
  sampleSize: number;
}): CwvSummary {
  const present: [CwvMetric, number][] = [];
  if (input.lcp != null) present.push(["LCP", input.lcp]);
  if (input.inp != null) present.push(["INP", input.inp]);
  if (input.cls != null) present.push(["CLS", input.cls]);
  let worst = -1;
  for (const [name, value] of present)
    worst = Math.max(worst, RATING_ORDER.indexOf(rateMetric(name, value)));
  const rating = input.sampleSize > 0 && worst >= 0 ? RATING_ORDER[worst] : "none";
  return { lcp: input.lcp, inp: input.inp, cls: input.cls, rating, sampleSize: input.sampleSize };
}

// ── Ingestion ──────────────────────────────────────────────────────────────

/** The Analytics Engine surface the ingestion route needs — structural so the
 *  real `AnalyticsEngineDataset` binding fits without importing Workers types. */
export interface AnalyticsEngineLike {
  writeDataPoint(point: {
    indexes?: string[];
    blobs?: (string | null)[];
    doubles?: number[];
  }): void;
}

/** A validated beacon reading. `path` is the page it was measured on. */
export interface VitalReading {
  name: CwvMetric;
  value: number;
  path?: string;
}

const VITAL_BODY = s.object({
  name: s.enumOf("LCP", "INP", "CLS"),
  value: s.number(),
  path: s.optional(s.string()),
});

/** Sane ceiling on a reported value — rejects garbage/adversarial payloads
 *  (an hour in ms comfortably exceeds any real LCP/INP; CLS is well under it). */
const MAX_VITAL_VALUE = 3_600_000;

/** Validate a beacon payload into a {@link VitalReading}, or `null` when it's
 *  malformed / out of range (never throws). */
export async function parseVital(body: unknown): Promise<VitalReading | null> {
  const parsed = await standardValidate(VITAL_BODY, body);
  if (!parsed.ok) return null;
  const { name, value, path } = parsed.value;
  if (!Number.isFinite(value) || value < 0 || value > MAX_VITAL_VALUE) return null;
  return { name, value, path: typeof path === "string" ? path.slice(0, 512) : undefined };
}

/** Shape a reading into an Analytics Engine data point: metric name is the
 *  index (so queries group by it), page is a blob, value a double. */
export function vitalDataPoint(v: VitalReading): {
  indexes: string[];
  blobs: (string | null)[];
  doubles: number[];
} {
  return { indexes: [v.name], blobs: [v.path ?? ""], doubles: [v.value] };
}

export interface VitalsRouteConfig<Env> {
  /** The Analytics Engine dataset binding, e.g. `(env) => env.ANALYTICS`.
   *  `undefined` (unprovisioned) → the route accepts and drops, staying optional. */
  dataset: (env: Env) => AnalyticsEngineLike | undefined;
  /** Mount path. Default `/api/louise/vitals`. */
  path?: string;
}

/**
 * Build the public CWV ingestion route: `POST /api/louise/vitals`. It's
 * unauthenticated (anonymous visitor beacons) but **same-origin only** — a
 * cross-origin `Origin` is refused so it can't be spammed from elsewhere. Always
 * answers `204` (the beacon ignores the body); a malformed payload or missing
 * dataset is silently dropped. Returns `undefined` for a non-matching path.
 */
export function vitalsRoute<Env>(config: VitalsRouteConfig<Env>): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/vitals";
  return async (request, env) => {
    const url = new URL(request.url);
    if (url.pathname !== path) return undefined;
    if (request.method !== "POST")
      return Response.json({ error: "Method not allowed" }, { status: 405 });

    // Same-origin guard: a real beacon's Origin matches the request host, so a
    // cross-origin Origin is spam and refused. (A missing Origin — e.g. a
    // same-origin sendBeacon that omits it — is allowed through.)
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== url.host) return new Response(null, { status: 403 });
      } catch {
        return new Response(null, { status: 403 });
      }
    }

    const dataset = config.dataset(env);
    const reading = await parseVital(await request.json().catch(() => null));
    if (dataset && reading) {
      try {
        dataset.writeDataPoint(vitalDataPoint(reading));
      } catch {
        // Best-effort: never fail a beacon on a write hiccup.
      }
    }
    return new Response(null, { status: 204 });
  };
}

// ── Query ─────────────────────────────────────────────────────────────────

const SAFE_DATASET = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Analytics Engine SQL for the p75 of each metric over the last `sinceHours`.
 * `index1` is the metric name, `double1` the value; `quantileWeighted` accounts
 * for AE's adaptive sampling via `_sample_interval`.
 */
export function cwvSqlQuery(dataset: string, sinceHours = 24): string {
  if (!SAFE_DATASET.test(dataset)) throw new Error(`Invalid dataset name: ${dataset}`);
  const hours = Math.max(1, Math.trunc(sinceHours));
  return (
    `SELECT index1 AS metric, ` +
    `quantileWeighted(0.75)(double1, _sample_interval) AS p75, ` +
    `sum(_sample_interval) AS samples ` +
    `FROM ${dataset} ` +
    `WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR ` +
    `GROUP BY metric`
  );
}

/** Reduce {@link cwvSqlQuery} result rows into {@link summarizeCwv} input. */
export function parseCwvRows(
  rows: readonly { metric?: unknown; p75?: unknown; samples?: unknown }[],
): { lcp?: number; inp?: number; cls?: number; sampleSize: number } {
  const out: { lcp?: number; inp?: number; cls?: number; sampleSize: number } = { sampleSize: 0 };
  let samples = 0;
  for (const row of rows) {
    const value = Number(row.p75);
    if (!Number.isFinite(value)) continue;
    if (row.metric === "LCP") out.lcp = value;
    else if (row.metric === "INP") out.inp = value;
    else if (row.metric === "CLS") out.cls = value;
    samples = Math.max(samples, Number(row.samples) || 0);
  }
  out.sampleSize = samples;
  return out;
}

// ── Client beacon ────────────────────────────────────────────────────────

/**
 * The cookieless CWV beacon to inline in a `<script>` on public pages. It
 * observes LCP, CLS, and (approximate) INP via `PerformanceObserver` and reports
 * each once, on the first `visibilitychange` to hidden, via `sendBeacon`. INP is
 * approximated as the longest interaction — enough for an owner-facing badge, not
 * a lab-grade number. Self-contained (no dependency), so it inlines CSP-safely.
 *
 * @param opts.endpoint  where to POST (default `/api/louise/vitals`).
 * @param opts.sampleRate  fraction of page loads that report (0–1, default 1).
 */
export function cwvBeaconScript(opts: { endpoint?: string; sampleRate?: number } = {}): string {
  const endpoint = JSON.stringify(opts.endpoint ?? "/api/louise/vitals");
  const rate = typeof opts.sampleRate === "number" ? Math.min(1, Math.max(0, opts.sampleRate)) : 1;
  return `(function(){
  if(Math.random() >= ${rate}) return;
  var EP=${endpoint},sent={},lcp=0,cls=0,inp=0;
  function send(n,v){if(sent[n])return;sent[n]=1;try{navigator.sendBeacon(EP,new Blob([JSON.stringify({name:n,value:v,path:location.pathname})],{type:"application/json"}));}catch(e){}}
  function ob(t,cb){try{new PerformanceObserver(cb).observe({type:t,buffered:true});}catch(e){}}
  ob("largest-contentful-paint",function(l){var e=l.getEntries();lcp=e[e.length-1].startTime;});
  ob("layout-shift",function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)cls+=e.value;});});
  try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.duration>inp)inp=e.duration;});}).observe({type:"event",buffered:true,durationThreshold:40});}catch(e){}
  addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden"){send("LCP",lcp);send("CLS",cls);send("INP",inp);}});
})();`;
}
