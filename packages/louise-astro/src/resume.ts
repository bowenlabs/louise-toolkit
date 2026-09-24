// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The edit-mode resume read's D1 session, over Astro's cookie API. The draft
// WRITE (auto-save) persists its D1 bookmark in the `louise_d1_bookmark` cookie;
// the page load that follows must read at or past that bookmark, or behind read
// replication the draft just saved can be missing ("my edit vanished").

import type { AstroCookies } from "astro";
import {
  D1_BOOKMARK_COOKIE,
  D1_BOOKMARK_MAX_AGE,
  type D1Client,
  d1Bookmark,
  openD1Session,
} from "louise-toolkit/db";

export interface ResumeReadSession {
  /** Pass to `resumeDraft` (or any read that must see the editor's writes). */
  client: D1Client;
  /** Persist the bookmark the reads advanced to. Call once, after them. */
  commit: () => void;
}

/**
 * Open a D1 session anchored at the editor's persisted bookmark, for the
 * edit-mode resume read. On a database without read replication — or a
 * runtime without the Sessions API — `client` is the raw binding and nothing
 * changes, so this is safe to wire before replication is on.
 *
 * Edit mode only: a view-mode render should stay session-free and cookie-free,
 * so public pages remain cacheable.
 */
export function resumeReadSession(
  DB: D1Database,
  cookies: AstroCookies,
  options: { maxAgeSeconds?: number } = {},
): ResumeReadSession {
  const bookmark = cookies.get(D1_BOOKMARK_COOKIE)?.value ?? null;
  const client = openD1Session(DB, bookmark ?? "first-unconstrained");
  return {
    client,
    commit() {
      const next = d1Bookmark(client);
      if (next && next !== bookmark) {
        // The same attributes `serializeD1BookmarkCookie` writes on the save path.
        cookies.set(D1_BOOKMARK_COOKIE, next, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          maxAge: options.maxAgeSeconds ?? D1_BOOKMARK_MAX_AGE,
        });
      }
    },
  };
}
