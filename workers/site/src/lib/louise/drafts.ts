// Draft-aware rendering helpers for the versioned page workflow. View mode always
// renders the published main row; EDIT mode renders the latest still-draft
// version's fields so an editor resumes their work-in-progress (saved to
// /api/louise/pages/:id/versions) instead of the last-published content.
// Publishing promotes a draft onto the main row. Used for both the `sections`
// surface (home) and the rich-text `body` surface ([...slug] pages).
import type { AstroCookies } from "astro";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  D1_BOOKMARK_COOKIE,
  type D1Client,
  d1Bookmark,
  db,
  openD1Session,
} from "louise-toolkit/db";
import { type DraftBufferKV, draftBufferKey, readDraftBuffer } from "louise-toolkit/editor";
import { pages, pagesVersions } from "../../schema.js";

/** The newest still-*pending* draft's full snapshot for a page, or `null` when
 *  there is none. Resume prefers the KV write-buffer (#70) when present — it
 *  holds the freshest auto-saved work, ahead of the last D1 flush, and is
 *  cleared on publish — falling back to D1. A D1 draft at or below the live
 *  `published_version_id` is superseded — publishing already moved the live row
 *  past it — so resuming it would silently revert the published content; only
 *  drafts newer than the live pointer are pending work. (A page that has never
 *  published resumes any draft.) */
async function latestDraftData(
  client: D1Client,
  pageId: number,
  kv?: DraftBufferKV,
): Promise<Record<string, unknown> | null> {
  if (kv) {
    const buffered = await readDraftBuffer(kv, draftBufferKey("pages", pageId));
    if (buffered) return buffered.data;
  }
  const database = db(client);
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

/** The newest still-draft version's `sections`, or `null` when there is none.
 *  Pass the draft-buffer KV (`env.DRAFTS`) so resume sees un-flushed edits (#70). */
export async function latestDraftSections(
  client: D1Client,
  pageId: number,
  kv?: DraftBufferKV,
): Promise<Record<string, unknown>[] | null> {
  const sections = (await latestDraftData(client, pageId, kv))?.sections;
  return Array.isArray(sections) ? (sections as Record<string, unknown>[]) : null;
}

/** The newest still-draft version's rich-text `body` HTML, or `null` when there
 *  is no pending draft (falls back to the live row's body). Pass the draft-buffer
 *  KV (`env.DRAFTS`) so resume sees un-flushed edits (#70). */
export async function latestDraftBody(
  client: D1Client,
  pageId: number,
  kv?: DraftBufferKV,
): Promise<string | null> {
  const body = (await latestDraftData(client, pageId, kv))?.body;
  return typeof body === "string" ? body : null;
}

/**
 * Open a resume-read D1 session anchored at the editor's persisted bookmark so a
 * just-auto-saved draft is read-your-writes even behind D1 read replication
 * (#69). Pass `Astro.cookies`; hand `client` to the draft helpers above, then
 * call `commit()` after the read to persist the advanced bookmark. On a
 * non-replicated D1 (or a runtime without the Sessions API) this degrades to the
 * raw binding — behaviour is unchanged. Only call this in edit mode: view-mode
 * renders stay session-free so public pages remain cacheable.
 */
export function resumeReadSession(
  DB: D1Database,
  cookies: AstroCookies,
): { client: D1Client; commit: () => void } {
  const bookmark = cookies.get(D1_BOOKMARK_COOKIE)?.value ?? null;
  const client = openD1Session(DB, bookmark ?? "first-unconstrained");
  return {
    client,
    commit() {
      const next = d1Bookmark(client);
      if (next && next !== bookmark) {
        cookies.set(D1_BOOKMARK_COOKIE, next, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          maxAge: 60 * 60 * 8,
        });
      }
    },
  };
}
