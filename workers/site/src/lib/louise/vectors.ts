// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Semantic-search sync for the `pages` collection (#86)—the Vectorize
// counterpart of the FTS `reindexDoc`. Driven off the SAME deferred reindex job
// as FTS (worker.ts `queue()`), so embed-on-publish runs off the write path.
//
// Best-effort by design: no VECTORIZE binding (or any read/embed error) leaves
// search on the FTS keyword index alone—semantic is a purely additive layer,
// never a gate. Uses the same `extractSearchText` the FTS index does, so the two
// indexes see identical page text.

import { eq } from "drizzle-orm";
import { indexContent, removeContentVector } from "louise-toolkit/ai";
import { extractSearchText } from "louise-toolkit/content";
import { db } from "louise-toolkit/db";
import { pagesCollection } from "../../pages-collection.js";
import { pages } from "../../schema.js";

/** Namespace the pages vectors under the collection slug—scopes queries and
 *  keeps ids unique if another collection ever shares the index. */
const COLLECTION = pagesCollection.slug;

/**
 * Upsert (or, when the row is gone, remove) one page's embedding in Vectorize.
 * No-op without the binding; never throws—a failure here must not retry the
 * FTS reindex it rides alongside, and must never surface on a publish.
 */
export async function syncPageVector(env: CloudflareEnv, id: number): Promise<void> {
  const index = env.VECTORIZE;
  if (!index) return; // FTS-only deployment
  try {
    const [row] = await db(env.DB).select().from(pages).where(eq(pages.id, id));
    if (!row) {
      await removeContentVector(index, COLLECTION, id);
      return;
    }
    const text = extractSearchText(pagesCollection, row as Record<string, unknown>)
      .join(" ")
      .trim();
    // An empty page has nothing to embed—drop any stale vector so a match can't
    // point at content that no longer exists.
    if (!text) {
      await removeContentVector(index, COLLECTION, id);
      return;
    }
    await indexContent(index, env.AI, COLLECTION, id, text);
  } catch (err) {
    console.error("[louise] vector sync failed", err);
  }
}
