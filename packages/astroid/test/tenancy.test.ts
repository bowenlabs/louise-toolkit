import { describe, expect, it } from "vitest";
import { type AstroidConfig, defineAstroid } from "../src/config.js";
import { generateAstroidWrangler } from "../src/project/generate.js";
import { generateAstroidTenancy, tenancyZone, tenantLabel } from "../src/tenancy/index.js";
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
    expect(out).toContain('import { astroidRateRules, tenantLabel } from "astroidjs";');
    expect(out).toContain('import { resolveTenant } from "./tenancy.js";');
    // One import per module — two statements for `astroidjs` reads as an
    // oversight in a file nobody is meant to hand-edit.
    expect(out.match(/from "astroidjs";/g)).toHaveLength(1);
    expect(out).toContain("const label = tenantLabel(context.url.hostname, TENANCY);");
    expect(out).toContain("context.locals.tenant = label ? await resolveTenant(label) : null;");
    expect(out).toContain("rewrite: (context) => {");
    expect(out).toContain("`/t/${tenant.slug}${context.url.pathname}`");
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
    expect(out).toContain("`/merchant/${tenant.slug}${context.url.pathname}`");
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
