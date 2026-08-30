import { describe, expect, it, vi } from "vitest";
import {
  activeCaptchaSecret,
  defaultResolveAdmins,
  getLouiseAuth,
  handleAuthRequest,
  hasRole,
  isAllowedSignInEmail,
  isSameOrigin,
  type LouiseAuth,
  type LouiseAuthEnv,
  pick,
  requireEditor,
  requireRole,
  resolveEditorSession,
  resolveSession,
  type SessionKV,
  turnstileSecret,
  turnstileSiteKey,
  TURNSTILE_PLACEHOLDER,
  TURNSTILE_TEST_SITE_KEY,
} from "../../src/core/auth/index.js";
import { kvSecondaryStorage } from "../../src/core/auth/auth.js";

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

describe("resolveSession (generic, ungated)", () => {
  const authWith = (user: unknown): LouiseAuth =>
    ({
      handler: async () => new Response(),
      api: { getSession: async () => (user ? { user } : null) },
    }) as unknown as LouiseAuth;
  const req = new Request("https://x.com/portal");

  it("returns any signed-in user with their role (no role gate)", async () => {
    expect(
      await resolveSession(
        authWith({ id: "u1", email: "c@x.com", name: "C", role: "customer" }),
        req,
      ),
    ).toEqual({ userId: "u1", email: "c@x.com", name: "C", role: "customer" });
  });

  it("defaults role to empty string and null on no session", async () => {
    expect(
      (await resolveSession(authWith({ id: "u2", email: "n@x.com", name: "N" }), req))?.role,
    ).toBe("");
    expect(await resolveSession(authWith(null), req)).toBeNull();
  });
});

describe("hasRole", () => {
  it("tests membership against arbitrary site-defined roles", () => {
    expect(hasRole("employee", ["employee", "manager"])).toBe(true);
    expect(hasRole("customer", ["employee", "manager"])).toBe(false);
    expect(hasRole(null, ["employee"])).toBe(false);
    expect(hasRole(undefined, [])).toBe(false);
  });
});

describe("requireRole", () => {
  const good: RequestInit = { method: "POST", headers: { origin: "https://x.com" } };
  const reqWith = (role: string | null | undefined, init: RequestInit = good) =>
    ({ request: new Request("https://x.com/api", init), role }) as const;

  it("403s a cross-origin mutation", () => {
    const bad = reqWith("employee", { method: "POST", headers: { origin: "https://evil.com" } });
    expect(requireRole(bad, ["employee"])?.status).toBe(403);
  });

  it("401s when there is no role (unauthenticated)", () => {
    expect(requireRole(reqWith(null), ["employee"])?.status).toBe(401);
  });

  it("403s a signed-in user whose role isn't allowed", () => {
    expect(requireRole(reqWith("customer"), ["employee", "manager"])?.status).toBe(403);
  });

  it("passes a same-origin request with an allowed role", () => {
    expect(requireRole(reqWith("employee"), ["employee", "manager"])).toBeNull();
  });

  it("skips the origin check for reads (mutation=false)", () => {
    const read = reqWith("customer", { method: "GET", headers: {} });
    expect(requireRole(read, ["customer"], false)).toBeNull();
  });
});

describe("pick", () => {
  it("copies only allowlisted keys", () => {
    expect(pick({ a: 1, b: 2, c: 3 }, new Set(["a", "c"]))).toEqual({ a: 1, c: 3 });
  });
});

describe("passkey rpID (#312)", () => {
  // Better Auth initializes its adapter asynchronously on construction, so the
  // stub has to be D1-shaped enough to satisfy that — otherwise the assertions
  // still pass but the run fills with unhandled rejections.
  const noopD1 = {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({}),
      }),
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({}),
    }),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  };
  const authEnv = {
    DB: noopD1 as unknown as D1Database,
    SESSION_SECRET: "s".repeat(40),
  } as unknown as LouiseAuthEnv;
  const base = {
    rpName: "Test Studio",
    mailFrom: { email: "hello@example.com" },
    renderMagicLinkEmail: () => ({ subject: "", html: "", text: "" }),
  };

  /** The passkey plugin's resolved options, as Better Auth holds them. */
  const passkeyOptions = async (baseURL: string, over: Record<string, unknown> = {}) => {
    const auth = await getLouiseAuth(authEnv, baseURL, { ...base, ...over } as never);
    const plugins = (
      auth as unknown as { options: { plugins: { id?: string; options?: unknown }[] } }
    ).options.plugins;
    return plugins.find((p) => p.id === "passkey")?.options as { rpID?: string } | undefined;
  };

  it("derives rpID from the origin by default", async () => {
    expect((await passkeyOptions("https://example.com"))?.rpID).toBe("example.com");
    expect((await passkeyOptions("https://studio.example.com"))?.rpID).toBe("studio.example.com");
  });

  it("pins an explicit rpID, so one passkey covers apex + admin subdomain", async () => {
    // Without this, the two origins mint two separate credentials for the same
    // person. Pinning both to the apex makes them one.
    const apex = await passkeyOptions("https://example.com", { rpID: "example.com" });
    const studio = await passkeyOptions("https://studio.example.com", { rpID: "example.com" });
    expect(apex?.rpID).toBe("example.com");
    expect(studio?.rpID).toBe("example.com");
  });

  it("leaves the sessions separate — a shared credential is not a shared login", async () => {
    // The pairing that makes rpID safe: host-only cookies (no Domain attribute,
    // crossSubDomainCookies off) plus a distinct cookiePrefix per instance.
    // Widening the cookie would broadcast the admin session to every sibling
    // subdomain, which is the failure this option exists to avoid.
    const auth = await getLouiseAuth(authEnv, "https://studio.example.com", {
      ...base,
      rpID: "example.com",
      cookiePrefix: "louise-studio",
    } as never);
    const options = (
      auth as unknown as {
        options: { advanced?: { cookiePrefix?: string; crossSubDomainCookies?: unknown } };
      }
    ).options;
    expect(options.advanced?.cookiePrefix).toBe("louise-studio");
    expect(options.advanced?.crossSubDomainCookies).toBeUndefined();
  });
});

describe("kvSecondaryStorage", () => {
  // A fake KV that records writes, so the tests can assert on TTLs as well as
  // values — the TTL clamp is half of what this wrapper exists to do.
  const fakeKv = () => {
    const store = new Map<string, string>();
    const puts: { key: string; value: string; ttl?: number }[] = [];
    const deletes: string[] = [];
    return {
      store,
      puts,
      deletes,
      kv: {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
          store.set(key, value);
          puts.push({ key, value, ttl: opts?.expirationTtl });
        },
        delete: async (key: string) => {
          store.delete(key);
          deletes.push(key);
        },
      } as unknown as SessionKV,
    };
  };

  describe("set", () => {
    it("clamps a sub-minimum TTL up to KV's 60s floor", async () => {
      const { kv, puts } = fakeKv();
      await kvSecondaryStorage(kv).set("k", "v", 10);
      expect(puts[0]).toMatchObject({ key: "k", value: "v", ttl: 60 });
    });

    it("passes a TTL above the floor through untouched, and omits it when absent", async () => {
      const { kv, puts } = fakeKv();
      const storage = kvSecondaryStorage(kv);
      await storage.set("k", "v", 900);
      await storage.set("k2", "v2");
      expect(puts[0]?.ttl).toBe(900);
      expect(puts[1]?.ttl).toBeUndefined();
    });
  });

  describe("getAndDelete", () => {
    it("returns the value and consumes the key", async () => {
      const { kv, store, deletes } = fakeKv();
      store.set("verification:abc", "token");
      const got = await kvSecondaryStorage(kv).getAndDelete("verification:abc");
      expect(got).toBe("token");
      expect(deletes).toEqual(["verification:abc"]);
      expect(store.has("verification:abc")).toBe(false);
    });

    it("skips the write on a miss — a replayed or expired link is the common case", async () => {
      const { kv, deletes } = fakeKv();
      expect(await kvSecondaryStorage(kv).getAndDelete("verification:gone")).toBeNull();
      expect(deletes).toEqual([]);
    });
  });

  describe("increment", () => {
    it("counts up from 1 within one window", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { kv } = fakeKv();
      const storage = kvSecondaryStorage(kv);
      expect(await storage.increment("rl:ip", 10)).toBe(1);
      expect(await storage.increment("rl:ip", 10)).toBe(2);
      expect(await storage.increment("rl:ip", 10)).toBe(3);
      vi.useRealTimers();
    });

    it("resets at the window boundary — the bucket key rotates with the clock", async () => {
      // The reason for clock buckets over one long-lived key: KV cannot write a
      // value without also writing a TTL, so a single key would have its expiry
      // pushed forward on every increment and a busy client would never be
      // unblocked. Crossing into the next 10s window must start over at 1.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:05Z"));
      const { kv } = fakeKv();
      const storage = kvSecondaryStorage(kv);
      expect(await storage.increment("rl:ip", 10)).toBe(1);
      expect(await storage.increment("rl:ip", 10)).toBe(2);
      vi.setSystemTime(new Date("2026-01-01T00:00:15Z"));
      expect(await storage.increment("rl:ip", 10)).toBe(1);
      vi.useRealTimers();
    });

    it("keeps separate keys on separate counters", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { kv } = fakeKv();
      const storage = kvSecondaryStorage(kv);
      expect(await storage.increment("rl:a", 10)).toBe(1);
      expect(await storage.increment("rl:b", 10)).toBe(1);
      expect(await storage.increment("rl:a", 10)).toBe(2);
      vi.useRealTimers();
    });

    it("clamps the bucket TTL to KV's floor without widening the window itself", async () => {
      // A 10s window under a 60s TTL floor: the spent bucket lingers unread for
      // 60s, but the key rotates every 10s, so the limit is still enforced over
      // the window Better Auth asked for.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { kv, puts } = fakeKv();
      await kvSecondaryStorage(kv).increment("rl:ip", 10);
      expect(puts[0]?.ttl).toBe(60);
      vi.useRealTimers();
    });
  });
});
