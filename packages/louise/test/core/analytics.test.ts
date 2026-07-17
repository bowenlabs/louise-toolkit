// #106 CWV — Core Web Vitals on Analytics Engine: thresholds/summary, beacon
// payload validation + data-point shape, the AE p75 SQL + row parsing, the
// public ingestion route (same-origin, best-effort write), and the beacon script.

import { describe, expect, it } from "vitest";
import {
  type AnalyticsEngineLike,
  cwvBeaconScript,
  cwvSqlQuery,
  parseCwvRows,
  parseVital,
  rateMetric,
  summarizeCwv,
  vitalDataPoint,
  vitalsRoute,
} from "../../src/core/analytics/index.js";

const ctx = {} as ExecutionContext;
const VITALS = "https://site.example/api/louise/vitals";

function fakeDataset() {
  const points: unknown[] = [];
  const dataset: AnalyticsEngineLike = { writeDataPoint: (p) => points.push(p) };
  return { dataset, points };
}
const post = (body: unknown, origin = "https://site.example") =>
  new Request(VITALS, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("CWV thresholds + summary", () => {
  it("rates each metric against Google's cutoffs", () => {
    expect(rateMetric("LCP", 2500)).toBe("good");
    expect(rateMetric("LCP", 3000)).toBe("needs-improvement");
    expect(rateMetric("LCP", 4001)).toBe("poor");
    expect(rateMetric("INP", 200)).toBe("good");
    expect(rateMetric("CLS", 0.05)).toBe("good");
    expect(rateMetric("CLS", 0.3)).toBe("poor");
  });

  it("summarizes to the worst present metric", () => {
    const s = summarizeCwv({ lcp: 2000, inp: 300, cls: 0.05, sampleSize: 40 });
    expect(s.rating).toBe("needs-improvement"); // INP drags it down
    expect(s).toMatchObject({ lcp: 2000, inp: 300, cls: 0.05, sampleSize: 40 });
  });

  it("is 'none' with no sample or no metrics", () => {
    expect(summarizeCwv({ lcp: 1000, sampleSize: 0 }).rating).toBe("none");
    expect(summarizeCwv({ sampleSize: 10 }).rating).toBe("none");
  });
});

describe("beacon payload", () => {
  it("accepts a valid reading and truncates a long path", async () => {
    expect(await parseVital({ name: "LCP", value: 1234, path: "/x" })).toEqual({
      name: "LCP",
      value: 1234,
      path: "/x",
    });
    const long = await parseVital({ name: "CLS", value: 0.1, path: "/".padEnd(600, "a") });
    expect(long?.path?.length).toBe(512);
  });

  it("rejects a bad metric, a non-number, and out-of-range values", async () => {
    expect(await parseVital({ name: "TTFB", value: 1 })).toBeNull();
    expect(await parseVital({ name: "LCP", value: "slow" })).toBeNull();
    expect(await parseVital({ name: "LCP", value: -1 })).toBeNull();
    expect(await parseVital({ name: "LCP", value: 9_999_999 })).toBeNull();
    expect(await parseVital(null)).toBeNull();
  });

  it("shapes a data point: metric as index, path as blob, value as double", () => {
    expect(vitalDataPoint({ name: "INP", value: 180, path: "/p" })).toEqual({
      indexes: ["INP"],
      blobs: ["/p"],
      doubles: [180],
    });
  });
});

describe("AE query", () => {
  it("builds a p75-per-metric SQL over a bounded window", () => {
    const sql = cwvSqlQuery("louise_web_vitals", 48);
    expect(sql).toContain("FROM louise_web_vitals");
    expect(sql).toContain("quantileWeighted(0.75)(double1, _sample_interval)");
    expect(sql).toContain("INTERVAL '48' HOUR");
    expect(sql).toContain("GROUP BY metric");
  });

  it("rejects an unsafe dataset name (no injection)", () => {
    expect(() => cwvSqlQuery("web; DROP TABLE x")).toThrow();
  });

  it("reduces result rows into a summary input, taking the max sample", () => {
    expect(
      parseCwvRows([
        { metric: "LCP", p75: 2100, samples: 120 },
        { metric: "INP", p75: 190, samples: 118 },
        { metric: "CLS", p75: 0.04, samples: 120 },
        { metric: "junk", p75: 5 },
      ]),
    ).toEqual({ lcp: 2100, inp: 190, cls: 0.04, sampleSize: 120 });
  });
});

describe("vitalsRoute", () => {
  it("passes through a non-matching path", async () => {
    const { dataset } = fakeDataset();
    const r = vitalsRoute({ dataset: () => dataset });
    expect(await r(new Request("https://site.example/other"), {}, ctx)).toBeUndefined();
  });

  it("405s a non-POST", async () => {
    const { dataset } = fakeDataset();
    const r = vitalsRoute({ dataset: () => dataset });
    expect((await r(new Request(VITALS), {}, ctx))?.status).toBe(405);
  });

  it("refuses a cross-origin beacon", async () => {
    const { dataset, points } = fakeDataset();
    const r = vitalsRoute({ dataset: () => dataset });
    const res = await r(post({ name: "LCP", value: 1000 }, "https://evil.example"), {}, ctx);
    expect(res?.status).toBe(403);
    expect(points).toHaveLength(0);
  });

  it("writes a valid same-origin reading and 204s", async () => {
    const { dataset, points } = fakeDataset();
    const r = vitalsRoute({ dataset: () => dataset });
    const res = await r(post({ name: "LCP", value: 2200, path: "/" }), {}, ctx);
    expect(res?.status).toBe(204);
    expect(points).toEqual([{ indexes: ["LCP"], blobs: ["/"], doubles: [2200] }]);
  });

  it("accepts-and-drops a malformed payload (still 204, no write)", async () => {
    const { dataset, points } = fakeDataset();
    const r = vitalsRoute({ dataset: () => dataset });
    expect((await r(post({ name: "NOPE", value: 1 }), {}, ctx))?.status).toBe(204);
    expect(points).toHaveLength(0);
  });

  it("stays optional when no dataset is wired (204, nothing thrown)", async () => {
    const r = vitalsRoute<{ ANALYTICS?: AnalyticsEngineLike }>({ dataset: (env) => env.ANALYTICS });
    expect((await r(post({ name: "LCP", value: 1000 }), {}, ctx))?.status).toBe(204);
  });
});

describe("cwvBeaconScript", () => {
  it("inlines the endpoint and the observers, honouring the sample rate", () => {
    const js = cwvBeaconScript({ endpoint: "/beacon", sampleRate: 0.5 });
    expect(js).toContain('"/beacon"');
    expect(js).toContain("sendBeacon");
    expect(js).toContain("largest-contentful-paint");
    expect(js).toContain("layout-shift");
    expect(js).toContain("Math.random() >= 0.5");
  });

  it("defaults to the vitals endpoint and full sampling", () => {
    const js = cwvBeaconScript();
    expect(js).toContain('"/api/louise/vitals"');
    expect(js).toContain("Math.random() >= 1");
  });
});
