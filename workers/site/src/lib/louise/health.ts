// Site-health co-pilot (#106) — the cron scan that composes Louise's primitives
// into the persisted HealthSummary the Home dashboard's Health card reads.
//
// Broken-link checking is a crawl (seconds, network), so it runs on the Cron
// Trigger (worker.ts scheduled()) and its result is persisted; the alt/SEO gap
// counts are cheap D1 COUNTs computed alongside. The summary is stored in KV
// (the rate-limit namespace RL — already bound, so no new binding to provision;
// it's just a small singleton blob under a distinct key). The Health card stays
// hidden until the first scan writes one (overviewHealth reads the same key).

import { checkLinks } from "louise-toolkit/browser";
import { type HealthSummary, summarizeHealth, writeHealthSummary } from "louise-toolkit/health";
import { count } from "./overview.js";

const SITE_ORIGIN = "https://louisetoolkit.com";

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
  const [brokenLinks, missingAlt, seoGaps] = await Promise.all([
    checkLinks({ base: SITE_ORIGIN, paths: ["/"] }),
    count(env.DB, MISSING_ALT_SQL),
    count(env.DB, SEO_GAPS_SQL),
  ]);
  const summary = summarizeHealth({ brokenLinks, missingAlt, seoGaps });
  await writeHealthSummary(env.RL, summary);
  return summary;
}
