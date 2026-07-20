import { describe, expect, it, vi } from "vitest";
import type { AstroidConfig } from "../src/config.js";
import { defineAstroid } from "../src/config.js";
import { AstroidConfigError } from "../src/errors.js";
import {
  ASTROID_PORTAL_COOKIE_PREFIX,
  ASTROID_PORTAL_TABLE_PREFIX,
  astroidPortal,
  astroidPortalGuardConfig,
} from "../src/portal/config.js";
import { guardResponse, matchesPrefix, portalGuard } from "../src/portal/guard.js";
import { definePortalNav } from "../src/portal/nav.js";
import { isSameOrigin, requireCustomer, resolvePortalSession } from "../src/portal/session.js";
import { generateAstroidMiddleware } from "../src/worker/generate.js";

const base: AstroidConfig = {
  key: "acme",
  archetype: "marketing",
  theme: { name: "Acme", colors: { brand: "#1f6e6d" } },
};
const withPortal = (portal: AstroidConfig["portal"]): AstroidConfig => ({ ...base, portal });

describe("portal.gated", () => {
  it("is refused at config load rather than silently wiring nothing", () => {
    // It was accepted, resolved onto ResolvedPortal, and then read by NOTHING:
    // the guard table comes from `portal.routes` and portalGuard allows any
    // unmatched path. A site setting it believed the whole site was behind a
    // login while every page outside /portal was public — and it type-checked.
    // A security control that silently does nothing is worse than none.
    expect(() => defineAstroid(withPortal({ enabled: true, gated: true }))).toThrow(
      AstroidConfigError,
    );
    expect(() => defineAstroid(withPortal({ enabled: true, gated: true }))).toThrow(
      /not implemented/i,
    );
  });

  it("still accepts a portal without it", () => {
    expect(() => defineAstroid(withPortal({ enabled: true }))).not.toThrow();
    expect(() => defineAstroid(withPortal({ enabled: true, gated: false }))).not.toThrow();
  });
});

describe("portal config", () => {
  it("is null unless explicitly enabled", () => {
    expect(astroidPortal(base)).toBeNull();
    expect(astroidPortal(withPortal({ enabled: false }))).toBeNull();
    expect(astroidPortal(withPortal({ enabled: true }))).not.toBeNull();
  });

  it("isolates the portal instance from the studio's defaults", () => {
    // The studio MUST keep Better Auth's defaults — the Louise editor client
    // hardcodes /api/auth — so the portal is the one that moves. Sharing a
    // cookie prefix means signing into one silently signs you out of the other.
    const p = astroidPortal(withPortal({ enabled: true }))!;
    expect(p.basePath).toBe("/api/portal-auth");
    expect(p.cookiePrefix).toBe(ASTROID_PORTAL_COOKIE_PREFIX);
    expect(p.cookiePrefix).not.toBe("better-auth");
    expect(p.tablePrefix).toBe(ASTROID_PORTAL_TABLE_PREFIX);
  });

  it("defaults to one customer role and a closed sign-up", () => {
    const p = astroidPortal(withPortal({ enabled: true }))!;
    expect(p.roles).toEqual(["customer"]);
    expect(p.defaultRole).toBe("customer");
    // Both consuming sites provision portal accounts by hand.
    expect(p.signUp).toBe(false);
  });

  it("takes the first declared role as the default for a new account", () => {
    const p = astroidPortal(withPortal({ enabled: true, roles: ["member", "manager"] }))!;
    expect(p.defaultRole).toBe("member");
  });

  it("guards the account area by default", () => {
    const guard = astroidPortalGuardConfig(withPortal({ enabled: true }))!;
    expect(guard.routes.map((r) => r.prefix)).toEqual(["/portal", "/api/portal"]);
    expect(astroidPortalGuardConfig(base)).toBeNull();
  });
});

describe("matchesPrefix", () => {
  it("matches on a segment boundary, not a string prefix", () => {
    expect(matchesPrefix("/portal", "/portal")).toBe(true);
    expect(matchesPrefix("/portal/orders", "/portal")).toBe(true);
    // The bug this prevents: /portalling is a different, PUBLIC route.
    expect(matchesPrefix("/portalling", "/portal")).toBe(false);
    expect(matchesPrefix("/portal-public", "/portal")).toBe(false);
  });
});

describe("portalGuard", () => {
  const config = {
    routes: [
      { prefix: "/portal", roles: ["customer", "manager"] },
      { prefix: "/api/portal", roles: ["customer", "manager"] },
      { prefix: "/admin", roles: ["manager"] },
      { prefix: "/api/admin", roles: ["manager"] },
    ],
    home: (role: string) => (role === "manager" ? "/admin" : "/portal"),
  };

  it("lets an unguarded path through", () => {
    expect(portalGuard("/", null, config)).toBeNull();
    expect(portalGuard("/shop", null, config)).toBeNull();
  });

  it("redirects a signed-out visitor to login, carrying where they were going", () => {
    expect(portalGuard("/portal/orders", null, config)).toEqual({
      kind: "redirect",
      location: "/login?next=%2Fportal%2Forders",
    });
  });

  it("answers 401 JSON for an API route, never a redirect", () => {
    // Redirecting fetch() to an HTML login page returns 200 and markup, which
    // client code reads as success and then fails somewhere far less obvious.
    expect(portalGuard("/api/portal/orders", null, config)).toEqual({
      kind: "json",
      status: 401,
      body: { ok: false, error: "Unauthorized" },
    });
  });

  it("lets an allowed role through", () => {
    expect(portalGuard("/portal", { role: "customer" }, config)).toBeNull();
    expect(portalGuard("/admin", { role: "manager" }, config)).toBeNull();
  });

  it("bounces a wrong-door user to their OWN area, not back to login", () => {
    // Sending them to /login would say "your credentials failed" about
    // credentials that worked perfectly well.
    expect(portalGuard("/admin", { role: "customer" }, config)).toEqual({
      kind: "redirect",
      location: "/portal",
    });
    expect(portalGuard("/api/admin", { role: "customer" }, config)).toEqual({
      kind: "json",
      status: 403,
      body: { ok: false, error: "Forbidden" },
    });
  });

  it("treats a rule with no roles as any-signed-in-user", () => {
    const open = { routes: [{ prefix: "/portal" }] };
    expect(portalGuard("/portal", { role: "anything" }, open)).toBeNull();
    expect(portalGuard("/portal", null, open)).toMatchObject({ kind: "redirect" });
  });

  it("takes the FIRST matching rule, so order is the override mechanism", () => {
    const ordered = {
      routes: [
        { prefix: "/portal/public", roles: [] },
        { prefix: "/portal", roles: ["customer"] },
      ],
    };
    expect(portalGuard("/portal/public", { role: "stranger" }, ordered)).toBeNull();
    expect(portalGuard("/portal/orders", { role: "stranger" }, ordered)).toMatchObject({
      kind: "redirect",
    });
  });

  it("renders a JSON decision as a real Response", async () => {
    const res = guardResponse({
      kind: "json",
      status: 403,
      body: { ok: false, error: "Forbidden" },
    });
    expect(res?.status).toBe(403);
    expect(res?.headers.get("content-type")).toBe("application/json");
    expect(await res?.json()).toEqual({ ok: false, error: "Forbidden" });
    // A redirect is the caller's job (Astro builds those with its own base path).
    expect(guardResponse({ kind: "redirect", location: "/portal" })).toBeNull();
  });
});

describe("resolvePortalSession", () => {
  it("resolves once per request, however many callers ask", async () => {
    // The middleware needs it to gate, the handler needs it to know who's
    // asking — two D1 round-trips per authenticated request otherwise.
    const request = new Request("https://acme.test/portal");
    const resolve = vi.fn(async () => ({ role: "customer" }));
    const [a, b] = await Promise.all([
      resolvePortalSession(request, resolve),
      resolvePortalSession(request, resolve),
    ]);
    expect(resolve).toHaveBeenCalledOnce();
    expect(a).toBe(b);
  });

  it("keys on the request, so a different request resolves again", async () => {
    const resolve = vi.fn(async () => null);
    await resolvePortalSession(new Request("https://acme.test/a"), resolve);
    await resolvePortalSession(new Request("https://acme.test/b"), resolve);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("degrades a failed lookup to signed-out instead of throwing", async () => {
    // Missing bindings under plain `astro preview` shouldn't 500 a public page.
    const request = new Request("https://acme.test/");
    await expect(
      resolvePortalSession(request, async () => {
        throw new Error("no DB");
      }),
    ).resolves.toBeNull();
  });
});

describe("isSameOrigin", () => {
  const url = "https://acme.test/api/portal/order";
  it("accepts a matching Origin and rejects a foreign one", () => {
    expect(
      isSameOrigin(new Request(url, { method: "POST", headers: { origin: "https://acme.test" } })),
    ).toBe(true);
    expect(
      isSameOrigin(new Request(url, { method: "POST", headers: { origin: "https://evil.test" } })),
    ).toBe(false);
  });

  it("falls back to Referer, then allows when neither is present", () => {
    expect(
      isSameOrigin(
        new Request(url, { method: "POST", headers: { referer: "https://evil.test/x" } }),
      ),
    ).toBe(false);
    // A browser always sends Origin on a cross-origin mutation, so its absence
    // means same-origin or a non-browser caller.
    expect(isSameOrigin(new Request(url, { method: "POST" }))).toBe(true);
  });
});

describe("requireCustomer", () => {
  const signedIn = async () => ({ role: "customer" });
  const post = (headers: Record<string, string> = {}) =>
    new Request("https://acme.test/api/portal/order", { method: "POST", headers });

  it("passes a signed-in same-origin mutation", async () => {
    const res = await requireCustomer(post({ origin: "https://acme.test" }), signedIn);
    expect(res).toMatchObject({ ok: true, user: { role: "customer" } });
  });

  it("refuses a cross-origin mutation BEFORE looking up the session", async () => {
    // The cookie proves identity; the origin check proves intent. A browser
    // attaches the cookie to a request a third-party page triggered too.
    const resolve = vi.fn(signedIn);
    const res = await requireCustomer(post({ origin: "https://evil.test" }), resolve);
    expect(res.ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("answers 401 when signed out", async () => {
    const res = await requireCustomer(post({ origin: "https://acme.test" }), async () => null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("narrows by role", async () => {
    const res = await requireCustomer(post({ origin: "https://acme.test" }), signedIn, {
      roles: ["manager"],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("skips the origin check on a read", async () => {
    const get = new Request("https://acme.test/api/portal/orders");
    expect(await requireCustomer(get, signedIn)).toMatchObject({ ok: true });
  });
});

describe("definePortalNav", () => {
  const nav = definePortalNav([
    { label: "Overview", href: "/portal" },
    { label: "Orders", href: "/portal/orders" },
    { label: "Team", href: "/admin/team", roles: ["manager"] },
  ]);

  it("hides items a role can't reach, rather than rendering a 403 link", () => {
    expect(nav.forRole("customer").map((i) => i.label)).toEqual(["Overview", "Orders"]);
    expect(nav.forRole("manager").map((i) => i.label)).toEqual(["Overview", "Orders", "Team"]);
    expect(nav.forRole(null).map((i) => i.label)).toEqual(["Overview", "Orders"]);
  });

  it("picks the most specific active item, not the first match", () => {
    // Both /portal and /portal/orders match the orders page; the parent would
    // otherwise always win and the highlight would never move.
    expect(nav.activeFor("/portal/orders")?.label).toBe("Orders");
    expect(nav.activeFor("/portal")?.label).toBe("Overview");
    expect(nav.activeFor("/shop")).toBeNull();
  });
});

describe("generated middleware", () => {
  it("has no portal wiring when there's no portal", () => {
    const out = generateAstroidMiddleware(base);
    expect(out).not.toContain("portalGuard");
    expect(out).not.toContain("resolvePortalSession");
  });

  it("resolves the portal session in `extend`, then guards", () => {
    const out = generateAstroidMiddleware(withPortal({ enabled: true }));
    expect(out).toContain("resolvePortalSession(context.request, resolvePortalUser)");
    expect(out).toContain("context.locals.portalUser = user;");
    expect(out).toContain("portalGuard(");
    // Sessions must be resolved before anything is authorized against them.
    expect(out.indexOf("extend:")).toBeLessThan(out.indexOf("guard:"));
  });
});
