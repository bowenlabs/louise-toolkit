import type { AstroCookies } from "astro";
import { D1_BOOKMARK_COOKIE, D1_BOOKMARK_MAX_AGE } from "louise-toolkit/db";
import { describe, expect, it, vi } from "vitest";
import { resumeReadSession } from "../src/resume.js";

/** Just the two AstroCookies methods the bridge uses. */
function cookies(initial?: string) {
  const set = vi.fn();
  const jar = {
    get: (name: string) =>
      name === D1_BOOKMARK_COOKIE && initial !== undefined ? { value: initial } : undefined,
    set,
  } as unknown as AstroCookies;
  return { jar, set };
}

/** A D1 binding with the Sessions API; the session reports `advanceTo` once queried. */
function replicatedD1(advanceTo: string | null) {
  const withSession = vi.fn(() => ({
    prepare: vi.fn(),
    batch: vi.fn(),
    getBookmark: () => advanceTo,
  }));
  return { DB: { withSession } as unknown as D1Database, withSession };
}

describe("resumeReadSession", () => {
  it("anchors the session at the bookmark the save path persisted", () => {
    const { DB, withSession } = replicatedD1("b2");
    resumeReadSession(DB, cookies("b1").jar);
    expect(withSession).toHaveBeenCalledWith("b1");
  });

  it("starts unconstrained when there is no bookmark yet", () => {
    const { DB, withSession } = replicatedD1(null);
    resumeReadSession(DB, cookies().jar);
    expect(withSession).toHaveBeenCalledWith("first-unconstrained");
  });

  it("commit persists an advanced bookmark with the save path's cookie attributes", () => {
    const { DB } = replicatedD1("b2");
    const { jar, set } = cookies("b1");
    resumeReadSession(DB, jar).commit();
    expect(set).toHaveBeenCalledWith(D1_BOOKMARK_COOKIE, "b2", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: D1_BOOKMARK_MAX_AGE,
    });
  });

  it("commit writes nothing when the bookmark didn't move", () => {
    const { DB } = replicatedD1("b1");
    const { jar, set } = cookies("b1");
    resumeReadSession(DB, jar).commit();
    expect(set).not.toHaveBeenCalled();
  });

  it("takes the cookie lifetime as an option", () => {
    const { DB } = replicatedD1("b2");
    const { jar, set } = cookies();
    resumeReadSession(DB, jar, { maxAgeSeconds: 600 }).commit();
    expect(set.mock.calls[0]?.[2]).toMatchObject({ maxAge: 600 });
  });

  it("degrades to the raw binding without the Sessions API, and commit is a no-op", () => {
    const DB = { prepare: vi.fn() } as unknown as D1Database;
    const { jar, set } = cookies("b1");
    const session = resumeReadSession(DB, jar);
    expect(session.client).toBe(DB);
    session.commit();
    expect(set).not.toHaveBeenCalled();
  });
});
