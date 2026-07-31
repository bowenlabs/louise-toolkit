import { describe, expect, it } from "vitest";
import { type AstroidConfig, defineAstroid } from "../src/config.js";
import {
  generatePwaHeaders,
  generateServiceWorker,
  generateWebManifest,
  type PwaConfig,
  resolvePwa,
  usesPwa,
} from "../src/pwa/generate.js";

const config = (over: Partial<AstroidConfig> = {}): AstroidConfig =>
  defineAstroid({
    key: "acme",
    archetype: "storefront",
    theme: { name: "Acme Coffee", colors: { brand: "#1f6f78" } },
    ...over,
  });

const withPwa = (pwa: PwaConfig = {}) => config({ modules: ["pwa"], pwa });

describe("usesPwa", () => {
  it("is off unless the module is enabled", () => {
    expect(usesPwa(config())).toBe(false);
    expect(generateServiceWorker(config())).toBeNull();
    expect(generateWebManifest(config())).toBeNull();
    expect(generatePwaHeaders(config())).toBeNull();
  });

  it("is on when it is", () => {
    expect(usesPwa(withPwa())).toBe(true);
  });
});

describe("resolvePwa", () => {
  it("derives names and colours from the brand", () => {
    const pwa = resolvePwa(withPwa());
    expect(pwa.shortName).toBe("Acme Coffee");
    expect(pwa.themeColor).toBe("#1f6f78");
    expect(pwa.display).toBe("standalone");
  });

  it("normalizes the scope to a leading slash and no trailing one", () => {
    // Scope comparison is a string prefix test, so "/order/" would fail to
    // match the scope root itself — a subtle way to exclude the app's own
    // landing page from its own worker.
    expect(resolvePwa(withPwa({ scope: "order" })).scope).toBe("/order");
    expect(resolvePwa(withPwa({ scope: "/order/" })).scope).toBe("/order");
    expect(resolvePwa(withPwa({ scope: "/" })).scope).toBe("/");
  });

  it("precaches the scope root and the manifest", () => {
    expect(resolvePwa(withPwa({ scope: "/order" })).shell).toEqual([
      "/order",
      "/manifest.webmanifest",
    ]);
  });
});

describe("generateServiceWorker", () => {
  const sw = (pwa: PwaConfig = {}) => generateServiceWorker(withPwa(pwa)) as string;

  it("never caches /api/*", () => {
    // The issue's headline requirement: a cached checkout or auth response is a
    // correctness bug, not a speedup.
    expect(sw()).toContain("url.pathname.startsWith('/api/')");
  });

  it("never caches the editor or an edit-mode request", () => {
    // A Louise site is CMS-edited. Serving an editor a stale copy of the page
    // they're editing presents as "my changes don't save" — about as far from
    // the cause as a bug report gets.
    const source = sw();
    expect(source).toContain("url.searchParams.has('louise')");
    expect(source).toContain("/login");
    expect(source).toContain("/admin");
  });

  it("stays out of everything outside its scope", () => {
    expect(sw({ scope: "/order" })).toContain(
      "if (SCOPE !== '/' && !url.pathname.startsWith(SCOPE)) return;",
    );
    expect(sw({ scope: "/order" })).toContain('const SCOPE = "/order";');
  });

  it("only handles GET", () => {
    expect(sw()).toContain("if (req.method !== 'GET') return;");
  });

  it("ignores cross-origin requests", () => {
    expect(sw()).toContain("if (url.origin !== self.location.origin) return;");
  });

  it("is network-first for navigations and cache-first for hashed assets", () => {
    const source = sw();
    // Navigations: content changes, so cache is the fallback, not the source.
    expect(source).toContain("req.mode === 'navigate'");
    expect(source).toContain(
      ".catch(() => caches.match(req).then((r) => r || caches.match(SCOPE)))",
    );
    // Hashed assets: the name changes when the content does, so cache-first is safe.
    expect(source).toContain("url.pathname.startsWith('/_astro/')");
    expect(source).toContain("caches.match(req).then(");
  });

  it("namespaces the cache per project", () => {
    // Two Astroid apps on one origin (a preview deploy) must not read each
    // other's entries.
    expect(sw()).toContain('const CACHE = "acme-pwa-v1";');
  });

  it("survives a shell entry that 404s", () => {
    // One bad precache URL must not fail the install and leave the app with no
    // worker at all.
    expect(sw()).toContain("Promise.allSettled");
  });

  it("cleans up caches from previous versions on activate", () => {
    expect(sw()).toContain("keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))");
  });
});

describe("generateWebManifest", () => {
  it("derives the manifest from the brand and scope", () => {
    const manifest = JSON.parse(generateWebManifest(withPwa({ scope: "/order" })) as string);
    expect(manifest.name).toBe("Acme Coffee");
    expect(manifest.scope).toBe("/order");
    expect(manifest.start_url).toBe("/order");
    expect(manifest.theme_color).toBe("#1f6f78");
    expect(manifest.display).toBe("standalone");
  });

  it("declares both `any` and `maskable` icons as separate assets", () => {
    // The platform crops a maskable icon to its own shape, so the artwork needs
    // padding the `any` icon shouldn't have — they can't be the same file.
    const manifest = JSON.parse(generateWebManifest(withPwa()) as string);
    const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
    expect(manifest.icons.filter((i: { sizes: string }) => i.sizes === "512x512")).toHaveLength(2);
  });

  it("honours explicit overrides", () => {
    const manifest = JSON.parse(
      generateWebManifest(
        withPwa({ shortName: "Acme", display: "minimal-ui", backgroundColor: "#000" }),
      ) as string,
    );
    expect(manifest.short_name).toBe("Acme");
    expect(manifest.display).toBe("minimal-ui");
    expect(manifest.background_color).toBe("#000");
  });
});

describe("generatePwaHeaders", () => {
  it("makes the worker itself revalidate every load", () => {
    // A bad worker otherwise sticks around until its cache entry expires — and
    // it controls every page in scope.
    const headers = generatePwaHeaders(withPwa()) as string;
    expect(headers).toContain("/sw.js");
    expect(headers).toContain("Cache-Control: no-cache");
  });

  it("serves the manifest with the right content type", () => {
    expect(generatePwaHeaders(withPwa())).toContain("Content-Type: application/manifest+json");
  });

  it("does NOT emit Service-Worker-Allowed", () => {
    // That header is only needed for a scope BROADER than the script's own
    // location, and sw.js sits at the root — so every scope is narrower.
    // Emitting it anyway (as the reference does) implies a requirement that
    // isn't there, which misleads whoever later moves the script.
    expect(generatePwaHeaders(withPwa({ scope: "/order" }))).not.toContain(
      "Service-Worker-Allowed",
    );
  });
});

describe("offlineFallback (#309)", () => {
  it("falls back to the scope root when unset — unchanged behaviour", () => {
    const sw = generateServiceWorker(withPwa({ scope: "/order" }))!;
    expect(sw).toContain("caches.match(SCOPE)");
    expect(sw).not.toContain("OFFLINE");
  });

  it("falls back to the prerendered page when set", () => {
    // The scope root is the app SHELL. On an auth-gated app that response is
    // `Cache-Control: no-store`, so falling back to it serves either nothing or
    // a signed-in shell to whoever opens the app next.
    const sw = generateServiceWorker(withPwa({ scope: "/order", offlineFallback: "/offline" }))!;
    expect(sw).toContain('const OFFLINE = "/offline";');
    expect(sw).toContain("caches.match(OFFLINE)");
    expect(sw).not.toContain("caches.match(SCOPE)");
  });

  it("precaches the offline page — one fetched on demand isn't there when needed", () => {
    expect(resolvePwa(withPwa({ offlineFallback: "/offline" })).shell).toContain("/offline");
    expect(resolvePwa(withPwa({})).offlineFallback).toBeNull();
  });
});

describe("emitDir (#309)", () => {
  it("defaults to the public root", () => {
    expect(resolvePwa(withPwa({})).emitDir).toBe("");
    expect(resolvePwa(withPwa({})).shell).toContain("/manifest.webmanifest");
    expect(generatePwaHeaders(withPwa({}))).toContain("\n/sw.js\n");
  });

  it("moves the manifest reference and the headers stanza together", () => {
    // A stanza for /sw.js while the worker lives at /studio/sw.js sets headers
    // on nothing — and the no-cache rule is what stops a bad worker sticking.
    const pwa = withPwa({ scope: "/studio", emitDir: "studio" });
    expect(resolvePwa(pwa).shell).toContain("/studio/manifest.webmanifest");
    const headers = generatePwaHeaders(pwa)!;
    expect(headers).toContain("\n/studio/sw.js\n");
    expect(headers).toContain("\n/studio/manifest.webmanifest\n");
  });

  it("normalizes slashes, so `/studio/` and `studio` agree", () => {
    expect(resolvePwa(withPwa({ emitDir: "/studio/" })).emitDir).toBe("studio");
  });
});
