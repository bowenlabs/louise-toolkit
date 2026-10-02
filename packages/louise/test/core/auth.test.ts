import { describe, expect, it, vi } from "vitest";
import {
  activeCaptcha,
  activeCaptchaSecret,
  defaultResolveAdmins,
  getLouiseAuth,
  handleAuthRequest,
  redirectWithCookies,
  hasRole,
  isAllowedSignInEmail,
  isSameOrigin,
  type LouiseAuth,
  type LouiseAuthEnv,
  pick,
  requireEditor,
  requireEditorFromContext,
  safeNextPath,
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

  it("activeCaptcha decides the widget and the check together", async () => {
    expect(await activeCaptcha(env({ siteKey: "0xREAL", secret: "real" }))).toEqual({
      siteKey: "0xREAL",
      secret: "real",
    });
    // Each half-provisioned state is OFF for both—never a check with no
    // widget (the sign-in outage) nor a widget that gates nothing.
    for (const e of [
      env({ siteKey: "0xREAL", secret: TURNSTILE_PLACEHOLDER }),
      env({ siteKey: "0xREAL" }),
      env({ siteKey: TURNSTILE_TEST_SITE_KEY, secret: "real" }),
      env({ secret: "real" }),
    ]) {
      expect(await activeCaptcha(e)).toBeNull();
    }
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

  it("gates an instance on its own basePath, and a trailing slash, the same way", async () => {
    const calls: string[] = [];
    for (const path of ["/api/shop-auth/sign-in/magic-link", "/api/auth/sign-in/magic-link/"]) {
      const res = await handleAuthRequest(stub(calls), post(path, { email: "nope@x.com" }), [
        "owner@x.com",
      ]);
      expect(await res.json(), path).toEqual({ status: true });
    }
    expect(calls).toEqual([]);
  });

  it("delegates non-magic-link routes unconditionally", async () => {
    const calls: string[] = [];
    await handleAuthRequest(stub(calls), post("/api/auth/sign-up/email", { email: "cust@x.com" }), [
      "owner@x.com",
    ]);
    expect(calls).toEqual(["/api/auth/sign-up/email"]);
  });
});

describe("redirectWithCookies", () => {
  // What Better Auth's sign-out sets: three expiring cookies, one header each.
  const signOut = () => {
    const headers = new Headers();
    for (const name of ["session_token", "session_data", "dont_remember"]) {
      headers.append("set-cookie", `better-auth.${name}=; Max-Age=0; Path=/; HttpOnly`);
    }
    return new Response(JSON.stringify({ success: true }), { headers });
  };

  it("carries every cookie onto the redirect, one header each", () => {
    const res = redirectWithCookies(signOut(), "/");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.getSetCookie()).toEqual([
      "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly",
      "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly",
      "better-auth.dont_remember=; Max-Age=0; Path=/; HttpOnly",
    ]);
  });

  it("takes bare headers and a status, and redirects with no cookies to carry", () => {
    const res = redirectWithCookies(new Headers(), "/account", 302);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account");
    expect(res.headers.getSetCookie()).toEqual([]);
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

describe("requireEditorFromContext", () => {
  const editor = { userId: "u1", email: "a@x.com", name: "A", role: "admin" };
  // The shape an Astro APIContext presents, given App.Locals.editor.
  const ctx = (method: string, headers: Record<string, string> = {}, signedIn = true) => ({
    request: new Request("https://x.com/api/louise/pages", { method, headers }),
    locals: { editor: signedIn ? editor : null },
  });

  it("skips the origin check on a read, with no second argument", () => {
    // A same-origin fetch GET carries no Origin header, and a strict
    // Referrer-Policy removes Referer too. The sites passed `false` by hand
    // on 17 of 53 guarded calls to get this.
    expect(requireEditorFromContext(ctx("GET"))).toBeNull();
    expect(requireEditorFromContext(ctx("HEAD"))).toBeNull();
  });

  it("checks origin on every write method, with no second argument", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(requireEditorFromContext(ctx(method, { origin: "https://evil.com" }))?.status).toBe(
        403,
      );
      expect(requireEditorFromContext(ctx(method, { origin: "https://x.com" }))).toBeNull();
    }
  });

  it("still requires a signed-in editor on a read", () => {
    expect(requireEditorFromContext(ctx("GET", {}, false))?.status).toBe(401);
  });

  it("honours an explicit mutation flag over the method", () => {
    // A GET with side effects opts back in.
    expect(requireEditorFromContext(ctx("GET"), true)?.status).toBe(403);
  });
});

describe("safeNextPath", () => {
  it("keeps a same-origin path, with its query and hash", () => {
    expect(safeNextPath("/account/orders?page=2#latest", "/")).toBe(
      "/account/orders?page=2#latest",
    );
  });

  it("falls back for anything that is not a path", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "account",
      "https://evil.example",
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(raw, "/home"), String(raw)).toBe("/home");
    }
  });

  it("refuses protocol-relative and backslash forms", () => {
    for (const raw of ["//evil.example", "/\\evil.example", "\\/evil.example"]) {
      expect(safeNextPath(raw, "/home"), raw).toBe("/home");
    }
  });

  it("refuses a tab or newline that a browser would strip into //", () => {
    // A site's own regex `^\/(?![/\\])` accepted these: the second character
    // is a tab, not a slash—until the browser removes it.
    for (const raw of ["/\t/evil.example", "/\n/evil.example", "/\r\n/evil.example"]) {
      expect(safeNextPath(raw, "/home"), JSON.stringify(raw)).toBe("/home");
    }
  });

  it("returns the normalized path, never the raw string", () => {
    expect(safeNextPath("/a/../b/./c", "/")).toBe("/b/c");
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

// Better Auth initializes its adapter asynchronously on construction, so the
// stub has to be D1-shaped enough to satisfy that—otherwise the assertions
// still pass and the RUN fails, on unhandled rejections rather than on any
// assertion. Defined once and shared: it lived in two describe blocks, the copy
// silently lost `exec`, and that is exactly the failure it produces.
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
const authBase = {
  rpName: "Test Studio",
  mailFrom: { email: "hello@example.com" },
  renderMagicLinkEmail: () => ({ subject: "", html: "", text: "" }),
};

describe("api.signOut", () => {
  // Called with no cast on purpose: the typecheck covers this file, so it also
  // proves `LouiseAuth` exposes the method the `redirectWithCookies` example uses.
  it("expires the session cookies, and redirectWithCookies carries them on", async () => {
    const auth = await getLouiseAuth(authEnv, "https://example.com", authBase as never);
    const result = await auth.api.signOut({
      headers: new Headers({ cookie: "better-auth.session_token=stale" }),
      asResponse: true,
    });
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(200);
    const res = redirectWithCookies(result, "/");
    expect(res.headers.get("location")).toBe("/");
    // An https origin gets `__Secure-` cookies; sign-out expires all three.
    expect(res.headers.getSetCookie()).toEqual(
      ["session_token", "session_data", "dont_remember"].map(
        (name) =>
          `__Secure-better-auth.${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
      ),
    );
  });
});

describe("passkey rpID (#312)", () => {
  /** The passkey plugin's resolved options, as Better Auth holds them. */
  const passkeyOptions = async (baseURL: string, over: Record<string, unknown> = {}) => {
    const auth = await getLouiseAuth(authEnv, baseURL, { ...authBase, ...over } as never);
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
      ...authBase,
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

describe("magic-link allowlist in the factory", () => {
  // The route-level gate only covers routes that call handleAuthRequest. An
  // instance served straight from auth.handler (a customer portal) must not
  // mail a sign-in link to an arbitrary address either.
  const sendMagicLink = async (baseURL: string, over: Record<string, unknown> = {}) => {
    const auth = await getLouiseAuth(authEnv, baseURL, { ...authBase, ...over } as never);
    const plugins = (
      auth as unknown as {
        options: { plugins: { id?: string; options?: { sendMagicLink: Function } }[] };
      }
    ).options.plugins;
    return plugins.find((p) => p.id === "magic-link")?.options?.sendMagicLink as (data: {
      email: string;
      url: string;
      token: string;
    }) => Promise<void>;
  };

  it("sends nothing to an address off the allowlist, on any instance", async () => {
    const render = vi.fn(() => ({ subject: "", html: "", text: "" }));
    // resolveAdmins: () => [] is how a customer portal instance is configured.
    const send = await sendMagicLink("https://shop.example.com", {
      renderMagicLinkEmail: render,
      resolveAdmins: () => [],
    });
    await send({ email: "anyone@x.com", url: "https://shop.example.com/verify", token: "t" });
    expect(render).not.toHaveBeenCalled();
  });

  it("still delivers to an allowlisted editor", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const send = await sendMagicLink("http://localhost:4321", {
      resolveAdmins: () => ["Owner@X.com"],
    });
    await send({ email: "owner@x.com", url: "http://localhost:4321/verify", token: "t" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("owner@x.com"));
    log.mockRestore();
  });
});

describe("session secret", () => {
  it("fails closed on the scaffold placeholder off localhost", async () => {
    const placeholderEnv = { ...authEnv, SESSION_SECRET: TURNSTILE_PLACEHOLDER } as LouiseAuthEnv;
    await expect(
      getLouiseAuth(placeholderEnv, "https://example.com", authBase as never),
    ).rejects.toThrow(/SESSION_SECRET is not configured/);
  });

  it("falls back to the dev secret for the placeholder on localhost", async () => {
    const placeholderEnv = { ...authEnv, SESSION_SECRET: TURNSTILE_PLACEHOLDER } as LouiseAuthEnv;
    await expect(
      getLouiseAuth(placeholderEnv, "http://localhost:4321", authBase as never),
    ).resolves.toBeDefined();
  });
});

describe("kvSecondaryStorage", () => {
  // A fake KV that records writes, so the tests can assert on TTLs as well as
  // values—the TTL clamp is half of what this wrapper exists to do.
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
      // unblocked. Crossing into the next 10-second window must start over at 1.
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
      // A 10-second window under a 60-second TTL floor: the spent bucket lingers
      // unread for 60 seconds, but the key rotates every 10 seconds, so the limit
      // is still enforced over the window Better Auth asked for.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { kv, puts } = fakeKv();
      await kvSecondaryStorage(kv).increment("rl:ip", 10);
      expect(puts[0]?.ttl).toBe(60);
      vi.useRealTimers();
    });
  });
});

describe("verification storage (single-use values stay on D1)", () => {
  const kv = {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  } as unknown as SessionKV;

  const verificationOf = async (over: Record<string, unknown>) => {
    const auth = await getLouiseAuth(authEnv, "https://example.com", {
      ...authBase,
      ...over,
    } as never);
    return (
      auth as unknown as {
        options: { verification?: { modelName?: string; storeInDatabase?: boolean } };
      }
    ).options.verification;
  };

  it("keeps magic links and resets on D1 by default when KV caches sessions", async () => {
    // The security default. Better Auth requires `getAndDelete` to be atomic so
    // one of these cannot be consumed twice, and KV cannot offer that.
    expect((await verificationOf({ sessionCacheKv: kv }))?.storeInDatabase).toBe(true);
  });

  it("lets a site opt back into the KV path explicitly", async () => {
    expect(
      (await verificationOf({ sessionCacheKv: kv, verificationStorage: "secondary" }))
        ?.storeInDatabase,
    ).toBe(false);
  });

  it("says nothing about storage when there is no secondary storage to divert from", async () => {
    // Without `sessionCacheKv` these already live in D1, so emitting the option
    // would be noise. `verification` itself stays absent unless a prefix needs it.
    expect(await verificationOf({})).toBeUndefined();
    expect(await verificationOf({ verificationStorage: "secondary" })).toBeUndefined();
  });

  it("carries the table prefix alongside the storage choice", async () => {
    // Both reasons to emit `verification` at once—the namespaced-table case
    // (#15 Option B) must not drop the security default, or vice versa.
    expect(await verificationOf({ tablePrefix: "auth_", sessionCacheKv: kv })).toEqual({
      modelName: "auth_verification",
      storeInDatabase: true,
    });
    expect(await verificationOf({ tablePrefix: "auth_" })).toEqual({
      modelName: "auth_verification",
    });
  });
});

describe("Better Auth's rate limiter", () => {
  // Better Auth turns its limiter on by itself only when `NODE_ENV` is
  // `production`, which a Worker never sets, so the factory decides instead.
  const rateLimitOf = async (baseURL: string, over: Record<string, unknown> = {}) => {
    const auth = await getLouiseAuth(authEnv, baseURL, { ...authBase, ...over } as never);
    return (
      auth as unknown as {
        options: {
          rateLimit?: { enabled?: boolean; customStorage?: unknown };
          advanced?: { ipAddress?: { ipAddressHeaders?: string[] } };
        };
      }
    ).options;
  };
  /** A fake `rateLimitDo` binding that records each key and answers `allowed`. */
  const fakeDo = (allowed: boolean) => {
    const keys: string[] = [];
    const ns = {
      idFromName: (name: string) => {
        keys.push(name);
        return name;
      },
      get: () => ({
        fetch: async () =>
          Response.json(allowed ? { allowed } : { allowed, retryAfter: 42 }, { status: 200 }),
      }),
    };
    return { ns, keys };
  };
  /** Ask for a magic link through the handler, from one client address. */
  const askForLink = (
    auth: LouiseAuth,
    ip: string | null,
    headers: Record<string, string> = {},
    at = "https://example.com/api/auth",
  ) =>
    auth.handler(
      new Request(`${at}/sign-in/magic-link`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(at).origin,
          ...(ip ? { "cf-connecting-ip": ip } : {}),
          ...headers,
        },
        body: JSON.stringify({ email: "quinn@example.com" }),
      }),
    );
  /** Six link requests in a row: the sixth is over the magic-link budget. */
  const burst = async (send: () => Promise<Response>) => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await send()).status);
    return statuses;
  };

  it("is on for every instance off localhost, the editor-only one included", async () => {
    for (const over of [
      {},
      { customers: {} },
      { customers: { signIn: "password" } },
      { customers: { signIn: "magic-link" } },
    ]) {
      expect((await rateLimitOf("https://example.com", over)).rateLimit?.enabled).toBe(true);
    }
  });

  it("is off on localhost and 127.0.0.1, for customer links too", async () => {
    for (const baseURL of ["http://localhost:4321", "http://127.0.0.1:4321"]) {
      expect((await rateLimitOf(baseURL)).rateLimit?.enabled).toBe(false);
      expect(
        (await rateLimitOf(baseURL, { customers: { signIn: "magic-link" } })).rateLimit?.enabled,
      ).toBe(false);
    }
  });

  it("counts in the Durable Object when rateLimitDo is set, and nowhere else", async () => {
    const { ns, keys } = fakeDo(true);
    const get = vi.fn(async () => null);
    const kv = { get, put: async () => {}, delete: async () => {} } as unknown as SessionKV;
    const auth = await getLouiseAuth(authEnv, "https://example.com", {
      ...authBase,
      rateLimitDo: ns,
      sessionCacheKv: kv,
    } as never);
    await askForLink(auth, "192.0.2.5");
    expect(keys).toHaveLength(1);
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("192.0.2.5"));
  });

  it("counts in KV when sessionCacheKv is set and there's no Durable Object", async () => {
    const counts = new Map<string, string>();
    const kv = {
      get: async (k: string) => counts.get(k) ?? null,
      put: async (k: string, v: string) => void counts.set(k, v),
      delete: async () => {},
    } as unknown as SessionKV;
    const auth = await getLouiseAuth(authEnv, "https://example.com", {
      ...authBase,
      sessionCacheKv: kv,
    } as never);
    const statuses = await burst(() => askForLink(auth, "192.0.2.6"));
    expect(statuses[5]).toBe(429);
    expect([...counts.keys()].some((k) => k.startsWith("example.com/api/auth|192.0.2.6|"))).toBe(
      true,
    );
  });

  it("keys the count on CF-Connecting-IP, which Cloudflare sets and a client can't", async () => {
    expect(
      (await rateLimitOf("https://example.com")).advanced?.ipAddress?.ipAddressHeaders,
    ).toEqual(["cf-connecting-ip"]);
    const { ns, keys } = fakeDo(true);
    const auth = await getLouiseAuth(authEnv, "https://example.com", {
      ...authBase,
      rateLimitDo: ns,
    } as never);
    // A spoofed X-Forwarded-For, which Cloudflare would append to, is ignored.
    await askForLink(auth, "192.0.2.10", { "x-forwarded-for": "192.0.2.99, 192.0.2.10" });
    expect(keys).toEqual(["example.com/api/auth|192.0.2.10|/sign-in/magic-link"]);
  });

  it("never reads X-Forwarded-For, even with no CF-Connecting-IP", async () => {
    // Off Cloudflare, nothing sets CF-Connecting-IP, no address resolves, and
    // Better Auth puts every such request in one bucket per path. Under
    // `NODE_ENV=test` it substitutes 127.0.0.1 instead, so this pins the part
    // that holds everywhere: a header the client controls is never the key.
    const { ns, keys } = fakeDo(true);
    const auth = await getLouiseAuth(authEnv, "https://example.com", {
      ...authBase,
      rateLimitDo: ns,
    } as never);
    await askForLink(auth, null, { "x-forwarded-for": "192.0.2.98" });
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("192.0.2.98");
  });

  it("keeps the editor's count apart from a customer instance's on one address", async () => {
    // Better Auth drops `basePath` from the key, so without a scope a shop's
    // guest Wi-Fi asking for customer links would spend the owner's budget.
    const editor = await getLouiseAuth(authEnv, "https://example.com", authBase as never);
    const shop = await getLouiseAuth(authEnv, "https://example.com", {
      ...authBase,
      basePath: "/api/shop-auth",
      cookiePrefix: "shop",
      customers: { signIn: "magic-link" },
      resolveAdmins: () => [],
    } as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const customers = await burst(() =>
      askForLink(shop, "192.0.2.50", {}, "https://example.com/api/shop-auth"),
    );
    error.mockRestore();
    expect(customers[5]).toBe(429);
    expect((await askForLink(editor, "192.0.2.50")).status).not.toBe(429);
  });

  it("keeps two sites on one Worker apart", async () => {
    const a = await getLouiseAuth(authEnv, "https://example.com", authBase as never);
    const b = await getLouiseAuth(authEnv, "https://example.org", authBase as never);
    expect((await burst(() => askForLink(a, "192.0.2.60")))[5]).toBe(429);
    expect((await askForLink(b, "192.0.2.60", {}, "https://example.org/api/auth")).status).not.toBe(
      429,
    );
  });

  it("answers a 429 when the Durable Object says no", async () => {
    const { ns } = fakeDo(false);
    const auth = await getLouiseAuth(authEnv, "https://example.com", {
      ...authBase,
      rateLimitDo: ns,
    } as never);
    const res = await askForLink(auth, "192.0.2.20");
    expect(res.status).toBe(429);
    expect(res.headers.get("x-retry-after")).toBe("42");
  });

  it("answers a burst of link requests with a 429, per client, with no Durable Object", async () => {
    // Better Auth's in-memory fallback is module state, so each test uses its
    // own addresses. The magic-link plugin allows 5 sends a minute.
    const auth = await getLouiseAuth(authEnv, "https://example.com", authBase as never);
    const statuses = await burst(() => askForLink(auth, "192.0.2.30"));
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
    expect((await askForLink(auth, "192.0.2.31")).status).not.toBe(429);
  });

  it("lets a burst through on localhost", async () => {
    const auth = await getLouiseAuth(authEnv, "http://localhost:4321", authBase as never);
    for (let i = 0; i < 6; i++) {
      const res = await auth.handler(
        new Request("http://localhost:4321/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:4321",
            "cf-connecting-ip": "192.0.2.40",
          },
          body: JSON.stringify({ email: "quinn@example.com" }),
        }),
      );
      expect(res.status).not.toBe(429);
    }
  });
});

describe("customers who sign in by magic link", () => {
  const optionsOf = async (over: Record<string, unknown>) => {
    const auth = await getLouiseAuth(authEnv, "http://localhost:4321", {
      ...authBase,
      ...over,
    } as never);
    return (
      auth as unknown as {
        options: {
          emailAndPassword?: { enabled?: boolean };
          plugins: {
            id?: string;
            options?: {
              disableSignUp?: boolean;
              sendMagicLink: (
                data: { email: string; url: string; token: string },
                ctx?: unknown,
              ) => Promise<void>;
            };
          }[];
        };
      }
    ).options;
  };
  const magicOf = async (over: Record<string, unknown>) =>
    (await optionsOf(over)).plugins.find((p) => p.id === "magic-link")?.options;
  const ctxWith = (user: unknown) => ({
    context: { internalAdapter: { findUserByEmail: vi.fn(async () => (user ? { user } : null)) } },
  });

  it("turns email and password off, and leaves sign-up open by default", async () => {
    const options = await optionsOf({
      customers: { signIn: "magic-link" },
      resolveAdmins: () => [],
    });
    expect(options.emailAndPassword).toBeUndefined();
    expect((await magicOf({ customers: { signIn: "magic-link" } }))?.disableSignUp).toBeUndefined();
  });

  it("keeps email and password for the default and for an explicit password sign-in", async () => {
    expect((await optionsOf({ customers: {} })).emailAndPassword?.enabled).toBe(true);
    expect((await optionsOf({ customers: { signIn: "password" } })).emailAndPassword?.enabled).toBe(
      true,
    );
  });

  it("sends a link to any address, not only the allowlist", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const magic = await magicOf({ customers: { signIn: "magic-link" }, resolveAdmins: () => [] });
    await magic?.sendMagicLink({
      email: "kai@example.com",
      url: "http://localhost:4321/v",
      token: "t",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("kai@example.com"));
    log.mockRestore();
  });

  it("with sign-up closed, mails only an existing account and blocks sign-up at verify", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const magic = await magicOf({
      customers: { signIn: "magic-link", disableSignUp: true },
      resolveAdmins: () => [],
    });
    expect(magic?.disableSignUp).toBe(true);
    await magic?.sendMagicLink(
      { email: "nobody@example.com", url: "http://localhost:4321/v", token: "t" },
      ctxWith(null),
    );
    expect(log).not.toHaveBeenCalled();
    await magic?.sendMagicLink(
      { email: "quinn@example.com", url: "http://localhost:4321/v", token: "t" },
      ctxWith({ id: "u1", email: "quinn@example.com" }),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("quinn@example.com"));
    log.mockRestore();
  });

  it("with sign-up closed, still mails an allowlisted admin without a lookup", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const magic = await magicOf({
      customers: { signIn: "magic-link", disableSignUp: true },
      resolveAdmins: () => ["owner@example.com"],
    });
    const ctx = ctxWith(null);
    await magic?.sendMagicLink(
      { email: "owner@example.com", url: "http://localhost:4321/v", token: "t" },
      ctx,
    );
    expect(ctx.context.internalAdapter.findUserByEmail).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("owner@example.com"));
    log.mockRestore();
  });

  it("leaves a password instance's links editor-only", async () => {
    const render = vi.fn(() => ({ subject: "", html: "", text: "" }));
    const auth = await getLouiseAuth(authEnv, "https://shop.example.com", {
      ...authBase,
      customers: {},
      renderMagicLinkEmail: render,
      resolveAdmins: () => [],
    } as never);
    const magic = (
      auth as unknown as {
        options: { plugins: { id?: string; options?: { sendMagicLink: Function } }[] };
      }
    ).options.plugins.find((p) => p.id === "magic-link")?.options;
    await magic?.sendMagicLink({
      email: "kai@example.com",
      url: "https://shop.example.com/v",
      token: "t",
    });
    expect(render).not.toHaveBeenCalled();
  });
});

describe("customer magic links: background send and the captcha warning", () => {
  const instanceOf = async (env: LouiseAuthEnv, baseURL: string, over: Record<string, unknown>) =>
    (
      (await getLouiseAuth(env, baseURL, { ...authBase, ...over } as never)) as unknown as {
        options: {
          advanced?: { cookiePrefix?: string; backgroundTasks?: { handler: unknown } };
          plugins: {
            id?: string;
            options?: {
              sendMagicLink: (
                data: { email: string; url: string; token: string },
                ctx?: unknown,
              ) => Promise<void>;
            };
          }[];
        };
      }
    ).options;

  it("passes waitUntil to Better Auth's background tasks, beside the cookie prefix", async () => {
    const waitUntil = vi.fn();
    const options = await instanceOf(authEnv, "https://shop.example.com", {
      waitUntil,
      cookiePrefix: "shop",
    });
    expect(options.advanced?.backgroundTasks?.handler).toBe(waitUntil);
    expect(options.advanced?.cookiePrefix).toBe("shop");
    const bare = (await instanceOf(authEnv, "https://shop.example.com", {})).advanced;
    expect(bare?.backgroundTasks).toBeUndefined();
    expect(bare?.cookiePrefix).toBeUndefined();
  });

  it("hands the send to runInBackgroundOrAwait, so the response needn't wait for it", async () => {
    const options = await instanceOf(authEnv, "https://shop.example.com", {
      customers: { signIn: "magic-link" },
      resolveAdmins: () => [],
      renderMagicLinkEmail: () => ({ subject: "s", html: "h", text: "t" }),
    });
    const send = options.plugins.find((p) => p.id === "magic-link")?.options?.sendMagicLink;
    const runInBackgroundOrAwait = vi.fn(async (p: Promise<unknown>) => {
      await p.catch(() => {});
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await send?.(
      { email: "kai@example.com", url: "https://shop.example.com/v", token: "t" },
      { context: { runInBackgroundOrAwait } },
    );
    expect(runInBackgroundOrAwait).toHaveBeenCalledOnce();
    expect(runInBackgroundOrAwait.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
    error.mockRestore();
  });

  it("logs a degrade for each customer link sent with no captcha off localhost", async () => {
    const options = await instanceOf(authEnv, "https://shop.example.com", {
      customers: { signIn: "magic-link" },
      resolveAdmins: () => [],
      renderMagicLinkEmail: () => ({ subject: "s", html: "h", text: "t" }),
    });
    const send = options.plugins.find((p) => p.id === "magic-link")?.options?.sendMagicLink;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await send?.(
      { email: "kai@example.com", url: "https://shop.example.com/v", token: "t" },
      { context: { runInBackgroundOrAwait: async (p: Promise<unknown>) => p.catch(() => {}) } },
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining("auth.magic-link-no-captcha"));
    error.mockRestore();
  });
});

describe("schema validation", () => {
  it("turns off Better Auth's per-instance schema check, since every request builds an instance", async () => {
    const options = (
      (await getLouiseAuth(authEnv, "https://example.com", authBase as never)) as unknown as {
        options: { advanced?: { database?: { validateSchema?: boolean }; cookiePrefix?: string } };
      }
    ).options;
    expect(options.advanced?.database?.validateSchema).toBe(false);
    const prefixed = (
      (await getLouiseAuth(authEnv, "https://example.com", {
        ...authBase,
        cookiePrefix: "shop",
      } as never)) as unknown as {
        options: { advanced?: { database?: { validateSchema?: boolean }; cookiePrefix?: string } };
      }
    ).options;
    expect(prefixed.advanced?.cookiePrefix).toBe("shop");
    expect(prefixed.advanced?.database?.validateSchema).toBe(false);
  });

  it("serves a request without reading the database's schema", async () => {
    // Typed with the SQL argument the real binding takes, so the calls record it.
    const prepare = vi.fn((_sql: string) => noopD1.prepare());
    const auth = await getLouiseAuth(
      { ...authEnv, DB: { ...noopD1, prepare } as unknown as D1Database } as LouiseAuthEnv,
      "https://example.com",
      authBase as never,
    );
    await auth.api.signOut({
      headers: new Headers({ cookie: "better-auth.session_token=stale" }),
      asResponse: true,
    });
    const sql = prepare.mock.calls.map(([q]) => String(q));
    expect(sql.some((q) => /sqlite_schema|PRAGMA table_info/i.test(q))).toBe(false);
  });
});
