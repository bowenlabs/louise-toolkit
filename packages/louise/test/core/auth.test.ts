import { describe, expect, it } from "vitest";
import {
  activeCaptchaSecret,
  defaultResolveAdmins,
  handleAuthRequest,
  isAllowedSignInEmail,
  isSameOrigin,
  type LouiseAuth,
  type LouiseAuthEnv,
  pick,
  requireEditor,
  resolveEditorSession,
  turnstileSecret,
  turnstileSiteKey,
  TURNSTILE_PLACEHOLDER,
  TURNSTILE_TEST_SITE_KEY,
} from "../../src/core/auth/index.js";

const env = (over: Partial<Record<string, unknown>>): LouiseAuthEnv =>
  ({
    TURNSTILE_SECRET: { get: async () => (over.secret as string) ?? TURNSTILE_PLACEHOLDER },
    TURNSTILE_SITE_KEY: over.siteKey,
    OWNER_EMAIL: over.owner,
    ENGINEER_EMAIL: over.engineer,
  }) as unknown as LouiseAuthEnv;

describe("defaultResolveAdmins", () => {
  it("returns owner + engineer, lowercased, empties dropped", () => {
    expect(defaultResolveAdmins(env({ owner: "Owner@X.com", engineer: "Eng@X.com" }))).toEqual([
      "owner@x.com",
      "eng@x.com",
    ]);
    expect(defaultResolveAdmins(env({ owner: "owner@x.com" }))).toEqual(["owner@x.com"]);
    expect(defaultResolveAdmins(env({}))).toEqual([]);
  });
});

describe("isAllowedSignInEmail", () => {
  it("is a case-insensitive membership test", () => {
    expect(isAllowedSignInEmail(["a@x.com"], "A@X.com")).toBe(true);
    expect(isAllowedSignInEmail(["a@x.com"], "b@x.com")).toBe(false);
  });
});

describe("turnstile activation", () => {
  it("only surfaces a real (non-test) site key", () => {
    expect(turnstileSiteKey(env({ siteKey: "0xREAL" }))).toBe("0xREAL");
    expect(turnstileSiteKey(env({ siteKey: TURNSTILE_TEST_SITE_KEY }))).toBeNull();
    expect(turnstileSiteKey(env({}))).toBeNull();
  });

  it("only surfaces a real (non-placeholder) secret", async () => {
    expect(await turnstileSecret(env({ secret: "real" }))).toBe("real");
    expect(await turnstileSecret(env({ secret: TURNSTILE_PLACEHOLDER }))).toBeNull();
  });

  it("activates captcha only when both halves are real", () => {
    expect(activeCaptchaSecret(env({ siteKey: "0xREAL" }), "real")).toBe("real");
    expect(activeCaptchaSecret(env({ siteKey: TURNSTILE_TEST_SITE_KEY }), "real")).toBeNull();
    expect(activeCaptchaSecret(env({ siteKey: "0xREAL" }), null)).toBeNull();
  });
});

describe("handleAuthRequest (magic-link allowlist gate)", () => {
  const stub = (calls: string[]): LouiseAuth =>
    ({
      handler: async (req: Request) => {
        calls.push(new URL(req.url).pathname);
        return new Response("delegated");
      },
      api: { getSession: async () => null },
    }) as unknown as LouiseAuth;

  const post = (path: string, body: unknown) =>
    new Request(`https://x.com${path}`, { method: "POST", body: JSON.stringify(body) });

  it("returns an enumeration-safe no-op for a non-admin magic-link request", async () => {
    const calls: string[] = [];
    const res = await handleAuthRequest(
      stub(calls),
      post("/api/auth/sign-in/magic-link", { email: "nope@x.com" }),
      ["owner@x.com"],
    );
    expect(await res.json()).toEqual({ status: true });
    expect(calls).toEqual([]); // Better Auth never ran
  });

  it("delegates a magic-link request for an allowlisted admin", async () => {
    const calls: string[] = [];
    const res = await handleAuthRequest(
      stub(calls),
      post("/api/auth/sign-in/magic-link", { email: "owner@x.com" }),
      ["owner@x.com"],
    );
    expect(await res.text()).toBe("delegated");
    expect(calls).toEqual(["/api/auth/sign-in/magic-link"]);
  });

  it("delegates non-magic-link routes unconditionally", async () => {
    const calls: string[] = [];
    await handleAuthRequest(stub(calls), post("/api/auth/sign-up/email", { email: "cust@x.com" }), [
      "owner@x.com",
    ]);
    expect(calls).toEqual(["/api/auth/sign-up/email"]);
  });
});

describe("resolveEditorSession", () => {
  const authWith = (user: unknown): LouiseAuth =>
    ({
      handler: async () => new Response(),
      api: { getSession: async () => (user ? { user } : null) },
    }) as unknown as LouiseAuth;
  const req = new Request("https://x.com/dashboard");

  it("returns the editor for an admin session", async () => {
    const editor = await resolveEditorSession(
      authWith({ id: "u1", email: "a@x.com", name: "A", role: "admin" }),
      req,
    );
    expect(editor).toEqual({ userId: "u1", email: "a@x.com", name: "A", role: "admin" });
  });

  it("returns null for a non-admin or absent session", async () => {
    expect(
      await resolveEditorSession(authWith({ id: "u2", email: "c@x.com", role: "user" }), req),
    ).toBeNull();
    expect(await resolveEditorSession(authWith(null), req)).toBeNull();
  });
});

describe("isSameOrigin", () => {
  const withHeaders = (h: Record<string, string>) =>
    new Request("https://x.com/api", { method: "POST", headers: h });

  it("accepts a matching Origin and rejects a mismatch", () => {
    expect(isSameOrigin(withHeaders({ origin: "https://x.com" }))).toBe(true);
    expect(isSameOrigin(withHeaders({ origin: "https://evil.com" }))).toBe(false);
  });

  it("falls back to Referer, and rejects when neither is present", () => {
    expect(isSameOrigin(withHeaders({ referer: "https://x.com/page" }))).toBe(true);
    expect(isSameOrigin(withHeaders({}))).toBe(false);
  });
});

describe("requireEditor", () => {
  const editor = { userId: "u1", email: "a@x.com", name: "A", role: "admin" };
  const goodReq = new Request("https://x.com/api", {
    method: "POST",
    headers: { origin: "https://x.com" },
  });

  it("403s a cross-origin mutation", () => {
    const bad = new Request("https://x.com/api", {
      method: "POST",
      headers: { origin: "https://evil.com" },
    });
    expect(requireEditor({ request: bad, editor })?.status).toBe(403);
  });

  it("401s when there is no editor", () => {
    expect(requireEditor({ request: goodReq, editor: null })?.status).toBe(401);
  });

  it("passes a same-origin editor mutation", () => {
    expect(requireEditor({ request: goodReq, editor })).toBeNull();
  });
});

describe("pick", () => {
  it("copies only allowlisted keys", () => {
    expect(pick({ a: 1, b: 2, c: 3 }, new Set(["a", "c"]))).toEqual({ a: 1, c: 3 });
  });
});
