import { describe, expect, it } from "vitest";
// Under the node project on purpose: the CSP helper is read by build-time
// config, so importing this module must not touch `window` or `document`.
import { squareWebPaymentsCsp } from "../../src/core/commerce/square-web.js";

describe("squareWebPaymentsCsp", () => {
  it("allows both environments by default, so one build serves either", () => {
    const csp = squareWebPaymentsCsp();
    expect(csp.script).toEqual(["https://sandbox.web.squarecdn.com", "https://web.squarecdn.com"]);
    expect(csp.connect).toContain("https://pci-connect.squareupsandbox.com");
    expect(csp.connect).toContain("https://pci-connect.squareup.com");
  });

  it("narrows to one environment when asked", () => {
    const csp = squareWebPaymentsCsp({ environments: ["production"] });
    const all = Object.values(csp).flat();
    expect(all.some((o) => o.includes("sandbox"))).toBe(false);
    expect(csp.frame).toEqual(["https://web.squarecdn.com", "https://connect.squareup.com"]);
  });

  it("allows card-wrapper.css on the host page, and the fonts it loads", () => {
    // Blocking the stylesheet makes card.attach() reject (the form never
    // mounts); blocking Cash Sans was a shipped regression on a live site.
    const csp = squareWebPaymentsCsp();
    expect(csp.style).toContain("https://web.squarecdn.com");
    expect(csp.font).toContain("https://cash-f.squarecdn.com");
  });

  it("allows the SDK's own error reporting", () => {
    expect(squareWebPaymentsCsp().connect).toContain("https://o160250.ingest.sentry.io");
  });

  it("adds Google Pay only when wallets are on", () => {
    const off = Object.values(squareWebPaymentsCsp()).flat();
    expect(off.some((o) => o.includes("google"))).toBe(false);

    const on = squareWebPaymentsCsp({ wallets: true });
    expect(on.script).toContain("https://pay.google.com");
    expect(on.frame).toContain("https://pay.google.com");
    expect(on.connect).toEqual(
      expect.arrayContaining(["https://pay.google.com", "https://google.com/pay"]),
    );
    expect(on.style).toContain("https://fonts.googleapis.com");
    expect(on.font).toContain("https://fonts.gstatic.com");
  });

  it("returns fresh arrays, so a caller's push cannot leak into the next call", () => {
    squareWebPaymentsCsp().script.push("https://evil.example");
    expect(squareWebPaymentsCsp().script).not.toContain("https://evil.example");
  });

  it("never lists an origin twice within a directive", () => {
    for (const list of Object.values(squareWebPaymentsCsp({ wallets: true }))) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
