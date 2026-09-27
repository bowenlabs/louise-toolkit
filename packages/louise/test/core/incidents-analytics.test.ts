import { describe, expect, it, vi } from "vitest";
import type { AnalyticsEngineLike } from "../../src/core/analytics/index.js";
import {
  analyticsIncidents,
  buildIncidentReport,
  incidentCountsSqlQuery,
  incidentDataPoint,
  parseIncidentCountRows,
} from "../../src/core/incidents/index.js";
import { composeWorker } from "../../src/core/worker/index.js";

const report = buildIncidentReport({
  kind: "fetch",
  cause: new TypeError("fetch failed"),
  request: new Request("https://site.example/cart?x=1"),
  release: "v3",
  critical: true,
  now: 1_700_000_000_000,
});

describe("incidentDataPoint", () => {
  it("indexes by fingerprint and counts one", () => {
    expect(incidentDataPoint(report)).toEqual({
      indexes: [report.fingerprint],
      blobs: ["fetch", "TypeError", "/cart", "site.example", "v3", "critical"],
      doubles: [1],
    });
  });

  it("writes empty blobs for what a report doesn't have", () => {
    const bare = buildIncidentReport({ kind: "degraded", name: "content.read", cause: "stale" });
    expect(incidentDataPoint(bare).blobs).toEqual(["degraded", "content.read", "", "", "", ""]);
  });
});

describe("analyticsIncidents", () => {
  type Env = { EVENTS?: AnalyticsEngineLike };

  it("writes each captured report to the dataset", async () => {
    const writeDataPoint = vi.fn<AnalyticsEngineLike["writeDataPoint"]>();
    const worker = composeWorker<Env>({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      onIncident: analyticsIncidents((env: Env) => env.EVENTS),
    });
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException() {},
    };
    await expect(
      worker.fetch!(
        new Request("https://site.example/") as unknown as Parameters<
          NonNullable<ExportedHandler["fetch"]>
        >[0],
        { EVENTS: { writeDataPoint } },
        ctx as unknown as ExecutionContext,
      ),
    ).rejects.toThrow();
    await Promise.all(pending);
    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint.mock.calls[0]![0]).toMatchObject({
      blobs: ["fetch", "TypeError", "/", "site.example", "", ""],
      doubles: [1],
    });
  });

  it("drops the report when the dataset isn't provisioned", () => {
    expect(() => analyticsIncidents((env: Env) => env.EVENTS)(report, { env: {} })).not.toThrow();
  });
});

describe("incidentCountsSqlQuery", () => {
  it("counts per day over the last week by default", () => {
    expect(incidentCountsSqlQuery("INCIDENT_EVENTS")).toBe(
      "SELECT index1 AS fingerprint, blob1 AS kind, blob2 AS name, " +
        "toStartOfInterval(timestamp, INTERVAL '1' DAY) AS bucket, " +
        "sum(_sample_interval) AS count " +
        "FROM INCIDENT_EVENTS " +
        "WHERE timestamp > NOW() - INTERVAL '168' HOUR " +
        "GROUP BY fingerprint, kind, name, bucket " +
        "ORDER BY bucket",
    );
  });

  it("counts per hour, and starts days in the site's time zone", () => {
    expect(incidentCountsSqlQuery("events", { bucket: "hour", sinceHours: 24.9 })).toContain(
      "INTERVAL '1' HOUR) AS bucket",
    );
    expect(incidentCountsSqlQuery("events", { sinceHours: 0 })).toContain("INTERVAL '1' HOUR ");
    expect(incidentCountsSqlQuery("events", { timeZone: "America/Chicago" })).toContain(
      "INTERVAL '1' DAY, 'America/Chicago') AS bucket",
    );
  });

  it("refuses a dataset or time zone that could inject SQL", () => {
    expect(() => incidentCountsSqlQuery("events; DROP")).toThrow("Invalid dataset name");
    expect(() => incidentCountsSqlQuery("events", { timeZone: "UTC') --" })).toThrow(
      "Invalid time zone",
    );
  });
});

describe("parseIncidentCountRows", () => {
  it("reads rows and skips any that don't fit", () => {
    expect(
      parseIncidentCountRows([
        {
          fingerprint: "a1",
          kind: "fetch",
          name: "TypeError",
          bucket: "2026-09-27 00:00:00",
          count: "4",
        },
        { fingerprint: "b2", kind: "nope", name: "x", bucket: "2026-09-27 00:00:00", count: 1 },
        {
          fingerprint: "c3",
          kind: "queue",
          name: "x",
          bucket: "2026-09-27 00:00:00",
          count: "many",
        },
        { kind: "queue", name: "x", bucket: "2026-09-27 00:00:00", count: 1 },
      ]),
    ).toEqual([
      {
        fingerprint: "a1",
        kind: "fetch",
        name: "TypeError",
        bucket: "2026-09-27 00:00:00",
        count: 4,
      },
    ]);
  });
});
