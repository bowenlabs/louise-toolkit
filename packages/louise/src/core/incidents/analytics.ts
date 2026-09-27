// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/incidents—counts over time, in Analytics Engine (ADR 0022).
// Re-exported from `index.ts`.
//
// The `incidents` row keeps a running total. What it can't say is whether a
// failure is happening more often this week than last, which is what the
// needs-attention list and a monthly report ask. Analytics Engine answers
// that for free: one data point per report, counted by hour or day with SQL.
// It's first-party (ADR 0016 § 3) and lives in the client's account.

import type { AnalyticsEngineLike } from "../analytics/index.js";
import type { IncidentKind, IncidentReport, IncidentSink } from "./report.js";

/**
 * The data point for one report. `index1` is the fingerprint, so sampling
 * keeps each incident's count honest; the blobs are the kind, name, path,
 * host, release, and `"critical"` or `""`; `double1` is 1.
 */
export function incidentDataPoint(report: IncidentReport): {
  indexes: string[];
  blobs: string[];
  doubles: number[];
} {
  return {
    indexes: [report.fingerprint],
    blobs: [
      report.kind,
      report.name,
      report.path ?? "",
      report.host ?? "",
      report.release ?? "",
      report.critical ? "critical" : "",
    ],
    doubles: [1],
  };
}

/**
 * A sink that writes each report to an Analytics Engine dataset, for counts
 * over time. Give it a dataset of its own rather than the one Core Web Vitals
 * use, so neither query reads the other's rows. An unprovisioned dataset
 * (`undefined`) drops the report.
 *
 * @example
 * ```ts
 * onIncident: [
 *   d1Incidents((env) => env.DB),
 *   analyticsIncidents((env) => env.INCIDENT_EVENTS),
 * ],
 * ```
 */
export function analyticsIncidents<Env>(
  dataset: (env: Env) => AnalyticsEngineLike | undefined,
): IncidentSink<Env> {
  return (report, { env }) => {
    dataset(env)?.writeDataPoint(incidentDataPoint(report));
  };
}

const SAFE_DATASET = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_TIME_ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

export interface IncidentCountQueryOptions {
  /** How far back to count, in hours. Default 168, a week. */
  sinceHours?: number;
  /** Count per `"hour"` or per `"day"`. Default `"day"`. */
  bucket?: "hour" | "day";
  /**
   * The IANA time zone a day starts in, such as the site's own. A site fact,
   * so there's no default: without it, days start at midnight UTC.
   */
  timeZone?: string;
}

/**
 * Analytics Engine SQL for how many reports each incident had, per hour or
 * per day. `sum(_sample_interval)` accounts for Analytics Engine's sampling.
 * Read the rows with {@link parseIncidentCountRows}.
 */
export function incidentCountsSqlQuery(
  dataset: string,
  options: IncidentCountQueryOptions = {},
): string {
  if (!SAFE_DATASET.test(dataset)) throw new Error(`Invalid dataset name: ${dataset}`);
  const { timeZone } = options;
  if (timeZone !== undefined && !SAFE_TIME_ZONE.test(timeZone)) {
    throw new Error(`Invalid time zone: ${timeZone}`);
  }
  const hours = Math.max(1, Math.trunc(options.sinceHours ?? 168));
  const unit = options.bucket === "hour" ? "HOUR" : "DAY";
  const zone = timeZone ? `, '${timeZone}'` : "";
  return (
    `SELECT index1 AS fingerprint, blob1 AS kind, blob2 AS name, ` +
    `toStartOfInterval(timestamp, INTERVAL '1' ${unit}${zone}) AS bucket, ` +
    `sum(_sample_interval) AS count ` +
    `FROM ${dataset} ` +
    `WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR ` +
    `GROUP BY fingerprint, kind, name, bucket ` +
    `ORDER BY bucket`
  );
}

/** One incident's count in one hour or day. */
export interface IncidentCount {
  fingerprint: string;
  kind: IncidentKind;
  name: string;
  /** The bucket's start, as Analytics Engine writes it. */
  bucket: string;
  count: number;
}

const KINDS: readonly string[] = ["fetch", "queue", "scheduled", "degraded"];

/** Read {@link incidentCountsSqlQuery} rows, skipping any that don't fit. */
export function parseIncidentCountRows(
  rows: readonly {
    fingerprint?: unknown;
    kind?: unknown;
    name?: unknown;
    bucket?: unknown;
    count?: unknown;
  }[],
): IncidentCount[] {
  const counts: IncidentCount[] = [];
  for (const row of rows) {
    const count = Number(row.count);
    if (
      typeof row.fingerprint !== "string" ||
      typeof row.kind !== "string" ||
      !KINDS.includes(row.kind) ||
      typeof row.name !== "string" ||
      typeof row.bucket !== "string" ||
      !Number.isFinite(count)
    ) {
      continue;
    }
    counts.push({
      fingerprint: row.fingerprint,
      kind: row.kind as IncidentKind,
      name: row.name,
      bucket: row.bucket,
      count,
    });
  }
  return counts;
}
