import { describe, expect, it } from "vitest";
import {
  allowCspDataFonts,
  getSessionSecret,
  louiseSecurityHeaders,
  matchRateRule,
  normalizeRatePath,
  rateLimit,
  readSecret,
  rewriteCspStyleSrc,
  ALLOWED_TAGS,
  ATTR_ALLOW,
  MODEL_ALLOWED_TAGS,
  MODEL_ATTR_ALLOW,
  MODEL_LINK_REL,
  sanitizeModelHtml,
  sanitizeRichHtml,
  type KVLike,
  type RateLimiterBinding,
  type RateRule,
} from "../../src/core/security/index.js";

/** Build a Response carrying the given CSP (or none), for the CSP helpers. */
function withCsp(csp?: string): Response {
  const headers = new Headers();
  if (csp !== undefined) headers.set("content-security-policy", csp);
  return new Response(null, { headers });
}
const cspOf = (r: Response) => r.headers.get("content-security-policy");

describe("allowCspDataFonts", () => {
  it("adds data: to an existing font-src that lacks it", () => {
    const res = allowCspDataFonts(withCsp("default-src 'self'; font-src 'self'"));
    expect(cspOf(res)).toBe("default-src 'self'; font-src 'self' data:");
  });

  it("is idempotent when data: is already allowed", () => {
    const res = allowCspDataFonts(withCsp("font-src 'self' data:"));
    expect(cspOf(res)).toBe("font-src 'self' data:");
  });

  it("derives a font-src from default-src when none is present", () => {
    const res = allowCspDataFonts(withCsp("default-src 'self'; img-src 'self' data:"));
    expect(cspOf(res)).toBe("default-src 'self'; img-src 'self' data:; font-src 'self' data:");
  });

  it("drops 'none' when deriving from a default-src 'none'", () => {
    const res = allowCspDataFonts(withCsp("default-src 'none'"));
    expect(cspOf(res)).toBe("default-src 'none'; font-src data:");
  });

  it("leaves other directives untouched", () => {
    const res = allowCspDataFonts(
      withCsp("default-src 'self'; script-src 'self' 'sha256-abc'; font-src 'self'"),
    );
    expect(cspOf(res)).toBe(
      "default-src 'self'; script-src 'self' 'sha256-abc'; font-src 'self' data:",
    );
  });

  it("no-ops when there is no CSP header", () => {
    const res = allowCspDataFonts(withCsp());
    expect(cspOf(res)).toBeNull();
  });

  it("no-ops when fonts are already unrestricted (no font-src and no default-src)", () => {
    const res = allowCspDataFonts(withCsp("img-src 'self'"));
    expect(cspOf(res)).toBe("img-src 'self'");
  });

  it("does not false-match a source that merely ends in 'data:'", () => {
    const res = allowCspDataFonts(withCsp("font-src 'self' https://mydata:443"));
    expect(cspOf(res)).toBe("font-src 'self' https://mydata:443 data:");
  });
});

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

  it("keeps a brand-token colour mark (var(--color-*)) and the link mark (#182 Phase 5)", () => {
    // The Phase 5 colour mark stores a daisyUI token, resolved to the site theme.
    expect(
      sanitizeRichHtml('<p><span style="color: var(--color-primary)">hi</span></p>'),
    ).toContain("color: var(--color-primary)");
    // Inline link mark → <a href> (already allowed).
    expect(sanitizeRichHtml('<p><a href="https://ok.com">x</a></p>')).toContain(
      'href="https://ok.com"',
    );
  });

  it("only allows var() that references a --color-* custom property", () => {
    // A non-color var (could reference anything) is dropped.
    expect(sanitizeRichHtml('<span style="color: var(--evil)">x</span>')).not.toContain("var(");
    // var() can't smuggle a second declaration or a url().
    expect(
      sanitizeRichHtml('<span style="color: var(--color-primary); background: url(x)">x</span>'),
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

describe("sanitizeModelHtml", () => {
  // The invariant the preset rests on (#465): the model allowlist is a subset of
  // the human one, so the two can't drift apart in the wrong direction.
  it("allows only tags the human preset also allows", () => {
    for (const tag of MODEL_ALLOWED_TAGS) expect(ALLOWED_TAGS).toContain(tag);
  });

  it("allows only attributes the human preset also allows, per tag", () => {
    for (const [tag, attrs] of Object.entries(MODEL_ATTR_ALLOW)) {
      expect(MODEL_ALLOWED_TAGS).toContain(tag);
      for (const attr of attrs) expect(ATTR_ALLOW[tag]?.has(attr)).toBe(true);
    }
  });

  it("is strictly narrower than the human preset", () => {
    for (const tag of ["img", "span", "div", "section", "figure"]) {
      expect(ALLOWED_TAGS).toContain(tag);
      expect(MODEL_ALLOWED_TAGS).not.toContain(tag);
    }
  });

  it("strips a prompt-injection payload and keeps the text structure", () => {
    const payload =
      "<h2>Summary</h2>" +
      '<p style="color: red" class="btn-solid">Read <strong>this</strong> ' +
      '<img src="https://tracker.example.com/p.gif" onerror="fetch(\'https://attacker.example.com\')">' +
      '<a href="javascript:alert(document.cookie)">now</a> or ' +
      '<a href="https://example.com/docs" target="_blank" rel="opener" onclick="x()">docs</a></p>' +
      '<iframe src="https://attacker.example.com/frame"></iframe>' +
      "<style>body{display:none}</style>" +
      "<script>alert(1)</script>" +
      "<ul><li>one</li><li><em>two</em></li></ul>" +
      "<blockquote><p>quoted <code>x</code></p></blockquote>";
    const out = sanitizeModelHtml(payload);

    expect(out).not.toMatch(
      /<img|onerror|tracker|javascript:|<iframe|attacker|<style|display:none|<script|alert|onclick|target=|btn-solid|class=|style=/i,
    );
    expect(out).toContain("<h2>Summary</h2>");
    expect(out).toContain("<strong>this</strong>");
    expect(out).toContain("<ul><li>one</li><li><em>two</em></li></ul>");
    expect(out).toContain("<blockquote><p>quoted <code>x</code></p></blockquote>");
    // The javascript: link is unwrapped to its text, not deleted with it.
    expect(out).toContain("now");
    expect(out).toContain(`<a href="https://example.com/docs" rel="${MODEL_LINK_REL}">docs</a>`);
  });

  it("forces rel on every surviving link, overriding what the model wrote", () => {
    const out = sanitizeModelHtml('<p><a href="mailto:alex@example.com" rel="opener">Alex</a></p>');
    expect(out).toBe(
      `<p><a href="mailto:alex@example.com" rel="noopener noreferrer nofollow">Alex</a></p>`,
    );
  });

  it("unwraps a link whose href isn't absolute HTTP, HTTPS, or mailto", () => {
    for (const href of ["/contact", "#top", "./page", "data:text/html,x", "  javascript:x"]) {
      expect(sanitizeModelHtml(`<p><a href="${href}">go</a></p>`)).toBe("<p>go</p>");
    }
    expect(sanitizeModelHtml("<p><a>bare</a></p>")).toBe("<p>bare</p>");
  });

  it("unwraps human-only wrappers but keeps their text", () => {
    const out = sanitizeModelHtml(
      '<div class="pb-grid"><p><span style="color: red">kept</span> <u>under</u></p></div>',
    );
    expect(out).toBe("<p>kept under</p>");
  });

  it("drops an image even inside an unwrapped wrapper", () => {
    const out = sanitizeModelHtml(
      '<figure><img src="https://example.com/x.png" onerror="y()"><figcaption>cap</figcaption></figure>',
    );
    expect(out).toBe("cap");
  });

  it("drops embeds with their contents", () => {
    const out = sanitizeModelHtml(
      '<p>a</p><object data="x"><embed src="y"></object><svg><script>z()</script></svg><p>b</p>',
    );
    expect(out).toBe("<p>a</p><p>b</p>");
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

describe("rateLimit (native binding)", () => {
  /** Native binding stub whose `success` we control; records the keys it saw. */
  const makeLimiter = (success: boolean) => {
    const keys: string[] = [];
    const binding: RateLimiterBinding = {
      async limit({ key }) {
        keys.push(key);
        return { success };
      },
    };
    return { binding, keys };
  };

  it("passes through the native success verdict", async () => {
    const pass = makeLimiter(true);
    const allowed = await rateLimit(pass.binding, "ip", 20, 60);
    expect(allowed.ok).toBe(true);

    const block = makeLimiter(false);
    const denied = await rateLimit(block.binding, "ip", 20, 60);
    expect(denied.ok).toBe(false);
    // Retry-After is a bounded upper estimate (native max period), not windowSec.
    expect(denied.retryAfter).toBe(60);
  });

  it("dispatches to the native path (never treats the binding as KV)", async () => {
    const { binding, keys } = makeLimiter(true);
    await rateLimit(binding, "1.2.3.4", 20, 60);
    expect(keys).toEqual(["rl:1.2.3.4"]);
  });

  it("fails open when the native binding throws", async () => {
    const boom: RateLimiterBinding = {
      async limit() {
        throw new Error("limiter down");
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

  // A router that ignores a trailing slash, collapses duplicate slashes, and
  // decodes the path sends each of these to the endpoint behind the exact rule,
  // so each one has to spend that rule's budget.
  it("matches every spelling of an exact path that routes to the same endpoint", () => {
    for (const path of [
      "/api/auth/sign-in/magic-link/",
      "/api/auth/sign-in/magic-link//",
      "/api//auth/sign-in//magic-link",
      "//api/auth/sign-in/magic-link/",
      "/api/auth/sign-in/%6Dagic-link",
      "/api/auth/sign-in/%256Dagic-link",
    ]) {
      expect(matchRateRule(rules, "POST", path)?.name, path).toBe("magic-link");
    }
    expect(matchRateRule(rules, "POST", "/api/auth/sign-in/magic-link-other/")).toBeNull();
  });

  it("still matches a rule written for a slashed path", () => {
    const slashed: RateRule[] = [
      { name: "slashed", method: "POST", match: (p) => p === "/contact/", limit: 1, windowSec: 60 },
    ];
    expect(matchRateRule(slashed, "POST", "/contact/")?.name).toBe("slashed");
    expect(matchRateRule(slashed, "POST", "/contact")).toBeNull();
  });

  it("limits the slashed spellings of an exact checkout rule", () => {
    const checkout: RateRule[] = [
      {
        name: "checkout",
        method: "POST",
        match: (p) => p === "/api/checkout",
        limit: 1,
        windowSec: 60,
      },
    ];
    expect(matchRateRule(checkout, "POST", "/api/checkout/")?.name).toBe("checkout");
    expect(matchRateRule(checkout, "POST", "/api//checkout/")?.name).toBe("checkout");
  });

  // A broader rule after an exact one mustn't take the exact rule's other
  // spellings: the router sends them all to the same endpoint, so a slash or
  // an escape would otherwise trade the tight budget for the loose one.
  it("keeps every spelling on an exact rule ahead of a broader catch-all", () => {
    const ordered: RateRule[] = [
      {
        name: "checkout",
        method: "POST",
        match: (p) => p === "/api/checkout",
        limit: 5,
        windowSec: 60,
      },
      {
        name: "api",
        method: "POST",
        match: (p) => p.startsWith("/api/"),
        limit: 100,
        windowSec: 60,
      },
    ];
    for (const path of ["/api/checkout", "/api/checkout/", "/api//checkout/", "/api/%63heckout"]) {
      expect(matchRateRule(ordered, "POST", path)?.name, path).toBe("checkout");
    }
    expect(matchRateRule(ordered, "POST", "/api/contact/")?.name).toBe("api");
  });

  it("keeps first-match order for a broader rule ahead of an exact one", () => {
    const ordered: RateRule[] = [
      {
        name: "prefix",
        method: "POST",
        match: (p) => p.startsWith("/api/"),
        limit: 1,
        windowSec: 60,
      },
      { name: "exact", method: "POST", match: (p) => p === "/api/x", limit: 1, windowSec: 60 },
    ];
    expect(matchRateRule(ordered, "POST", "/api/x")?.name).toBe("prefix");
    expect(matchRateRule(ordered, "POST", "//api/x/")?.name).toBe("prefix");
  });

  // The documented upgrade edge from 0.43.0 (ADR 0012): each rule sees both
  // spellings before the next rule is tried, so an earlier rule for the
  // canonical path takes a spelling that a later rule was written for.
  it("lets an earlier canonical rule take a spelling a later rule was written for", () => {
    const ordered: RateRule[] = [
      { name: "first", method: "POST", match: (p) => p === "/a", limit: 1, windowSec: 60 },
      { name: "second", method: "POST", match: (p) => p === "/a/", limit: 1, windowSec: 60 },
    ];
    expect(matchRateRule(ordered, "POST", "/a/")?.name).toBe("first");
    expect(matchRateRule(ordered, "POST", "/a")?.name).toBe("first");
  });

  it("ignores a rule for another method on either spelling", () => {
    const methods: RateRule[] = [
      { name: "get", method: "GET", match: (p) => p === "/a", limit: 1, windowSec: 60 },
      { name: "post", method: "POST", match: (p) => p === "/a", limit: 1, windowSec: 60 },
    ];
    expect(matchRateRule(methods, "POST", "/a/")?.name).toBe("post");
    expect(matchRateRule(methods, "GET", "/a/")?.name).toBe("get");
    expect(matchRateRule(methods, "PUT", "/a/")).toBeNull();
  });
});

describe("normalizeRatePath", () => {
  it("removes a trailing slash and collapses duplicate slashes", () => {
    expect(normalizeRatePath("/api/checkout")).toBe("/api/checkout");
    expect(normalizeRatePath("/api/checkout/")).toBe("/api/checkout");
    expect(normalizeRatePath("/api/checkout///")).toBe("/api/checkout");
    expect(normalizeRatePath("//api//checkout")).toBe("/api/checkout");
  });

  it("keeps the root path", () => {
    expect(normalizeRatePath("/")).toBe("/");
    expect(normalizeRatePath("//")).toBe("/");
    expect(normalizeRatePath("")).toBe("");
  });

  it("decodes until the path stops changing, as the router does", () => {
    expect(normalizeRatePath("/api/%63heckout")).toBe("/api/checkout");
    expect(normalizeRatePath("/api/%2563heckout")).toBe("/api/checkout");
  });

  it("never decodes an encoded slash into a separator", () => {
    expect(normalizeRatePath("/api%2Fcheckout")).toBe("/api%2Fcheckout");
  });

  it("keeps a path with an invalid escape as it stands", () => {
    expect(normalizeRatePath("/api/%E0%A4%A/")).toBe("/api/%E0%A4%A");
    expect(normalizeRatePath("/100%/")).toBe("/100%");
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

  it("reads a plain `wrangler secret put` string, not just a Secrets Store binding", async () => {
    expect(await getSessionSecret("plain-value", new URL("https://x.com"))).toBe("plain-value");
  });

  it("fails closed on a deployed host when the secret is still the placeholder", async () => {
    const seeded = { get: async () => "DUMMY_REPLACE_ME" };
    const opts = { placeholder: "DUMMY_REPLACE_ME" };
    // The whole point of the seeded-placeholder convention: reaching production
    // with it unresolved must NOT sign sessions with a publicly-known constant.
    await expect(
      getSessionSecret(seeded, new URL("https://prod.com"), undefined, opts),
    ).rejects.toThrow();
    expect(await getSessionSecret(seeded, new URL("http://localhost:4321"), undefined, opts)).toBe(
      "louise-dev-secret",
    );
    // Without a declared sentinel it is just an ordinary (bad) secret value.
    expect(await getSessionSecret(seeded, new URL("https://prod.com"))).toBe("DUMMY_REPLACE_ME");
  });
});

describe("readSecret", () => {
  it("returns the trimmed value from a binding or a plain string", async () => {
    expect(await readSecret({ get: async () => " sk_live_1 " })).toBe("sk_live_1");
    expect(await readSecret("sk_live_2")).toBe("sk_live_2");
  });

  it("reads absent / unreadable / empty as not-configured", async () => {
    expect(await readSecret(undefined)).toBeNull();
    expect(await readSecret(null)).toBeNull();
    expect(await readSecret("")).toBeNull();
    expect(await readSecret("   ")).toBeNull();
    expect(await readSecret({ get: async () => "" })).toBeNull();
    // A declared-but-unprovisioned Secrets Store binding throws on read; that is
    // "not configured", not an outage, so callers degrade instead of 500-ing.
    expect(
      await readSecret({
        get: async () => {
          throw new Error("no store");
        },
      }),
    ).toBeNull();
  });

  it("reads a caller-declared placeholder as not-configured", async () => {
    expect(await readSecret("DUMMY_REPLACE_ME", { placeholder: "DUMMY_REPLACE_ME" })).toBeNull();
    // Trimmed before comparison, so whitespace can't smuggle a sentinel through.
    expect(await readSecret(" DUMMY_REPLACE_ME ", { placeholder: "DUMMY_REPLACE_ME" })).toBeNull();
    expect(await readSecret("real", { placeholder: ["DUMMY_REPLACE_ME", "TODO"] })).toBe("real");
    expect(await readSecret("TODO", { placeholder: ["DUMMY_REPLACE_ME", "TODO"] })).toBeNull();
    // No sentinel declared → the package has no opinion about the value.
    expect(await readSecret("DUMMY_REPLACE_ME")).toBe("DUMMY_REPLACE_ME");
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
