// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Content-Security-Policy composition, owned by Astroid rather than re-derived
// per site.
//
// The split is the non-obvious part, and all three consuming sites arrived at it
// the hard way:
//
//   - **Astro owns `script-src`.** Its `security.csp` hashes every script it
//     processes, so the policy can be `'self'` with no `'unsafe-inline'`. What it
//     does NOT hash is Solid's hydration bootstrap, which `@astrojs/solid-js`
//     injects on every page carrying an island — Astro only tracks its own inline
//     scripts. So we compute that hash from the very function the renderer calls,
//     which means it follows solid-js upgrades instead of going stale as a
//     copy-pasted literal.
//   - **The middleware owns `style-src`.** Louise's data-driven `style=""`
//     carriers and the editor's runtime-injected `<style>` need
//     `'unsafe-inline'`, and per spec a single hash in `style-src` VOIDS
//     `'unsafe-inline'` — so the two cannot coexist in one directive. The
//     generated middleware rewrites that one directive after the fact
//     (`cspStyleSrc`), leaving Astro's script hashes verbatim.
//
// Modules contribute origins; this module owns the composition seam.
//
// This subpath is build-time only (Node, `node:crypto`, `solid-js/web`) and is
// deliberately NOT re-exported from the `astroidjs` entry the generated Worker
// imports.

import { createHash } from "node:crypto";
import { generateHydrationScript } from "solid-js/web";
import { astroidCommerceProviders } from "../commerce/roles.js";
import type { AstroidConfig, CspOrigins } from "../config.js";

/** A `sha256-…` CSP hash, in the shape Astro's `security.csp.hashes` takes. */
export type CspHash = `${"sha256" | "sha384" | "sha512"}-${string}`;

/**
 * The directives Astro lets a config own. `script-src` and `style-src` are
 * absent by design — Astro owns the first (it hashes what it processes) and the
 * middleware owns the second.
 *
 * Mirrored from Astro's own union rather than imported, so `astroidjs/astro`
 * needs no `astro` dependency. Two things fall out of matching it exactly: the
 * returned config is assignable to `defineConfig`'s `security` without a cast,
 * and a typo like `"img-srcs 'self'"` fails to compile *here* rather than
 * silently producing a directive no browser enforces.
 */
type CspDirectiveName =
  | "base-uri"
  | "child-src"
  | "connect-src"
  | "default-src"
  | "fenced-frame-src"
  | "font-src"
  | "form-action"
  | "frame-ancestors"
  | "frame-src"
  | "img-src"
  | "manifest-src"
  | "media-src"
  | "object-src"
  | "referrer"
  | "report-to"
  | "report-uri"
  | "require-trusted-types-for"
  | "sandbox"
  | "trusted-types"
  | "upgrade-insecure-requests"
  | "worker-src";

/** One rendered directive line, e.g. `"default-src 'self'"`. */
export type CspDirective = `${CspDirectiveName}${string}`;

/** The `security` block for `astro.config.mjs`, structurally typed so Astroid
 *  doesn't take a hard dependency on Astro's types. */
export interface AstroidSecurityConfig {
  csp: {
    algorithm: "SHA-256";
    scriptDirective: { resources: string[]; hashes: CspHash[] };
    directives: CspDirective[];
  };
}

/**
 * Hash of Solid's inline hydration bootstrap.
 *
 * `@astrojs/solid-js` injects this script on every page with an island, but
 * Astro's CSP tracker only hashes scripts it processed itself — so without this
 * the bootstrap is blocked under `script-src 'self'` and every island silently
 * fails to hydrate. Computed from `generateHydrationScript()` (the same call the
 * renderer makes), so a solid-js upgrade that changes the bootstrap updates the
 * hash on the next build.
 */
export function solidHydrationHash(): CspHash {
  const inner = generateHydrationScript().match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
  return `sha256-${createHash("sha256").update(inner).digest("base64")}`;
}

/** Origins a commerce provider's client-side SDK needs. Server-only providers
 *  (Fourthwall's storefront API) contribute nothing but their image host. */
const COMMERCE_ORIGINS: Record<string, CspOrigins> = {
  // Square Web Payments renders the card form in an iframe from the squarecdn
  // hosts, tokenizes against pci-connect, and pulls its own fonts. Both the
  // sandbox and production hosts are listed so ONE build serves either
  // environment — which environment you're in is a runtime secret, not a
  // build-time one.
  square: {
    script: ["https://sandbox.web.squarecdn.com", "https://web.squarecdn.com"],
    frame: [
      "https://sandbox.web.squarecdn.com",
      "https://web.squarecdn.com",
      "https://connect.squareupsandbox.com",
      "https://connect.squareup.com",
    ],
    connect: [
      "https://pci-connect.squareupsandbox.com",
      "https://pci-connect.squareup.com",
      "https://sandbox.web.squarecdn.com",
      "https://web.squarecdn.com",
    ],
    font: [
      "https://square-fonts-production-f.squarecdn.com",
      "https://d1g145x70srn7h.cloudfront.net",
    ],
  },
  // Stripe.js and its Elements/Checkout iframes.
  stripe: {
    script: ["https://js.stripe.com"],
    frame: ["https://js.stripe.com", "https://hooks.stripe.com"],
    connect: ["https://api.stripe.com"],
  },
  // Fourthwall is read server-side; nothing runs in the browser.
  fourthwall: {},
};

// Turnstile. Always allowed, not gated on the captcha being configured: the
// scaffold ships the widget dormant (see the dormant-until-provisioned
// convention) and it must not need a rebuild to switch on — CSP is baked at
// build time, the secret is a runtime value.
const TURNSTILE: CspOrigins = {
  script: ["https://challenges.cloudflare.com"],
  frame: ["https://challenges.cloudflare.com"],
  connect: ["https://challenges.cloudflare.com"],
};

// The map module. MapLibre spins its tile-decoding workers up from blob: URLs,
// so `worker-src blob:` is not optional — without it the map renders an empty
// canvas and the console fills with worker-construction errors.
//
// Nothing else is needed, and that's the whole argument for the self-hosted
// basemap: the PMTiles archive is served same-origin, so `connect-src` stays
// `'self'` with no tile host and no API key to allow.
const MAP: CspOrigins = { worker: ["blob:"] };

const DIRECTIVE_KEYS = ["script", "frame", "connect", "font", "img", "worker"] as const;

/** Merge origin lists, de-duplicated, order preserved. */
function mergeOrigins(...sets: CspOrigins[]): Required<CspOrigins> {
  const out = {} as Required<CspOrigins>;
  for (const key of DIRECTIVE_KEYS) {
    out[key] = [...new Set(sets.flatMap((set) => set[key] ?? []))];
  }
  return out;
}

/**
 * Every origin the project's enabled modules need, merged with the config's own
 * `security.cspOrigins`. Exported so a site (or `astroid doctor`) can inspect
 * what a config implies without rebuilding the whole policy.
 */
export function astroidCspOrigins(config: AstroidConfig): Required<CspOrigins> {
  return mergeOrigins(
    TURNSTILE,
    ...((config.modules ?? []).includes("map") ? [MAP] : []),
    // EVERY provider in play, not "the" provider: a site can run Stripe for
    // invoicing beside Fourthwall for the storefront, and a policy that allowed
    // only one of them blocks the other's SDK at runtime.
    ...astroidCommerceProviders(config.commerce).map((p) => COMMERCE_ORIGINS[p] ?? {}),
    config.security?.cspOrigins ?? {},
  );
}

/**
 * Render one directive. The name is a literal from the union above, so the
 * concatenation is a valid `CspDirective` by construction — which is what the
 * assertion is standing in for (TS widens template concatenation to `string`).
 */
function directive(name: CspDirectiveName, ...sources: (string | string[])[]): CspDirective {
  const list = sources.flat().filter(Boolean).join(" ");
  return (list ? `${name} ${list}` : name) as CspDirective;
}

/**
 * The `security` block for `astro.config.mjs` — Astro's half of the split.
 *
 * `style-src` is deliberately absent: the generated middleware rewrites it per
 * response, and declaring it here would be the hash-vs-`'unsafe-inline'`
 * conflict described at the top of this file.
 */
export function astroidSecurity(config: AstroidConfig): AstroidSecurityConfig {
  const origins = astroidCspOrigins(config);
  return {
    csp: {
      algorithm: "SHA-256",
      scriptDirective: {
        resources: ["'self'", ...origins.script],
        hashes: [solidHydrationHash()],
      },
      directives: [
        directive("default-src", "'self'"),
        // Editor-authored content may embed any https image (the sanitizer
        // already gates that), and provider catalogs serve images from hosts
        // that aren't ours to pin. `data:`/`blob:` cover canvas + object URLs.
        directive("img-src", "'self' https: data: blob:", origins.img),
        // Louise base64-inlines its brand font, hence `data:`.
        directive("font-src", "'self' data:", origins.font),
        directive("connect-src", "'self'", origins.connect),
        // A bare `frame-src` with no source list is invalid CSP, so an empty
        // origin set has to become an explicit `'none'`.
        directive("frame-src", origins.frame.length ? origins.frame : "'none'"),
        // Clickjacking + injection floor. `frame-ancestors 'none'` is the one
        // that can't be set from a meta tag, so it has to live here.
        directive("frame-ancestors", "'none'"),
        directive("base-uri", "'self'"),
        directive("form-action", "'self'"),
        directive("object-src", "'none'"),
        directive("worker-src", "'self'", origins.worker),
      ],
    },
  };
}

/**
 * Vite build options the CSP depends on. `assetsInlineLimit: 0` stops Vite from
 * inlining small assets as `data:` URLs — an inlined script would be inline, and
 * therefore unhashed, and therefore blocked by `script-src 'self'`. Spread this
 * into `vite.build` rather than remembering why the number is zero.
 */
export const ASTROID_VITE_BUILD = { assetsInlineLimit: 0 } as const;
