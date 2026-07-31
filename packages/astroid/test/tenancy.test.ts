import { describe, expect, it } from "vitest";
import { type AstroidConfig, defineAstroid } from "../src/config.js";
import { generateAstroidWrangler } from "../src/project/generate.js";
import {
  appPrefix,
  generateAstroidTenancy,
  isRewriteExcluded,
  tenancyZone,
  tenantLabel,
} from "../src/tenancy/index.js";
import { generateAstroidMiddleware } from "../src/worker/generate.js";

const base: AstroidConfig = {
  key: "acme",
  archetype: "marketing",
  theme: { name: "Acme", colors: { brand: "#1f6e6d" } },
};
const tenanted: AstroidConfig = {
  ...base,
  hosts: ["example.com"],
  tenancy: { hostPattern: "*.example.com", reserved: ["www", "studio"] },
};

describe("tenancyZone", () => {
  it("derives the zone from the pattern", () => {
    expect(tenancyZone({ hostPattern: "*.example.com" })).toBe("example.com");
  });

  it("honours an explicit zone for a deeper pattern", () => {
    // `*.shop.example.com` is served by the example.com zone; guessing
    // shop.example.com names a zone that doesn't exist and fails at deploy.
    expect(tenancyZone({ hostPattern: "*.shop.example.com", zone: "example.com" })).toBe(
      "example.com",
    );
  });
});

describe("tenantLabel", () => {
  const t = tenanted.tenancy!;

  it("extracts the subdomain label", () => {
    expect(tenantLabel("acme.example.com", t)).toBe("acme");
  });

  it("returns null for the apex — a wildcard doesn't match it", () => {
    expect(tenantLabel("example.com", t)).toBeNull();
  });

  it("returns null for a reserved label", () => {
    expect(tenantLabel("www.example.com", t)).toBeNull();
    expect(tenantLabel("studio.example.com", t)).toBeNull();
  });

  it("returns null off-pattern, so previews and localhost render normally", () => {
    expect(tenantLabel("localhost", t)).toBeNull();
    expect(tenantLabel("acme.pages.dev", t)).toBeNull();
  });

  it("refuses a dotted label rather than putting a slash in a rewrite path", () => {
    // Cloudflare's wildcard matches one level. Treating `a.b` as a slug would
    // rewrite to `/t/a.b/…` at best, and `/t/a/b/…` if anyone split it.
    expect(tenantLabel("a.b.example.com", t)).toBeNull();
  });

  it("ignores a port and case, so `wrangler dev` behaves like production", () => {
    expect(tenantLabel("ACME.example.com:8788", t)).toBe("acme");
  });
});

describe("generated wrangler routes", () => {
  it("emits the wildcard as a ZONE route, never a custom domain", () => {
    // Cloudflare refuses `custom_domain: true` on a pattern containing `*` —
    // the reason `hosts` cannot express this at all.
    const out = generateAstroidWrangler(tenanted);
    expect(out).toContain('{ "pattern": "*.example.com/*", "zone_name": "example.com" }');
    expect(out).not.toContain('{ "pattern": "*.example.com/*", "custom_domain": true }');
  });

  it("keeps the apex as its own custom-domain route", () => {
    // The wildcard does not match the apex, so dropping this 404s the main site.
    const out = generateAstroidWrangler(tenanted);
    expect(out).toContain('{ "pattern": "example.com", "custom_domain": true }');
  });

  it("emits no route entries without hosts or tenancy", () => {
    // Asserting on the entries, not the word: the no-hosts fallback COMMENT
    // mentions `"routes"` while emitting none.
    const out = generateAstroidWrangler(base);
    expect(out).not.toContain('"custom_domain"');
    expect(out).not.toContain('"zone_name"');
  });
});

describe("generated middleware", () => {
  it("resolves the tenant in extend and rewrites after the guard", () => {
    const out = generateAstroidMiddleware(tenanted);
    expect(out).toContain(
      'import { astroidRateRules, isRewriteExcluded, tenantLabel } from "astroidjs";',
    );
    expect(out).toContain('import { resolveTenant } from "./tenancy.js";');
    // One import per module — two statements for `astroidjs` reads as an
    // oversight in a file nobody is meant to hand-edit.
    expect(out.match(/from "astroidjs";/g)).toHaveLength(1);
    expect(out).toContain("const label = tenantLabel(context.url.hostname, TENANCY);");
    expect(out).toContain("context.locals.tenant = label ? await resolveTenant(label) : null;");
    expect(out).toContain("rewrite: (context) => {");
    expect(out).toContain("`/t/${tenant.slug}${context.url.pathname}${context.url.search}`");
  });

  it("reads the reserved list from the config, not a copy", () => {
    // Restating it here would let the middleware and the generated Worker route
    // disagree about which hosts are tenants.
    expect(generateAstroidMiddleware(tenanted)).toContain(
      "const TENANCY = astroidConfig.tenancy!;",
    );
  });

  it("honours a custom rewritePrefix", () => {
    const out = generateAstroidMiddleware({
      ...tenanted,
      tenancy: { ...tenanted.tenancy!, rewritePrefix: "/merchant" },
    });
    expect(out).toContain("`/merchant/${tenant.slug}${context.url.pathname}${context.url.search}`");
  });

  it("emits nothing tenancy-shaped when it isn't configured", () => {
    const out = generateAstroidMiddleware(base);
    expect(out).not.toContain("tenantLabel");
    expect(out).not.toContain("rewrite:");
  });
});

describe("scaffolded src/tenancy.ts", () => {
  it("carries the seam and points at the right page directory", () => {
    const out = generateAstroidTenancy(tenanted)!;
    expect(out).toContain("export async function resolveTenant(");
    expect(out).toContain("src/pages/t/[tenant]/");
    // The unknown-host decision is named as a decision, not defaulted silently.
    expect(out).toContain("`null` falls through to the ordinary site");
  });

  it("is null without tenancy, so nothing is scaffolded", () => {
    expect(generateAstroidTenancy(base)).toBeNull();
  });
});

describe("defineAstroid — tenancy validation", () => {
  it("requires a wildcard pattern", () => {
    expect(() =>
      defineAstroid({ ...base, hosts: ["example.com"], tenancy: { hostPattern: "example.com" } }),
    ).toThrow(/must be a wildcard/);
  });

  it("requires the apex in `hosts`, because the wildcard doesn't match it", () => {
    // Without this the marketing site 404s the moment tenancy is switched on —
    // a symptom that reads as unrelated to the feature that caused it.
    expect(() => defineAstroid({ ...base, tenancy: { hostPattern: "*.example.com" } })).toThrow(
      /"example.com" is not in `hosts`/,
    );
  });

  it("accepts a well-formed config", () => {
    expect(() => defineAstroid(tenanted)).not.toThrow();
  });
});

describe("tenancy.apps — first-party app labels", () => {
  const withApps: AstroidConfig = {
    ...base,
    hosts: ["example.com"],
    tenancy: {
      hostPattern: "*.example.com",
      reserved: ["www"],
      apps: { studio: "/studio" },
    },
  };
  const t = withApps.tenancy!;

  it("appPrefix maps an app host to its internal prefix", () => {
    expect(appPrefix("studio.example.com", t)).toBe("/studio");
  });

  it("appPrefix ignores port and case, so `wrangler dev` behaves like production", () => {
    expect(appPrefix("STUDIO.example.com:8788", t)).toBe("/studio");
  });

  it("appPrefix is null for the apex, off-pattern, dotted, and non-app hosts", () => {
    expect(appPrefix("example.com", t)).toBeNull();
    expect(appPrefix("studio.pages.dev", t)).toBeNull();
    expect(appPrefix("a.studio.example.com", t)).toBeNull();
    expect(appPrefix("acme.example.com", t)).toBeNull();
  });

  it("an app label is implicitly reserved — never offered to resolveTenant", () => {
    expect(tenantLabel("studio.example.com", t)).toBeNull();
    // …while an ordinary label still is.
    expect(tenantLabel("acme.example.com", t)).toBe("acme");
  });

  it("emits the app rewrite before the tenant rewrite, from the same TENANCY", () => {
    const out = generateAstroidMiddleware(withApps);
    expect(out).toContain(
      'import { appPrefix, astroidRateRules, isRewriteExcluded, tenantLabel } from "astroidjs";',
    );
    expect(out).toContain("const app = appPrefix(context.url.hostname, TENANCY);");
    expect(out).toContain("if (app) return `${app}${context.url.pathname}${context.url.search}`;");
    // App check precedes the tenant check inside the one rewrite hook.
    const appAt = out.indexOf("const app = appPrefix");
    const tenantAt = out.indexOf("const tenant = context.locals.tenant;");
    expect(appAt).toBeGreaterThan(-1);
    expect(tenantAt).toBeGreaterThan(appAt);
  });

  it("emits no appPrefix machinery without apps", () => {
    expect(generateAstroidMiddleware(tenanted)).not.toContain("appPrefix");
  });

  it("defineAstroid refuses an app label that is also reserved", () => {
    expect(() =>
      defineAstroid({
        ...withApps,
        tenancy: { ...t, reserved: ["www", "studio"] },
      }),
    ).toThrow(/both `tenancy.apps` and `tenancy.reserved`/);
  });

  it("defineAstroid refuses a prefix that would produce a broken rewrite", () => {
    for (const bad of ["studio", "/", "/studio/"]) {
      expect(() =>
        defineAstroid({
          ...withApps,
          tenancy: { ...t, apps: { studio: bad } },
        }),
      ).toThrow(/internal path prefix/);
    }
  });

  it("defineAstroid refuses a dotted app label", () => {
    expect(() =>
      defineAstroid({
        ...withApps,
        tenancy: { ...t, apps: { "a.b": "/studio" } },
      }),
    ).toThrow(/single subdomain label/);
  });
});

describe("tenancy.unknown — what a failed tenant lookup means", () => {
  const with404: AstroidConfig = {
    ...base,
    hosts: ["example.com"],
    tenancy: {
      hostPattern: "*.example.com",
      reserved: ["www"],
      apps: { studio: "/studio" },
      unknown: "404",
    },
  };

  it('emits a guard that refuses a resolved-to-nothing tenant host under "404"', () => {
    const out = generateAstroidMiddleware(with404);
    expect(out).toContain("guard: (context) => {");
    expect(out).toContain(
      "if (tenantLabel(context.url.hostname, TENANCY) && !context.locals.tenant) {",
    );
    expect(out).toContain('return new Response("Not found", { status: 404 });');
    // The guard must run against locals.tenant, which `extend` sets — so both
    // hooks have to be present in the same emission.
    expect(out).toContain("context.locals.tenant = label ? await resolveTenant(label) : null;");
  });

  it("emits no guard at all under the fallthrough default", () => {
    // `tenanted` has tenancy but no `unknown` — the pre-existing behaviour
    // (stranger's subdomain renders the ordinary site) must be unchanged.
    expect(generateAstroidMiddleware(tenanted)).not.toContain("guard:");
  });

  it("composes with the portal guard in ONE guard function", () => {
    const out = generateAstroidMiddleware({
      ...with404,
      portal: { enabled: true },
    });
    // One `guard:` key — a second would silently shadow the first in the
    // object literal, which is the exact bug composition exists to prevent.
    expect(out.match(/guard: \(context\) => \{/g)).toHaveLength(1);
    // Tenant refusal first, then the portal's prefix table.
    const tenantAt = out.indexOf('return new Response("Not found", { status: 404 });');
    const portalAt = out.indexOf("const decision = portalGuard(");
    expect(tenantAt).toBeGreaterThan(-1);
    expect(portalAt).toBeGreaterThan(tenantAt);
  });

  it("accepts the config without complaint", () => {
    expect(() => defineAstroid(with404)).not.toThrow();
  });
});

describe("isRewriteExcluded", () => {
  it("matches the prefix itself and anything under it", () => {
    expect(isRewriteExcluded("/api", ["/api"])).toBe(true);
    expect(isRewriteExcluded("/api/louise/crm", ["/api"])).toBe(true);
  });

  it("is segment-aware — a coincidental name is not an API path", () => {
    // Without this, a site with an /apiary page would lose it on every
    // tenant host, which is a very confusing way to find out about a prefix.
    expect(isRewriteExcluded("/apiary", ["/api"])).toBe(false);
    expect(isRewriteExcluded("/apiary/bees", ["/api"])).toBe(false);
  });

  it("excludes nothing when the list is empty", () => {
    expect(isRewriteExcluded("/api/x", [])).toBe(false);
  });

  it("honours a trailing slash in the configured prefix", () => {
    expect(isRewriteExcluded("/api/x", ["/api/"])).toBe(true);
  });
});

describe("generated middleware — host-agnostic paths are never rewritten", () => {
  it("skips /api by default, BEFORE the app and tenant branches", () => {
    const out = generateAstroidMiddleware({
      ...base,
      hosts: ["example.com"],
      tenancy: { hostPattern: "*.example.com", apps: { studio: "/studio" } },
    });
    expect(out).toContain("import { appPrefix, astroidRateRules, isRewriteExcluded, tenantLabel }");
    expect(out).toContain('isRewriteExcluded(context.url.pathname, ["/api"])');
    // Order matters: an app host with a catch-all page would otherwise answer
    // fetch("/api/…") with HTML, so the exclusion must come first.
    const excludeAt = out.indexOf("isRewriteExcluded(context.url.pathname");
    const appAt = out.indexOf("const app = appPrefix(");
    const tenantAt = out.indexOf("const tenant = context.locals.tenant;");
    expect(excludeAt).toBeGreaterThan(-1);
    expect(appAt).toBeGreaterThan(excludeAt);
    expect(tenantAt).toBeGreaterThan(excludeAt);
  });

  it("emits a site's own exclusion list verbatim", () => {
    const out = generateAstroidMiddleware({
      ...base,
      hosts: ["example.com"],
      tenancy: { hostPattern: "*.example.com", rewriteExclude: ["/api", "/_actions"] },
    });
    expect(out).toContain('isRewriteExcluded(context.url.pathname, ["/api","/_actions"])');
  });

  it("emits an empty list when a site opts out", () => {
    const out = generateAstroidMiddleware({
      ...base,
      hosts: ["example.com"],
      tenancy: { hostPattern: "*.example.com", rewriteExclude: [] },
    });
    expect(out).toContain("isRewriteExcluded(context.url.pathname, [])");
  });
});

describe("the rewrite preserves the query string", () => {
  // The rewrite chooses which PAGE renders; it does not get to edit what was
  // asked of it. Dropping `search` silently loses filters, pagination,
  // campaign tags — and every typed search param a routed island reads, which
  // on an app host is the whole point of using a router.
  it("carries search through the tenant branch", () => {
    const out = generateAstroidMiddleware(tenanted);
    expect(out).toContain("${context.url.pathname}${context.url.search}");
  });

  it("carries search through the app branch too", () => {
    const out = generateAstroidMiddleware({
      ...base,
      hosts: ["example.com"],
      tenancy: { hostPattern: "*.example.com", apps: { studio: "/studio" } },
    });
    expect(out).toContain("if (app) return `${app}${context.url.pathname}${context.url.search}`;");
  });

  it("never emits a bare pathname rewrite", () => {
    // The regression this guards: a rewrite that ends at `pathname`.
    const out = generateAstroidMiddleware(tenanted);
    expect(out).not.toContain("${context.url.pathname}`");
  });
});
