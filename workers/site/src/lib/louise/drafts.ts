// Draft-aware rendering helpers for the versioned page workflow. View mode always
// renders the published main row; EDIT mode renders the latest still-draft
// version's fields so an editor resumes their work-in-progress (saved to
// /api/louise/pages/:id/versions) instead of the last-published content.
// Publishing promotes a draft onto the main row. Used for both the `sections`
// surface (home) and the rich-text `body` surface ([...slug] pages).
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "louisecms/db";
import { pages, pagesVersions } from "../../schema.js";

/** The newest still-*pending* draft's full snapshot for a page, or `null` when
 *  there is none. A draft at or below the live `published_version_id` is
 *  superseded — publishing already moved the live row past it — so resuming it
 *  would silently revert the published content; only drafts newer than the live
 *  pointer are pending work. (A page that has never published resumes any draft.) */
async function latestDraftData(
  DB: D1Database,
  pageId: number,
): Promise<Record<string, unknown> | null> {
  const database = db(DB);
  const [page] = await database
    .select({ publishedVersionId: pages.publishedVersionId })
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1);
  const publishedVersionId = page?.publishedVersionId ?? null;
  const [draft] = await database
    .select()
    .from(pagesVersions)
    .where(
      and(
        eq(pagesVersions.parentId, pageId),
        eq(pagesVersions.status, "draft"),
        // Skip superseded drafts (id <= the live pointer). Omit the filter
        // entirely when nothing is published yet, so every draft counts.
        publishedVersionId === null ? undefined : gt(pagesVersions.id, publishedVersionId),
      ),
    )
    .orderBy(desc(pagesVersions.id))
    .limit(1);
  return (draft?.versionData as Record<string, unknown> | null) ?? null;
}

/** The newest still-draft version's `sections`, or `null` when there is none. */
export async function latestDraftSections(
  DB: D1Database,
  pageId: number,
): Promise<Record<string, unknown>[] | null> {
  const sections = (await latestDraftData(DB, pageId))?.sections;
  return Array.isArray(sections) ? (sections as Record<string, unknown>[]) : null;
}

/** The newest still-draft version's rich-text `body` HTML, or `null` when there
 *  is no pending draft (falls back to the live row's body). */
export async function latestDraftBody(DB: D1Database, pageId: number): Promise<string | null> {
  const body = (await latestDraftData(DB, pageId))?.body;
  return typeof body === "string" ? body : null;
}
