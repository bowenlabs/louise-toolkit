// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the draft-aware READ. View mode renders the live row;
// edit mode must render the editor's work-in-progress instead, or reopening a
// page shows the last-published content and the next save reverts the draft.
//
// "Work-in-progress" is the same thing `applySaveDraft` layers a new save over,
// in the same order: the KV coalescing buffer when one exists (it is always
// ahead of D1), else the newest PENDING draft in the versions table. Reading
// it any other way—D1 only, or any draft rather than a pending one—shows an
// editor something other than what their next save will build on.

import { and, desc, eq, gt, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { type D1Client, db } from "../db/index.js";
import { type DraftBufferKV, draftBufferKey, readDraftBuffer } from "./draft-buffer.js";

/** The columns a `${slug}_versions` table has—see content codegen's `collectionVersionsTable`. */
type VersionsTable = SQLiteTable & {
  id: SQLiteColumn;
  parentId: SQLiteColumn;
  status: SQLiteColumn;
  versionData: SQLiteColumn;
};

export interface ResumeDraftDeps {
  /** The collection's `${slug}_versions` table. */
  versionsTable: VersionsTable;
  /** The collection slug—keys the KV buffer, as `applySaveDraft` does. */
  collection: string;
  /**
   * The draft buffer, when the site turned buffering on (`bufferKv` in
   * `SaveDraftDeps`). Pass the same namespace, or a buffered edit newer than
   * the last D1 flush is invisible here. Omit when buffering is off.
   */
  bufferKv?: DraftBufferKV;
}

/** The live row fields the read needs. */
export interface ResumeDraftRow {
  id: number;
  /** The live pointer. Drafts at or below it are superseded, not pending. */
  publishedVersionId: number | null;
}

/**
 * The editor's work-in-progress snapshot for a row, or `null` when there is
 * none (render the live row). Precedence matches `applySaveDraft`'s merge base:
 *
 *   1. the KV buffer, when `bufferKv` is given and holds one;
 *   2. the newest draft NEWER than `publishedVersionId`—an older draft is
 *      superseded work, and resuming it would silently revert the page in
 *      edit mode (the same rule as {@link latestPendingDraft}).
 *
 * `d1` may be a raw binding or a Sessions-API session. For read-your-writes
 * behind read replication, pass one opened from the editor's bookmark
 * (`openD1Session(env.DB, readD1Bookmark(request))`), so a draft saved a
 * moment ago is visible to the page load that follows it.
 *
 * Returns the whole snapshot on purpose: which fields a page renders from it
 * (`sections`, `body`, …) is the site's schema, not this function's.
 */
export async function resumeDraft(
  d1: D1Client,
  deps: ResumeDraftDeps,
  row: ResumeDraftRow,
): Promise<Record<string, unknown> | null> {
  if (deps.bufferKv) {
    const buffered = await readDraftBuffer(deps.bufferKv, draftBufferKey(deps.collection, row.id));
    if (buffered) return buffered.data;
  }
  const t = deps.versionsTable;
  const conditions: SQL[] = [eq(t.parentId, row.id), eq(t.status, "draft")];
  if (row.publishedVersionId != null) conditions.push(gt(t.id, row.publishedVersionId));
  const [draft] = await db(d1)
    .select({ versionData: t.versionData })
    .from(t)
    .where(and(...conditions))
    .orderBy(desc(t.id))
    .limit(1);
  const data = draft?.versionData;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}
