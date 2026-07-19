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
import type { AstroidConfig, CspOrigins } from "../config.js";

/** A `sha256-…` CSP hash, in the shape Astro's `security.csp.hashes` takes. */
export type CspHash = `${"sha256" | "sha384" | "sha512"}-${string}`;

/** The `security` block for `astro.config.mjs`, structurally typed so Astroid
 *  doesn't take a hard dependency on Astro's types. */
export interface AstroidSecurityConfig {
  csp: {
    algorithm: "SHA-256";
    scriptDirective: { resources: string[]; hashes: CspHash[] };
    directives: string[];
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
    config.commerce ? (COMMERCE_ORIGINS[config.commerce.provider] ?? {}) : {},
    config.security?.cspOrigins ?? {},
  );
}

const join = (...parts: (string | string[])[]) => parts.flat().filter(Boolean).join(" ");

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
        "default-src 'self'",
        // Editor-authored content may embed any https image (the sanitizer
        // already gates that), and provider catalogs serve images from hosts
        // that aren't ours to pin. `data:`/`blob:` cover canvas + object URLs.
        join("img-src 'self' https: data: blob:", origins.img),
        // Louise base64-inlines its brand font, hence `data:`.
        join("font-src 'self' data:", origins.font),
        join("connect-src 'self'", origins.connect),
        // A bare `frame-src` with no source list is invalid CSP, so an empty
        // origin set has to become an explicit `'none'`.
        origins.frame.length ? join("frame-src", origins.frame) : "frame-src 'none'",
        // Clickjacking + injection floor. `frame-ancestors 'none'` is the one
        // that can't be set from a meta tag, so it has to live here.
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        join("worker-src 'self'", origins.worker),
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
