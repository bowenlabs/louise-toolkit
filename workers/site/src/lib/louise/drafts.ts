// Draft-aware rendering helper for the sections workflow. View mode always
// renders the published main row; EDIT mode renders the latest still-draft
// version's sections so an editor resumes their work-in-progress (saved via
// the sections dock → /api/louise/pages/:id/versions) instead of seeing the
// last-published content. Publishing promotes a draft onto the main row.
import { and, desc, eq } from "drizzle-orm";
import { db } from "louisecms/db";
import { pagesVersions } from "../../schema.js";

/** The newest still-draft version's `sections` for a page, or `null` when there
 *  is no pending draft. */
export async function latestDraftSections(
  DB: D1Database,
  pageId: number,
): Promise<Record<string, unknown>[] | null> {
  const [draft] = await db(DB)
    .select()
    .from(pagesVersions)
    .where(and(eq(pagesVersions.parentId, pageId), eq(pagesVersions.status, "draft")))
    .orderBy(desc(pagesVersions.id))
    .limit(1);
  const sections = (draft?.versionData as { sections?: unknown } | null)?.sections;
  return Array.isArray(sections) ? (sections as Record<string, unknown>[]) : null;
}
