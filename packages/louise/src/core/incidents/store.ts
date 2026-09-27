// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/incidents—the site's D1 is the record (ADR 0022 § 4).
// Re-exported from `index.ts`.
//
// One row per fingerprint. A report adds to its row's count and moves its
// last-seen time; the reports themselves aren't kept. A row someone resolved
// reopens when its failure comes back. Watchtower reads this table through
// Cloudflare's D1 query API, so timestamps are plain epoch milliseconds a
// `SELECT` can compare without a conversion.

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import type { D1Client } from "../db/session.js";
import type { IncidentKind, IncidentReport, IncidentSink } from "./report.js";

/** The `incidents` columns, to compose into your own schema. */
export const incidentsColumns = {
  /** The grouping key from `fingerprintFailure`. */
  fingerprint: text("fingerprint").primaryKey(),
  kind: text("kind").$type<IncidentKind>().notNull(),
  name: text("name").notNull(),
  code: text("code"),
  /** The latest report's message, redacted. */
  message: text("message").notNull(),
  /** The latest report's path. */
  path: text("path"),
  /** The latest report's host. */
  host: text("host"),
  /** The latest report's release. */
  release: text("release"),
  /** Whether the latest report was marked critical. */
  critical: integer("critical", { mode: "boolean" }).notNull().default(false),
  /** How many reports this incident has had. */
  count: integer("count").notNull().default(1),
  firstSeen: integer("first_seen", { mode: "timestamp_ms" }).notNull(),
  lastSeen: integer("last_seen", { mode: "timestamp_ms" }).notNull(),
  /** When someone resolved it. `null` while it's open. */
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  /** When it last came back after being resolved. */
  reopenedAt: integer("reopened_at", { mode: "timestamp_ms" }),
};

/** The ready-made `incidents` table. Add it to the schema drizzle-kit reads,
 *  so the migration creates it. */
export const incidents = sqliteTable("incidents", incidentsColumns, (table) => [
  index("incidents_last_seen").on(table.lastSeen),
]);

export type IncidentTable = typeof incidents;

/** One incident: a row of the `incidents` table. */
export type Incident = typeof incidents.$inferSelect;

/**
 * Count one report into its incident, and return the row as it now stands.
 * The first report for a fingerprint inserts the row. A later one adds to
 * `count`, moves `lastSeen`, and takes the latest `message`, `path`, `host`,
 * `release`, and `critical`. On a resolved row it also clears `resolvedAt`
 * and sets `reopenedAt`, so a failure that comes back after a fix shows.
 */
export async function upsertIncident(
  d1: D1Client,
  report: IncidentReport,
  table: IncidentTable = incidents,
): Promise<Incident> {
  const at = new Date(report.at);
  const latest = {
    message: report.message,
    path: report.path ?? null,
    host: report.host ?? null,
    release: report.release ?? null,
    critical: report.critical,
  };
  const [row] = await db(d1)
    .insert(table)
    .values({
      fingerprint: report.fingerprint,
      kind: report.kind,
      name: report.name,
      code: report.code ?? null,
      ...latest,
      count: 1,
      firstSeen: at,
      lastSeen: at,
    })
    .onConflictDoUpdate({
      target: table.fingerprint,
      // SQLite evaluates every right-hand side against the row as it was, so
      // `reopened_at` still sees the old `resolved_at`.
      set: {
        ...latest,
        count: sql`${table.count} + 1`,
        lastSeen: sql`max(${table.lastSeen}, ${at.getTime()})`,
        resolvedAt: null,
        reopenedAt: sql`CASE WHEN ${table.resolvedAt} IS NULL THEN ${table.reopenedAt} ELSE ${at.getTime()} END`,
      },
    })
    .returning();
  return row!;
}

/** Which incidents {@link listIncidents} returns. */
export type IncidentStatus = "open" | "resolved" | "all";

export interface ListIncidentsOptions {
  /** Default `"open"`. */
  status?: IncidentStatus;
  /** Most rows to return, newest `lastSeen` first. Default 100. */
  limit?: number;
}

/** Incidents, most recently seen first. */
export async function listIncidents(
  d1: D1Client,
  options: ListIncidentsOptions = {},
  table: IncidentTable = incidents,
): Promise<Incident[]> {
  const status = options.status ?? "open";
  const where =
    status === "open"
      ? isNull(table.resolvedAt)
      : status === "resolved"
        ? isNotNull(table.resolvedAt)
        : undefined;
  return db(d1)
    .select()
    .from(table)
    .where(where)
    .orderBy(desc(table.lastSeen))
    .limit(options.limit ?? 100);
}

/** One incident by fingerprint, or `null`. */
export async function getIncident(
  d1: D1Client,
  fingerprint: string,
  table: IncidentTable = incidents,
): Promise<Incident | null> {
  const [row] = await db(d1)
    .select()
    .from(table)
    .where(eq(table.fingerprint, fingerprint))
    .limit(1);
  return row ?? null;
}

/**
 * Mark an open incident resolved. Returns the row, or `null` when there's no
 * open incident with that fingerprint. The next report for it reopens it.
 */
export async function resolveIncident(
  d1: D1Client,
  fingerprint: string,
  now: Date = new Date(),
  table: IncidentTable = incidents,
): Promise<Incident | null> {
  const [row] = await db(d1)
    .update(table)
    .set({ resolvedAt: now })
    .where(and(eq(table.fingerprint, fingerprint), isNull(table.resolvedAt)))
    .returning();
  return row ?? null;
}

/**
 * The sink that keeps the record: each report is counted into the site's
 * `incidents` table with {@link upsertIncident}. Put it first in
 * `onIncident`'s list, so the record doesn't depend on any other sink.
 *
 * @example
 * ```ts
 * export default composeWorker<Env>({
 *   fetch: ssrHandler,
 *   onIncident: [d1Incidents((env) => env.DB)],
 * });
 * ```
 */
export function d1Incidents<Env>(
  database: (env: Env) => D1Client,
  table: IncidentTable = incidents,
): IncidentSink<Env> {
  return async (report, { env }) => {
    await upsertIncident(database(env), report, table);
  };
}
