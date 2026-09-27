// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/health—the site-health co-pilot's data layer (#106). Composes
// the primitives Louise already has into one owner-facing snapshot: broken links
// (core/browser/link-check), images missing alt text, and pages with SEO gaps.
//
// Broken-link checking is a crawl (network, seconds) driven from a Cron Trigger,
// so its result must be PERSISTED for the dashboard to read cheaply; the alt/SEO
// gap counts are cheap COUNTs a site computes at scan time. `summarizeHealth`
// assembles the snapshot; `read/writeHealthSummary` persist it in KV. The
// owner-facing Health card (#108) and `overview.health` read the stored summary,
// so it stays "absent" (card hidden) until the first scan writes one.

import type { CwvSummary } from "../analytics/index.js";
import { reportDegraded } from "../degraded.js";
import { timestampAge } from "./age.js";
import type {
  BrokenLink,
  DuplicateTitleFinding,
  IndexingFinding,
  RedirectFinding,
} from "../browser/link-check.js";

/** The KV surface the health store needs—structural so the real `KVNamespace`
 *  fits without importing Workers types (mirrors `DraftBufferKV`). */
export interface HealthKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Default KV key the summary is stored under. */
export const HEALTH_KV_KEY = "louise:health:summary";

/** Cap on each list of stored details (broken links, redirects, indexing, shared
 *  titles), so the persisted blob stays small even if a crawl finds many (the
 *  counts are exact; the details are a sample for a list). */
export const MAX_BROKEN_LINK_DETAILS = 50;

/**
 * The persisted owner-facing health snapshot. The counts drive the dashboard
 * card's traffic light; `brokenLinkDetails` backs a fuller "what's broken" list.
 * Shape-compatible with `overview.health` (the extra detail field is ignored
 * there), so the overview route can return a stored summary directly.
 */
export interface HealthSummary {
  brokenLinks: number;
  missingAlt: number;
  seoGaps: number;
  /** ISO timestamp of the scan. */
  checkedAt: string;
  /** A capped sample of the broken links found, for a detail view. */
  brokenLinkDetails?: BrokenLink[];
  /** Internal links that redirect (from `crawlSite`). Absent when the scan didn't crawl. */
  redirects?: number;
  /** A capped sample, each against the page that holds the link. */
  redirectDetails?: RedirectFinding[];
  /** Crawled pages whose robots directive or canonical keeps them out of search. */
  indexing?: number;
  /** A capped sample of the indexing findings. */
  indexingDetails?: IndexingFinding[];
  /** Titles more than one crawled page shares. */
  duplicateTitles?: number;
  /** A capped sample of the shared titles and their pages. */
  duplicateTitleDetails?: DuplicateTitleFinding[];
  /** Real-visitor Core Web Vitals (#106 CWV)—present once the scan folds in a
   *  p75 snapshot from Analytics Engine; absent → the panel shows "not measured yet". */
  cwv?: CwvSummary;
  /** Schema migrations the running code needs that the database hasn't applied
   *  (`migrationStatus(…).pending` from `louise-toolkit/db`). Absent or empty
   *  when the database is up to date. Worth checking live when the summary is
   *  read, since a deploy can land between scans. */
  pendingMigrations?: string[];
}

/** The raw parts of a scan, assembled by {@link summarizeHealth}. */
export interface HealthInput {
  /** Broken links from `checkLinks`—the length is the count, a capped slice the detail. */
  brokenLinks: BrokenLink[];
  /** Count of media assets / images with no alt text. */
  missingAlt: number;
  /** Count of published, indexable pages missing an SEO title or description.
   *  Leave `noindex` pages out: they don't need either for search. */
  seoGaps: number;
  /** From `crawlSite`: internal links that redirect. Omit when the scan didn't crawl. */
  redirects?: readonly RedirectFinding[];
  /** From `crawlSite`: pages whose robots directive or canonical keeps them out of search. */
  indexing?: readonly IndexingFinding[];
  /** From `crawlSite`: titles more than one page shares. */
  duplicateTitles?: readonly DuplicateTitleFinding[];
  /** Pending schema migrations, from `migrationStatus`. Omit if the site doesn't check. */
  pendingMigrations?: readonly string[];
  /** Scan time (defaults to now)—injectable so tests are deterministic. */
  now?: Date;
}

/** Non-negative integer guard for a count (a bad input can't skew the traffic light). */
const asCount = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);

/** Assemble a {@link HealthSummary} from a scan's parts: exact counts, a capped
 *  sample of broken-link details, and the scan timestamp. */
export function summarizeHealth(input: HealthInput): HealthSummary {
  return {
    brokenLinks: input.brokenLinks.length,
    missingAlt: asCount(input.missingAlt),
    seoGaps: asCount(input.seoGaps),
    checkedAt: (input.now ?? new Date()).toISOString(),
    brokenLinkDetails: input.brokenLinks.slice(0, MAX_BROKEN_LINK_DETAILS),
    ...(input.redirects && {
      redirects: input.redirects.length,
      redirectDetails: input.redirects.slice(0, MAX_BROKEN_LINK_DETAILS),
    }),
    ...(input.indexing && {
      indexing: input.indexing.length,
      indexingDetails: input.indexing.slice(0, MAX_BROKEN_LINK_DETAILS),
    }),
    ...(input.duplicateTitles && {
      duplicateTitles: input.duplicateTitles.length,
      duplicateTitleDetails: input.duplicateTitles.slice(0, MAX_BROKEN_LINK_DETAILS),
    }),
    ...(input.pendingMigrations?.length ? { pendingMigrations: [...input.pendingMigrations] } : {}),
  };
}

/** Total number of issues in a summary—the dashboard's "N things need attention". */
export function healthIssueCount(summary: HealthSummary): number {
  return (
    summary.brokenLinks +
    summary.missingAlt +
    summary.seoGaps +
    (summary.redirects ?? 0) +
    (summary.indexing ?? 0) +
    (summary.duplicateTitles ?? 0) +
    (summary.pendingMigrations?.length ?? 0)
  );
}

/**
 * How old a scheduled job's last success can get before {@link isStale} flags it:
 * 36 hours. A daily job can run late or miss one run and still read as fresh,
 * but two missed runs in a row read as stale. Override it per site when the job
 * runs on a different schedule.
 */
export const HEALTH_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * Whether a scheduled job's last success is older than `maxAgeMs`, so a job that
 * quietly stopped running shows up instead of looking like one that ran an hour
 * ago. Pure: pass `now` for a deterministic result.
 *
 * - A missing or unparseable `timestamp` counts as stale, and so does a number
 *   outside the `Date` range. A job with no readable record of success hasn't
 *   shown that it ran, and a monitor that stays quiet about that is the failure
 *   this check exists to catch.
 * - A timestamp in the future (clock skew between the job and the reader) is
 *   age 0, so it counts as fresh.
 * - The age has to exceed `maxAgeMs`, so an age of exactly `maxAgeMs` is fresh.
 *   Pass `Infinity` to turn the check off. A `NaN` or negative threshold flags
 *   everything, so a misconfigured threshold shows up as out of date instead of
 *   hiding a job that stopped.
 *
 * `ageCheck` (the status route's check) applies this same rule.
 *
 * @param timestamp An ISO 8601 string (like `HealthSummary.checkedAt`), epoch
 *   milliseconds, or a `Date`.
 * @param maxAgeMs The largest age that still counts as fresh, in milliseconds.
 *   {@link HEALTH_STALE_AFTER_MS} suits a daily job.
 * @param now The current time. Defaults to the moment of the call.
 */
export function isStale(
  timestamp: string | number | Date | null | undefined,
  maxAgeMs: number,
  now: Date | number = Date.now(),
): boolean {
  const age = timestampAge(timestamp, now instanceof Date ? now.getTime() : now);
  // Written as "not within the limit" so a NaN limit counts as stale.
  return age === undefined || !(age <= maxAgeMs);
}

/** Persist the summary. Omit `ttlSeconds` to keep it until the next scan overwrites. */
export async function writeHealthSummary(
  kv: HealthKV,
  summary: HealthSummary,
  opts?: { key?: string; ttlSeconds?: number },
): Promise<void> {
  await kv.put(
    opts?.key ?? HEALTH_KV_KEY,
    JSON.stringify(summary),
    opts?.ttlSeconds ? { expirationTtl: opts.ttlSeconds } : undefined,
  );
}

/** Read the persisted summary, or `null` when none is stored (or it's unparseable;
 *  a corrupt blob degrades to "no data" rather than throwing). */
export async function readHealthSummary(
  kv: HealthKV,
  key = HEALTH_KV_KEY,
): Promise<HealthSummary | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HealthSummary;
  } catch (err) {
    reportDegraded("health.summary", err, { key });
    return null;
  }
}
