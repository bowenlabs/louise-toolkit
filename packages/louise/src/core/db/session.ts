// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/db — D1 Sessions API seam for read-your-writes across read
// replicas (#69). With D1 read replication enabled, a read can land on a replica
// that hasn't caught up to a just-committed write ("my edit vanished"). The
// Sessions API fixes that: open a session anchored at a bookmark, run queries
// through it, and every read is sequentially consistent with writes seen so far.
//
// The editor's resume read (loading the latest draft after an auto-save) is the
// path that must never go stale. Since the write (auto-save POST) and the read
// (edit-mode page load) are *separate* requests, the write's bookmark has to be
// persisted and fed back on the read — we carry it in an HttpOnly cookie so it
// round-trips automatically across a same-origin POST and the next top-level
// navigation, no client code required. Writes always target the primary, so
// this only shapes the read path.

/** A D1 binding *or* a Sessions-API session (`env.DB.withSession(...)`). Drizzle's
 *  D1 driver only ever calls `prepare`/`batch`, both of which a session
 *  implements, so either flows through {@link db} unchanged. */
export type D1Client = D1Database | D1DatabaseSession;

/** The cookie the editor persists its latest D1 bookmark in. HttpOnly — only the
 *  server-side resume read consumes it; no client script needs it. */
export const D1_BOOKMARK_COOKIE = "louise_d1_bookmark";

/**
 * Open a D1 Sessions-API session for read-your-writes across read replicas,
 * degrading to the raw binding when the runtime predates the Sessions API (or a
 * test double lacks `withSession`) — behaviour is then identical to a single,
 * un-replicated D1. Pass:
 *  - `"first-primary"` on a write path (the first query hits the primary, so the
 *    bookmark it returns reflects the write), then persist {@link d1Bookmark};
 *  - a persisted bookmark on a resume read, to anchor reads at that write;
 *  - `"first-unconstrained"` (the default) to start a read session with no
 *    bookmark yet — the first query may hit any replica.
 */
export function openD1Session(
  DB: D1Database,
  constraintOrBookmark: D1SessionConstraint | D1SessionBookmark = "first-unconstrained",
): D1Client {
  return typeof DB.withSession === "function" ? DB.withSession(constraintOrBookmark) : DB;
}

/** The latest bookmark from a client opened by {@link openD1Session}, or `null`
 *  when it's a raw binding (no session) or no query has run yet. Persist it (see
 *  {@link serializeD1BookmarkCookie}) and feed it back to {@link openD1Session}
 *  on the next request to keep reads consistent with prior writes. */
export function d1Bookmark(client: D1Client): D1SessionBookmark | null {
  return "getBookmark" in client && typeof client.getBookmark === "function"
    ? client.getBookmark()
    : null;
}

/** Read the persisted D1 bookmark from a request's `Cookie` header (the value a
 *  resume read anchors at), or `null` when absent. Framework-agnostic; an Astro
 *  page can equivalently read `Astro.cookies.get(D1_BOOKMARK_COOKIE)`. */
export function readD1Bookmark(request: Request): D1SessionBookmark | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === D1_BOOKMARK_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Serialize a `Set-Cookie` value that persists `bookmark` for the editor session
 * so the next resume read anchors at it. HttpOnly (only the server read path
 * needs it), SameSite=Lax (sent on the top-level edit-mode navigation), Secure,
 * and session-length by default. Returns `undefined` for a falsy bookmark so
 * callers can spread it without a branch.
 */
export function serializeD1BookmarkCookie(
  bookmark: D1SessionBookmark | null,
  maxAgeSeconds = 60 * 60 * 8,
): string | undefined {
  if (!bookmark) return undefined;
  return [
    `${D1_BOOKMARK_COOKIE}=${encodeURIComponent(bookmark)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}
