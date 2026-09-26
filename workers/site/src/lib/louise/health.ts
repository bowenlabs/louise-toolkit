// Site-health co-pilot (#106)—the cron scan that composes Louise's primitives
// into the persisted HealthSummary the Home dashboard's Health card reads.
//
// Broken-link checking is a crawl (seconds, network), so it runs on the Cron
// Trigger (worker.ts scheduled()) and its result is persisted; the alt/SEO gap
// counts are cheap D1 COUNTs computed alongside. The summary is stored in KV
// (the rate-limit namespace RL—already bound, so no new binding to provision;
// it's just a small singleton blob under a distinct key). The Health card stays
// hidden until the first scan writes one (overviewHealth reads the same key).

import { CF_ACCOUNT_ID, CF_API_TOKEN } from "astro:env/server";
import { type CwvSummary, cwvSqlQuery, parseCwvRows, summarizeCwv } from "louise-toolkit/analytics";
import { checkLinks } from "louise-toolkit/browser";
import {
  type HealthSummary,
  readHealthSummary,
  summarizeHealth,
  writeHealthSummary,
} from "louise-toolkit/health";
import { pendingMigrations, withLiveMigrations } from "./migrations.js";
import { count } from "./overview.js";

const SITE_ORIGIN = "https://louisetoolkit.com";

/** The Analytics Engine dataset the web-vitals beacon writes to (wrangler.jsonc). */
const CWV_DATASET = "louise_web_vitals";

/**
 * Read the p75 of each Core Web Vital over the last day from the Analytics Engine
 * SQL API (#106). Returns `undefined`—so the badge stays "not measured yet"—when
 * the API creds aren't set, the query fails, or there's no field data yet.
 */
async function queryCwv(): Promise<CwvSummary | undefined> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return undefined;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${CF_API_TOKEN}` },
        body: cwvSqlQuery(CWV_DATASET, 24),
      },
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      data?: { metric?: unknown; p75?: unknown; samples?: unknown }[];
    };
    const summary = summarizeCwv(parseCwvRows(body.data ?? []));
    return summary.sampleSize > 0 ? summary : undefined;
  } catch {
    return undefined;
  }
}

/** Media assets with no alt text (the accessibility default reused everywhere). */
const MISSING_ALT_SQL = "SELECT COUNT(*) AS n FROM media WHERE alt IS NULL OR alt = ''";

/** Published pages missing an SEO title or description. */
const SEO_GAPS_SQL = `SELECT COUNT(*) AS n FROM pages
   WHERE status = 'published'
     AND (seo_title IS NULL OR seo_title = '' OR seo_description IS NULL OR seo_description = '')`;

/**
 * Run the site-health scan and persist the summary: crawl the home page (which
 * links out across the site) for broken links, count images missing alt text and
 * pages with SEO gaps, then store the snapshot in KV for the dashboard to read.
 * Returns the summary (handy for logging).
 */
export async function runHealthScan(env: CloudflareEnv): Promise<HealthSummary> {
  const [brokenLinks, missingAlt, seoGaps, cwv, pending] = await Promise.all([
    checkLinks({ base: SITE_ORIGIN, paths: ["/"] }),
    count(env.DB, MISSING_ALT_SQL),
    count(env.DB, SEO_GAPS_SQL),
    queryCwv(),
    pendingMigrations(env),
  ]);
  const summary = summarizeHealth({ brokenLinks, missingAlt, seoGaps, pendingMigrations: pending });
  if (cwv) summary.cwv = cwv;
  await writeHealthSummary(env.RL, summary);
  return summary;
}

/** Read the persisted summary for the Health detail panel (#106 Phase 2), with
 *  pending migrations checked live. */
export async function readSiteHealth(env: CloudflareEnv): Promise<HealthSummary | null> {
  const summary = await readHealthSummary(env.RL);
  return summary && withLiveMigrations(summary, env);
}
