import { describe, expect, it } from "vitest";
import {
  D1_BOOKMARK_COOKIE,
  d1Bookmark,
  openD1Session,
  readD1Bookmark,
  serializeD1BookmarkCookie,
} from "../../src/core/db/session.js";

/** A D1 binding whose `withSession` returns a session that echoes a fixed
 *  bookmark — the minimum the Sessions-API seam touches. */
function makeSessioned(bookmark: string | null = "bk-1"): D1Database {
  const session = {
    prepare: () => ({}) as never,
    batch: async () => [],
    getBookmark: () => bookmark,
  } as unknown as D1DatabaseSession;
  return { withSession: () => session } as unknown as D1Database;
}

describe("openD1Session / d1Bookmark", () => {
  it("opens a session and reads its bookmark when withSession exists", () => {
    const client = openD1Session(makeSessioned("bk-42"), "first-primary");
    expect(d1Bookmark(client)).toBe("bk-42");
  });

  it("degrades to the raw binding when the runtime has no Sessions API", () => {
    // A test double / older runtime without `withSession` — behaviour is then
    // identical to a single, un-replicated D1.
    const raw = { prepare: () => ({}) } as unknown as D1Database;
    const client = openD1Session(raw);
    expect(client).toBe(raw);
    expect(d1Bookmark(client)).toBeNull();
  });

  it("d1Bookmark is null when the session has run no query yet", () => {
    expect(d1Bookmark(openD1Session(makeSessioned(null)))).toBeNull();
  });
});

describe("readD1Bookmark", () => {
  const req = (cookie?: string) =>
    new Request("https://x.test/", cookie ? { headers: { cookie } } : undefined);

  it("returns null with no cookie header and when the cookie is absent", () => {
    expect(readD1Bookmark(req())).toBeNull();
    expect(readD1Bookmark(req("other=1; foo=bar"))).toBeNull();
  });

  it("parses the bookmark from among other cookies and url-decodes it", () => {
    const value = "0000000a-0000000b";
    const header = `sid=abc; ${D1_BOOKMARK_COOKIE}=${encodeURIComponent(value)}; theme=dark`;
    expect(readD1Bookmark(req(header))).toBe(value);
  });
});

describe("serializeD1BookmarkCookie", () => {
  it("returns undefined for a falsy bookmark so callers can spread it", () => {
    expect(serializeD1BookmarkCookie(null)).toBeUndefined();
    expect(serializeD1BookmarkCookie("")).toBeUndefined();
  });

  it("emits an HttpOnly, Lax, Secure, path-scoped cookie that round-trips", () => {
    const cookie = serializeD1BookmarkCookie("bk-7", 120);
    expect(cookie).toContain(`${D1_BOOKMARK_COOKIE}=bk-7`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=120");
    // The Set-Cookie value round-trips back through the reader.
    const value = cookie?.split(";")[0].split("=").slice(1).join("=") ?? "";
    expect(
      readD1Bookmark(
        new Request("https://x.test/", {
          headers: { cookie: `${D1_BOOKMARK_COOKIE}=${value}` },
        }),
      ),
    ).toBe("bk-7");
  });
});
