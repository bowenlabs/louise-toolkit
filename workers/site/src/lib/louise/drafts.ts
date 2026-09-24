// The site's two draft-aware reads: which fields of a resumed draft each page
// renders. Finding the draft — KV buffer first, then the newest PENDING D1
// version — is `resumeDraft` (louise-toolkit/editor), and the read-your-writes
// session is `resumeReadSession` (@louise-toolkit/astro). Only the field shapes
// are this site's.
import type { D1Client } from "louise-toolkit/db";
import { type DraftBufferKV, resumeDraft, type ResumeDraftRow } from "louise-toolkit/editor";
import { pagesVersions } from "../../schema.js";

const deps = (bufferKv?: DraftBufferKV) => ({
  versionsTable: pagesVersions,
  collection: "pages",
  bufferKv,
});

/** The resumed draft's `sections`, or `null` when there is none. */
export async function latestDraftSections(
  client: D1Client,
  page: ResumeDraftRow,
  kv?: DraftBufferKV,
): Promise<Record<string, unknown>[] | null> {
  const sections = (await resumeDraft(client, deps(kv), page))?.sections;
  return Array.isArray(sections) ? (sections as Record<string, unknown>[]) : null;
}

/** The resumed draft's rich-text `body` HTML, or `null` when there is none. */
export async function latestDraftBody(
  client: D1Client,
  page: ResumeDraftRow,
  kv?: DraftBufferKV,
): Promise<string | null> {
  const body = (await resumeDraft(client, deps(kv), page))?.body;
  return typeof body === "string" ? body : null;
}
