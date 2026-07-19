import { matchRateRule } from "louise-toolkit/security";
import { describe, expect, it } from "vitest";
import type { AstroidConfig } from "../src/config.js";
import { ASTROID_PORTAL_BASE_PATH, astroidRateRules } from "../src/security/rate-rules.js";

const base: AstroidConfig = {
  key: "acme",
  archetype: "marketing",
  theme: { name: "Acme", colors: { brand: "#000000" } },
};

const names = (config: AstroidConfig) => astroidRateRules(config).map((r) => r.name);
const hit = (config: AstroidConfig, method: string, path: string) =>
  matchRateRule(astroidRateRules(config), method, path)?.name ?? null;

describe("astroidRateRules", () => {
  it("caps the editor sign-in surface on the leanest possible config", () => {
    expect(names(base)).toEqual(["magic-link", "auth"]);
    expect(hit(base, "POST", "/api/auth/sign-in/magic-link")).toBe("magic-link");
  });

  it("puts the specific magic-link rule ahead of the auth catch-all", () => {
    // First match wins, so the tighter budget has to come first — otherwise the
    // catch-all would swallow the one surface that most needs a low cap.
    const rules = astroidRateRules(base);
    const magic = rules.find((r) => r.name === "magic-link");
    expect(rules.indexOf(magic!)).toBeLessThan(rules.findIndex((r) => r.name === "auth"));
    expect(magic?.limit).toBeLessThan(rules.find((r) => r.name === "auth")!.limit);
    // Other Better Auth POSTs still land on the catch-all.
    expect(hit(base, "POST", "/api/auth/sign-out")).toBe("auth");
  });

  it("only matches POST", () => {
    expect(hit(base, "GET", "/api/auth/sign-in/magic-link")).toBeNull();
  });

  it("leaves the session-gated editor API alone", () => {
    // A limiter that can lock the owner out of their own studio is worse than
    // the abuse it stops.
    expect(hit(base, "POST", "/api/louise/pages")).toBeNull();
    // The contact form is a worker route with its own per-form limiter, and
    // worker routes are matched before Astro's middleware ever runs.
    expect(hit(base, "POST", "/api/louise/forms/inquiries")).toBeNull();
  });

  it("adds the portal credential surfaces only when a portal is enabled", () => {
    const withPortal = { ...base, portal: { enabled: true } };
    expect(hit(base, "POST", `${ASTROID_PORTAL_BASE_PATH}/sign-in/email`)).toBeNull();
    expect(hit(withPortal, "POST", `${ASTROID_PORTAL_BASE_PATH}/sign-in/email`)).toBe(
      "portal-signin",
    );
    expect(hit(withPortal, "POST", `${ASTROID_PORTAL_BASE_PATH}/request-password-reset`)).toBe(
      "portal-reset-request",
    );
  });

  it("adds checkout only when commerce is configured", () => {
    const shop: AstroidConfig = { ...base, commerce: { provider: "square" } };
    expect(hit(base, "POST", "/api/checkout")).toBeNull();
    expect(hit(shop, "POST", "/api/checkout")).toBe("checkout");
  });

  it("matches config rules before the defaults, so a budget can be overridden", () => {
    const tightened: AstroidConfig = {
      ...base,
      security: {
        rateRules: [
          {
            name: "magic-link-strict",
            method: "POST",
            match: (p) => p === "/api/auth/sign-in/magic-link",
            limit: 2,
            windowSec: 3600,
          },
        ],
      },
    };
    expect(hit(tightened, "POST", "/api/auth/sign-in/magic-link")).toBe("magic-link-strict");
    // Overriding one surface must not drop the rest of the set.
    expect(hit(tightened, "POST", "/api/auth/sign-out")).toBe("auth");
  });

  it("gives every rule a KV-legal window (KV's minimum TTL is 60s)", () => {
    const all = astroidRateRules({
      ...base,
      portal: { enabled: true },
      commerce: { provider: "square" },
    });
    for (const rule of all) {
      expect(rule.windowSec).toBeGreaterThanOrEqual(60);
      expect(rule.limit).toBeGreaterThan(0);
    }
    expect(new Set(all.map((r) => r.name)).size).toBe(all.length);
  });
});
