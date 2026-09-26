// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the public status route (#557). Something outside
// Cloudflare needs a URL it can poll to learn whether the site works, and the
// Health panel's route is behind the editor session. This one isn't:
//   GET|HEAD /api/louise/status   (public) → 200 or 503
//     { ok: boolean, checks: { [name]: { ok: boolean, ageMs?: number } } }
//
// The site supplies the checks, because only the site knows what "working"
// means for it. The toolkit ships builders for the generic ones: D1 answers
// `SELECT 1`, and a timestamp is younger than a limit.
//
// Anyone can call it, so it's built to leak nothing and cost little: the body
// is booleans and ages, never an error's text, every check has a timeout, and
// `reuseMs` lets a burst of callers share one finished run of the checks.

import { timestampAge } from "../health/age.js";
import { isStale } from "../health/index.js";
import { LOUISE_STATUS_PATH, publicRoute } from "../worker/gate.js";
import type { WorkerRoute } from "../worker/index.js";
import { json, matchPath } from "./shared.js";

/**
 * What a check returns: `true` when it passes, or `{ ok, ageMs }` when it also
 * knows how old the thing it checked is. Anything else counts as a failure.
 */
export type StatusCheckResult = boolean | { ok: boolean; ageMs?: number | null };

/**
 * One named check. It gets the Worker `env` and a signal that aborts at the
 * route's timeout, so a check that can pass the signal on (a `fetch`) stops
 * work it no longer needs. Keep it cheap: anyone can make it run.
 */
export type StatusCheck<Env> = (
  env: Env,
  signal: AbortSignal,
) => StatusCheckResult | Promise<StatusCheckResult>;

/** One check's outcome in the response body. */
export interface StatusCheckReport {
  ok: boolean;
  /** How old the checked thing is, in milliseconds, when the check knows. */
  ageMs?: number;
}

/** The response body: `ok` is true only when every check passed. */
export interface StatusReport {
  ok: boolean;
  checks: Record<string, StatusCheckReport>;
}

/** How long a check gets before it counts as failed. */
export const STATUS_CHECK_TIMEOUT_MS = 2_000;

export interface RunStatusChecksOptions {
  /** Per-check time limit, in milliseconds. Default {@link STATUS_CHECK_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface StatusRouteConfig<Env> extends RunStatusChecksOptions {
  /**
   * The checks, by name. The names appear in the response body, so don't put
   * anything in one you wouldn't publish. With no checks, the route answers
   * 200 whenever the Worker runs.
   */
  checks: Record<string, StatusCheck<Env>>;
  /**
   * Reuse a finished run's result for this many milliseconds, within one
   * Worker isolate, so a burst of requests costs one run of the checks per
   * isolate instead of one per request. Default `0`: every request runs them.
   */
  reuseMs?: number;
  /** Mount path. Default `/api/louise/status`. */
  path?: string;
}

/** Turn whatever a check returned into a report. Never throws. */
function toReport(result: unknown): StatusCheckReport {
  if (result === true) return { ok: true };
  if (typeof result !== "object" || result === null) return { ok: false };
  const { ok, ageMs } = result as { ok?: unknown; ageMs?: unknown };
  const report: StatusCheckReport = { ok: ok === true };
  if (typeof ageMs === "number" && Number.isFinite(ageMs)) {
    report.ageMs = Math.max(0, Math.round(ageMs));
  }
  return report;
}

/** Run one check under its timeout. A throw or a timeout is a failure, logged
 *  here and never passed on to the caller. */
async function runOne<Env>(
  name: string,
  check: StatusCheck<Env>,
  env: Env,
  timeoutMs: number,
): Promise<StatusCheckReport> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => check(env, controller.signal)),
      timedOut,
    ]);
    if (result === "timeout") {
      console.warn(`[louise] status check "${name}" timed out after ${timeoutMs} ms`);
      return { ok: false };
    }
    return toReport(result);
  } catch (err) {
    console.error(`[louise] status check "${name}" failed`, err);
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run every check at once, each under its own timeout, and report the lot.
 * The route calls this; a scheduled job that wants the same answer can too.
 * Never throws: a check that throws or times out reports `{ ok: false }`, and
 * its error goes to the log.
 */
export async function runStatusChecks<Env>(
  env: Env,
  checks: Record<string, StatusCheck<Env>>,
  options: RunStatusChecksOptions = {},
): Promise<StatusReport> {
  const timeoutMs = options.timeoutMs ?? STATUS_CHECK_TIMEOUT_MS;
  const names = Object.keys(checks);
  const reports = await Promise.all(
    names.map((name) => runOne(name, checks[name] as StatusCheck<Env>, env, timeoutMs)),
  );
  const out: Record<string, StatusCheckReport> = {};
  names.forEach((name, i) => {
    out[name] = reports[i] as StatusCheckReport;
  });
  return { ok: reports.every((r) => r.ok), checks: out };
}

/**
 * Build the public status route. It answers `GET` and `HEAD` with 200 when
 * every check passes and 503 when any fails, throws, or times out, always
 * with `Cache-Control: no-store`. `HEAD` gets the status without the body.
 *
 * It's a {@link publicRoute}, so the API gate lets an anonymous probe through.
 * Returns `undefined` for a path it doesn't own, so `composeWorker` falls
 * through.
 */
export function statusRoute<Env>(config: StatusRouteConfig<Env>): WorkerRoute<Env> {
  const path = config.path ?? LOUISE_STATUS_PATH;
  const reuseMs = Math.max(0, config.reuseMs ?? 0);
  // Per route instance, so per isolate: one `env` per isolate in a Worker.
  // Only the finished report is shared, never a run in flight: a promise one
  // request started is tied to that request, and a second request awaiting
  // it can hang if the first is canceled.
  let cached: { until: number; report: StatusReport } | undefined;

  const report = async (env: Env): Promise<StatusReport> => {
    if (cached && Date.now() < cached.until) return cached.report;
    const r = await runStatusChecks(env, config.checks, config);
    // Counted from the answer, not the question.
    if (reuseMs > 0) cached = { until: Date.now() + reuseMs, report: r };
    return r;
  };

  return publicRoute(async (request, env) => {
    if (!matchPath(request, path)) return undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405, {
        allow: "GET, HEAD",
        "cache-control": "no-store",
      });
    }
    const body = await report(env);
    const status = body.ok ? 200 : 503;
    const headers = { "cache-control": "no-store" };
    if (request.method === "HEAD") return new Response(null, { status, headers });
    return json(body, status, headers);
  });
}

// ─── Ready-made checks ──────────────────────────────────────────────────────

/** The part of a D1 binding {@link d1Check} uses. `D1Database` fits. */
export interface StatusD1 {
  prepare(query: string): { first(): Promise<unknown> };
}

/**
 * A check that passes when the database answers `SELECT 1`. It reads no rows,
 * so it costs next to nothing. A missing binding fails the check.
 *
 * @example d1Check((env) => env.DB)
 */
export function d1Check<Env>(db: (env: Env) => StatusD1 | null | undefined): StatusCheck<Env> {
  return async (env) => {
    const d1 = db(env);
    if (!d1) return false;
    const row = await d1.prepare("SELECT 1 AS ok").first();
    return row !== null && row !== undefined;
  };
}

/** A point in time: an ISO string, epoch milliseconds, or a `Date`. */
export type StatusTimestamp = string | number | Date;

/**
 * A check that passes when a timestamp is no older than `maxAgeMs`, and
 * reports its age: the last health scan, a catalog snapshot, any scheduled
 * job's last success. `read` returns the timestamp, or `null` when there's
 * none yet.
 *
 * It applies {@link isStale}'s rule, so it agrees with the Health panel. A
 * missing or unparseable timestamp fails, with no age, and so does a number
 * outside the `Date` range. One in the future (clock skew) passes with an age
 * of 0, and an age of exactly `maxAgeMs` passes. Pass `Infinity` to always
 * pass. A `NaN` limit passes everything, and a negative one fails everything.
 *
 * @example ageCheck(async (env) => (await readHealthSummary(env.KV))?.checkedAt, 36 * 60 * 60 * 1000)
 */
export function ageCheck<Env>(
  read: (
    env: Env,
  ) => StatusTimestamp | null | undefined | Promise<StatusTimestamp | null | undefined>,
  maxAgeMs: number,
): StatusCheck<Env> {
  return async (env) => {
    const value = await read(env);
    const now = Date.now();
    const ageMs = timestampAge(value, now);
    if (ageMs === undefined) return { ok: false };
    return { ok: !isStale(value, maxAgeMs, now), ageMs };
  };
}
