// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/health — the site-health co-pilot's data layer (#106). Composes
// the primitives Louise already has into one owner-facing snapshot: broken links
// (core/browser/link-check), images missing alt text, and pages with SEO gaps.
//
// Broken-link checking is a crawl (network, seconds) driven from a Cron Trigger,
// so its result must be PERSISTED for the dashboard to read cheaply; the alt/SEO
// gap counts are cheap COUNTs a site computes at scan time. `summarizeHealth`
// assembles the snapshot; `read/writeHealthSummary` persist it in KV. The
// owner-facing Health card (#108) and `overview.health` read the stored summary,
// so it stays "absent" (card hidden) until the first scan writes one.

import type { BrokenLink } from "../browser/link-check.js";

/** The KV surface the health store needs — structural so the real `KVNamespace`
 *  fits without importing Workers types (mirrors `DraftBufferKV`). */
export interface HealthKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Default KV key the summary is stored under. */
export const HEALTH_KV_KEY = "louise:health:summary";

/** Cap on stored broken-link details, so the persisted blob stays small even if a
 *  crawl finds many (the counts are exact; the details are a sample for a list). */
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
}

/** The raw parts of a scan, assembled by {@link summarizeHealth}. */
export interface HealthInput {
  /** Broken links from `checkLinks` — the length is the count, a capped slice the detail. */
  brokenLinks: BrokenLink[];
  /** Count of media assets / images with no alt text. */
  missingAlt: number;
  /** Count of published pages missing an SEO title or description. */
  seoGaps: number;
  /** Scan time (defaults to now) — injectable so tests are deterministic. */
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
  };
}

/** Total number of issues in a summary — the dashboard's "N things need attention". */
export function healthIssueCount(summary: HealthSummary): number {
  return summary.brokenLinks + summary.missingAlt + summary.seoGaps;
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

/** Read the persisted summary, or `null` when none is stored (or it's unparseable
 *  — a corrupt blob degrades to "no data" rather than throwing). */
export async function readHealthSummary(
  kv: HealthKV,
  key = HEALTH_KV_KEY,
): Promise<HealthSummary | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HealthSummary;
  } catch {
    return null;
  }
}
