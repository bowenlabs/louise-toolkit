// Owner Home dashboard (#108) — the site's overview slice resolvers, wired into
// `overviewRoute` in worker.ts. Each returns cheap COUNTs the dashboard cards
// read in one round-trip; a resolver that throws is omitted by the route, so a
// transient D1 error degrades the card to "nothing to show" rather than erroring.
//
// Definitions match what the owner sees elsewhere:
//   • drafts       — pages not live. The public loader filters `status='published'`
//                    (published-pages.ts), so `status='draft'` is "not published".
//   • unpublished  — a live page with a saved-but-unpublished draft version
//                    (pages_versions.status='draft'), i.e. edits waiting to publish.
//   • unread inbox — inquiries are review-and-clear (the panel DELETEs handled
//                    ones), so every un-cleared row is a submission still waiting.

import type { OverviewContent, OverviewInbox } from "louise-toolkit/editor";

/** Run a `SELECT COUNT(*) AS n` and return the count (0 when the row is absent). */
async function count(db: D1Database, sql: string): Promise<number> {
  const row = await db.prepare(sql).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function overviewContent(env: CloudflareEnv): Promise<OverviewContent> {
  const drafts = await count(env.DB, "SELECT COUNT(*) AS n FROM pages WHERE status = 'draft'");
  const unpublished = await count(
    env.DB,
    `SELECT COUNT(*) AS n FROM pages p
       WHERE p.status = 'published'
         AND EXISTS (
           SELECT 1 FROM pages_versions v WHERE v.parent_id = p.id AND v.status = 'draft'
         )`,
  );
  return { drafts, unpublished };
}

export async function overviewInbox(env: CloudflareEnv): Promise<OverviewInbox> {
  return { unread: await count(env.DB, "SELECT COUNT(*) AS n FROM inquiries") };
}
