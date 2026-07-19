import { describe, expect, it } from "vitest";
import {
  activeOrganizationId,
  DEFAULT_ORG_EDITOR_ROLES,
  invitationAcceptUrl,
  type LouiseAuth,
  resolveOrgEditor,
} from "../../src/core/auth/index.js";

// A Better Auth stub returning a fixed `getSession` payload.
const authWith = (result: unknown): LouiseAuth =>
  ({
    handler: async () => new Response(),
    api: { getSession: async () => result },
  }) as unknown as LouiseAuth;

const authUser = (user: unknown) => authWith(user ? { user } : null);

// A D1 stub whose single row is whatever `member` lookup should return, with an
// optional capture of the SQL + bound args so tests can assert the query shape.
type Db = Parameters<typeof resolveOrgEditor>[1];
const fakeDb = (
  row: { role: string | null } | null,
  cap?: { sql?: string; args?: unknown[] },
): Db =>
  ({
    prepare(sql: string) {
      if (cap) cap.sql = sql;
      return {
        bind(...args: unknown[]) {
          if (cap) cap.args = args;
          return { first: async () => row };
        },
      };
    },
  }) as unknown as Db;

const req = new Request("https://x.com/dashboard");
const user = { id: "u1", email: "a@x.com", name: "A", role: "user" };

describe("resolveOrgEditor", () => {
  it("returns an org editor session for an owner/admin member", async () => {
    const session = await resolveOrgEditor(authUser(user), fakeDb({ role: "admin" }), req, {
      organizationId: "org1",
    });
    expect(session).toEqual({
      userId: "u1",
      email: "a@x.com",
      name: "A",
      role: "admin",
      organizationId: "org1",
    });
  });

  it("defaults the editor roles to owner + admin", () => {
    expect(DEFAULT_ORG_EDITOR_ROLES).toEqual(["owner", "admin"]);
  });

  it("returns null for a plain member (non-editor role)", async () => {
    expect(
      await resolveOrgEditor(authUser(user), fakeDb({ role: "member" }), req, {
        organizationId: "org1",
      }),
    ).toBeNull();
  });

  it("returns null when the user has no membership row", async () => {
    expect(
      await resolveOrgEditor(authUser(user), fakeDb(null), req, { organizationId: "org1" }),
    ).toBeNull();
  });

  it("returns null when there is no session", async () => {
    expect(
      await resolveOrgEditor(authUser(null), fakeDb({ role: "owner" }), req, {
        organizationId: "org1",
      }),
    ).toBeNull();
  });

  it("honors a custom editorRoles allowlist", async () => {
    const session = await resolveOrgEditor(authUser(user), fakeDb({ role: "member" }), req, {
      organizationId: "org1",
      editorRoles: ["member"],
    });
    expect(session?.role).toBe("member");
  });

  it("scopes the query to the user + org and namespaces the table under tablePrefix", async () => {
    const cap: { sql?: string; args?: unknown[] } = {};
    await resolveOrgEditor(authUser(user), fakeDb({ role: "admin" }, cap), req, {
      organizationId: "org1",
      tablePrefix: "auth_",
    });
    expect(cap.sql).toContain('"auth_member"');
    expect(cap.args).toEqual(["u1", "org1"]);
  });

  it("rejects an unsafe tablePrefix before touching the DB", async () => {
    await expect(
      resolveOrgEditor(authUser(user), fakeDb({ role: "admin" }), req, {
        organizationId: "org1",
        tablePrefix: "auth_; DROP TABLE member; --",
      }),
    ).rejects.toThrow(/Invalid tablePrefix/);
  });
});

describe("invitationAcceptUrl", () => {
  it("builds an accept URL from the origin, default path, and invitation id", () => {
    expect(invitationAcceptUrl("https://x.com", "inv1")).toBe(
      "https://x.com/organization/accept-invitation?id=inv1",
    );
  });

  it("uses a custom accept path and ignores any path already on baseURL", () => {
    expect(invitationAcceptUrl("https://x.com/some/page", "inv2", "/join")).toBe(
      "https://x.com/join?id=inv2",
    );
  });

  it("falls back to the default path when given an empty string", () => {
    expect(invitationAcceptUrl("https://x.com", "inv3", "")).toBe(
      "https://x.com/organization/accept-invitation?id=inv3",
    );
  });

  it("encodes an invitation id that contains URL-special characters", () => {
    expect(invitationAcceptUrl("https://x.com", "a b&c")).toBe(
      "https://x.com/organization/accept-invitation?id=a+b%26c",
    );
  });
});

describe("activeOrganizationId", () => {
  it("reads the active organization off the session", async () => {
    const auth = authWith({ user, session: { activeOrganizationId: "org9" } });
    expect(await activeOrganizationId(auth, req)).toBe("org9");
  });

  it("returns null when there's no active org or no session", async () => {
    expect(await activeOrganizationId(authUser(user), req)).toBeNull();
    expect(await activeOrganizationId(authUser(null), req)).toBeNull();
  });
});
