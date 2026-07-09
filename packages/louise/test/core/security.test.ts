import { describe, expect, it } from "vitest";
import {
  getSessionSecret,
  louiseSecurityHeaders,
  matchRateRule,
  rateLimit,
  rewriteCspStyleSrc,
  sanitizeRichHtml,
  type KVLike,
  type RateRule,
} from "../../src/core/security/index.js";

describe("sanitizeRichHtml", () => {
  it("drops disallowed elements with their contents", () => {
    const out = sanitizeRichHtml("<div><p>ok</p><script>alert(1)</script></div>");
    expect(out).toContain("<p>ok</p>");
    expect(out).not.toMatch(/script|alert/i);
  });

  it("strips event handlers and unsafe url schemes but keeps safe formatting", () => {
    const out = sanitizeRichHtml(
      '<p onclick="x()">hi <strong>b</strong> ' +
        '<a href="javascript:alert(1)">x</a> <a href="https://ok.com">ok</a></p>',
    );
    expect(out).not.toMatch(/onclick|javascript:/i);
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain('href="https://ok.com"');
  });

  it("keeps only allowed image attributes", () => {
    const out = sanitizeRichHtml('<p><img src="https://i/x.png" width="10" onerror="y()"></p>');
    expect(out).toContain('width="10"');
    expect(out).not.toMatch(/onerror/i);
  });

  it("keeps only pb-* class tokens on block containers", () => {
    const out = sanitizeRichHtml(
      '<section class="pb-grid btn-solid" data-block="grid">x</section>',
    );
    expect(out).toContain('class="pb-grid"');
    expect(out).not.toContain("btn-solid");
  });

  it("round-trips an adjustable grid row + columns", () => {
    const out = sanitizeRichHtml(
      '<div data-block="row" class="pb-row" style="grid-template-columns: 6fr 4fr">' +
        '<div data-block="col" class="pb-col"><p>a</p></div>' +
        '<div data-block="col" class="pb-col"><p>b</p></div>' +
        "</div>",
    );
    expect(out).toContain('data-block="row"');
    expect(out).toContain('class="pb-row"');
    expect(out).toContain("grid-template-columns: 6fr 4fr");
    expect(out).toContain('data-block="col"');
    expect(out).toContain("<p>a</p>");
  });

  it("allows a validated grid-template-columns but strips any other style", () => {
    // percentages ok
    expect(sanitizeRichHtml('<div style="grid-template-columns: 33% 33% 34%"></div>')).toContain(
      "grid-template-columns: 33% 33% 34%",
    );
    // arbitrary declarations dropped
    expect(sanitizeRichHtml('<div style="background: red"></div>')).not.toContain("background");
    // no url()/functions
    expect(
      sanitizeRichHtml('<div style="grid-template-columns: url(javascript:alert(1))"></div>'),
    ).not.toMatch(/url|javascript/i);
    // no ;-chaining a second declaration onto a valid one
    expect(
      sanitizeRichHtml('<div style="grid-template-columns: 1fr 1fr; background: red"></div>'),
    ).not.toContain("background");
  });

  it("round-trips a button block (div wrapper keeps class, anchor keeps href)", () => {
    const out = sanitizeRichHtml(
      '<div data-block="button" class="pb-button"><a href="https://x.com">Go</a></div>',
    );
    expect(out).toContain('data-block="button"');
    expect(out).toContain('class="pb-button"');
    expect(out).toContain('href="https://x.com"');
    expect(out).toContain(">Go</a>");
  });

  it("keeps the gallery block's data-cols", () => {
    const out = sanitizeRichHtml(
      '<section data-block="grid" class="pb-grid" data-cols="4">x</section>',
    );
    expect(out).toContain('data-cols="4"');
    expect(out).toContain('class="pb-grid"');
  });

  describe("media-strictness (mediaBase)", () => {
    it("keeps an image served from the media base", () => {
      const out = sanitizeRichHtml('<p><img src="/media/web/x.png" alt="ok"></p>', {
        mediaBase: "/media",
      });
      expect(out).toContain('src="/media/web/x.png"');
    });

    it("drops an external (hotlinked) image entirely, keeping surrounding content", () => {
      const out = sanitizeRichHtml(
        '<p>before<img src="https://evil.example/x.png" alt="hot">after</p>',
        { mediaBase: "/media" },
      );
      expect(out).not.toContain("evil.example");
      expect(out).not.toContain("<img");
      expect(out).toContain("before");
      expect(out).toContain("after");
    });

    it("drops a URL that merely contains the base but isn't served from it", () => {
      const out = sanitizeRichHtml('<p><img src="https://evil.example/media/x.png"></p>', {
        mediaBase: "/media",
      });
      expect(out).not.toContain("<img");
    });

    it("leaves any safe img src when no mediaBase is given (back-compat)", () => {
      const out = sanitizeRichHtml('<p><img src="https://cdn.example/x.png" width="10"></p>');
      expect(out).toContain('src="https://cdn.example/x.png"');
      expect(out).toContain("<img");
    });
  });
});

describe("rateLimit", () => {
  const makeKv = (): KVLike => {
    const store = new Map<string, string>();
    return {
      async get(k) {
        return store.get(k) ?? null;
      },
      async put(k, v) {
        store.set(k, v);
      },
    };
  };

  it("allows under the limit and blocks once reached", async () => {
    const kv = makeKv();
    expect((await rateLimit(kv, "ip", 2, 60)).ok).toBe(true);
    expect((await rateLimit(kv, "ip", 2, 60)).ok).toBe(true);
    expect((await rateLimit(kv, "ip", 2, 60)).ok).toBe(false);
  });

  it("fails open on any KV error", async () => {
    const boom: KVLike = {
      async get() {
        throw new Error("kv down");
      },
      async put() {
        throw new Error("kv down");
      },
    };
    expect((await rateLimit(boom, "ip", 1, 60)).ok).toBe(true);
  });
});

describe("matchRateRule", () => {
  const rules: RateRule[] = [
    {
      name: "magic-link",
      method: "POST",
      match: (p) => p === "/api/auth/sign-in/magic-link",
      limit: 5,
      windowSec: 600,
    },
  ];

  it("matches on method + path from the caller-supplied rules", () => {
    expect(matchRateRule(rules, "POST", "/api/auth/sign-in/magic-link")?.name).toBe("magic-link");
    expect(matchRateRule(rules, "GET", "/api/auth/sign-in/magic-link")).toBeNull();
    expect(matchRateRule(rules, "POST", "/other")).toBeNull();
  });
});

describe("getSessionSecret", () => {
  const ok = { get: async () => "real-secret" };
  const boom = {
    get: async () => {
      throw new Error("no store");
    },
  };

  it("returns the stored secret", async () => {
    expect(await getSessionSecret(ok, new URL("https://x.com"))).toBe("real-secret");
  });

  it("falls back to the dev secret on localhost only", async () => {
    expect(await getSessionSecret(boom, new URL("http://localhost:4321"))).toBe(
      "louise-dev-secret",
    );
    expect(await getSessionSecret(boom, new URL("http://127.0.0.1:4321"), "custom-dev")).toBe(
      "custom-dev",
    );
  });

  it("fails closed (re-throws) on a deployed host", async () => {
    await expect(getSessionSecret(boom, new URL("https://prod.com"))).rejects.toThrow();
  });

  it("treats an empty stored secret as a failure (fails closed on a deployed host)", async () => {
    const empty = { get: async () => "" };
    await expect(getSessionSecret(empty, new URL("https://prod.com"))).rejects.toThrow();
    // …but still usable in dev via the fallback.
    expect(await getSessionSecret(empty, new URL("http://localhost:4321"))).toBe(
      "louise-dev-secret",
    );
  });
});

describe("louiseSecurityHeaders", () => {
  it("sets the baseline headers on a deployed host", () => {
    const res = louiseSecurityHeaders(new Response("x"), { hostname: "prod.com" });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("is a no-op on localhost", () => {
    const res = louiseSecurityHeaders(new Response("x"), { hostname: "localhost" });
    expect(res.headers.get("x-frame-options")).toBeNull();
  });
});

describe("rewriteCspStyleSrc", () => {
  it("rewrites only style-src, leaving other directives intact", () => {
    const res = new Response("x", {
      headers: {
        "content-security-policy": "default-src 'self'; style-src 'sha256-abc'; img-src https:",
      },
    });
    rewriteCspStyleSrc(res, "'self' 'unsafe-inline'");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src https:");
    expect(csp).not.toContain("sha256-abc");
  });

  it("is a no-op when there is no CSP header", () => {
    const res = new Response("x");
    rewriteCspStyleSrc(res, "'self'");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
