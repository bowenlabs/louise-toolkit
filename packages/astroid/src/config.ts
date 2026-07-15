// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// `defineAstroid` — the Astroid project configuration surface.
//
// Astroid is the opinionated layer over Louise Toolkit + Astro. A site's whole
// shape — which brands it serves, each brand's theme + editable home, its
// commerce backend, its optional modules — collapses into ONE typed config here.
// Astroid consumes it to generate the Louise wiring (worker routes, middleware,
// Drizzle schema, theme tokens) a site would otherwise hand-write per repo.
//
// The vocabulary below is not invented: `Archetype`, `SectionKind`, and
// `ModuleKind` are extracted from the real brand sites Astroid targets
// (coracle.coffee, ghostfire.coffee, themidwestartist.com) — a storefront, a
// wholesale front, and an artist portfolio over one stack.

import { AstroidConfigError } from "./errors.js";

/**
 * The starting shape a brand's front-end takes. Not a fork — each archetype is a
 * preset of defaults (which sections/modules are on, nav shape) that a brand then
 * tunes. `storefront` = DTC shop (coracle), `wholesale` = B2B/private-label
 * (ghostfire), `portfolio` = gallery + prints + client portal (megbowen).
 */
export type Archetype = "storefront" | "wholesale" | "portfolio";

/**
 * The section vocabulary — a brand's editable home page is an ordered list of
 * these, top to bottom. Each maps to a themeable component in the Astroid section
 * library. Drawn from real usage across the target sites (annotated below).
 */
export type SectionKind =
  | "hero"
  | "marquee" // rotating tagline banner (coracle "Make Waves, Rise Tides…")
  | "featureGrid" // value-prop cards (ghostfire "What we make together")
  | "featured" // curated picks (coracle "On the Bench")
  | "productGrid"
  | "gallery" // artwork / prints (portfolio)
  | "story" // brand origin ("The First Fire" / "big dreams for community")
  | "visit" // physical location + hours (coracle café)
  | "cta"
  | "testimonial"
  | "contact";

/**
 * Optional capabilities a brand switches on. Pluggable, not core — a portfolio
 * brand runs none of the commerce ones. `orderTracking` is shared across both
 * coffee brands, so it's first-class but still opt-in.
 */
export type ModuleKind =
  | "orderTracking"
  | "subscriptions"
  | "giftCards"
  | "wholesaleInquiry"
  | "privateLabel";

/** Commerce backend — mirrors Louise's provider set (louise-toolkit/commerce). */
export type CommerceProvider = "stripe" | "square" | "fourthwall";

export interface BrandTheme {
  /** Display name — used in nav, `<title>`, OG cards. */
  name: string;
  /** Path to the primary logo (media-library asset or a `/brand/*` file). */
  logo?: string;
  /**
   * Brand color tokens → CSS variables + a daisyUI theme, surfaced in Louise
   * Settings so the brand is editable in place (not hard-coded). `brand` is
   * required; `secondary`/`tertiary` mirror `site_settings`' existing columns.
   */
  colors: { brand: string; secondary?: string; tertiary?: string };
  /** Font preset key (a bundled `@font-face` set) or a custom family name. */
  font?: string;
}

export interface BrandPortal {
  enabled: boolean;
  /** Require a session to view the whole brand (Meg Bowen's gated preview), not
   *  just the account area. Default `false`. */
  gated?: boolean;
  /** Modules exposed inside the account area (e.g. `orderTracking`). */
  features?: ModuleKind[];
}

export interface BrandConfig {
  /** Stable key — the brand's workspace id and default subdomain (e.g.
   *  `"coracle"`). Drives Host dispatch and per-brand schema, so it must be
   *  unique across `brands`. */
  key: string;
  /** Hostname(s) this brand serves (prod + preview), for Host dispatch. */
  hosts?: string[];
  /** Starting shape; sets section/module/nav defaults the brand can override. */
  archetype: Archetype;
  theme: BrandTheme;
  /** The editable home page, top to bottom. Omit to take the archetype default. */
  sections?: SectionKind[];
  /** Optional capabilities switched on for this brand. */
  modules?: ModuleKind[];
  /** Gated account/portal area (order tracking, client galleries). */
  portal?: BrandPortal;
}

export interface CommerceConfig {
  provider: CommerceProvider;
  /**
   * Serve every storefront/wholesale brand from ONE catalog + order backend —
   * the multi-storefront angle (coracle DTC + ghostfire wholesale over a shared
   * Square catalog, which coracle already links to for "Wholesale"). Default
   * `false` (each brand owns its own catalog).
   */
  sharedCatalog?: boolean;
}

export interface DeployConfig {
  platform: "cloudflare";
  /** Media base for R2 + `cf-image` resizing — matches Louise's media route
   *  (`media.<brand>/cdn-cgi/image`). Default `"/media"`. */
  mediaBase?: string;
}

export interface AstroidConfig {
  /** One or more brand front-ends served by this project. */
  brands: BrandConfig[];
  /** Commerce backend, shared across brands unless a brand opts out. */
  commerce?: CommerceConfig;
  /** Project-wide modules available to every brand unless overridden per brand. */
  modules?: ModuleKind[];
  deploy?: DeployConfig;
}

/**
 * Define an Astroid project. An identity function in the shape of Astro's
 * `defineConfig`: it returns the config verbatim with full type-checking +
 * inference, and validates the invariants that would otherwise fail deep inside
 * generation (at least one brand; unique brand keys, since keys drive Host
 * dispatch and schema).
 *
 * ```ts
 * export default defineAstroid({
 *   brands: [
 *     { key: "coracle", archetype: "storefront",
 *       theme: { name: "Coracle Coffee", colors: { brand: "#1f6f78" } },
 *       sections: ["hero", "marquee", "featured", "productGrid", "visit"] },
 *   ],
 *   commerce: { provider: "square", sharedCatalog: true },
 *   deploy: { platform: "cloudflare" },
 * });
 * ```
 */
export function defineAstroid(config: AstroidConfig): AstroidConfig {
  if (!config.brands || config.brands.length === 0) {
    throw new AstroidConfigError("Astroid config requires at least one brand in `brands`");
  }

  const seen = new Set<string>();
  for (const brand of config.brands) {
    if (!brand.key || brand.key.trim().length === 0) {
      throw new AstroidConfigError("Each brand requires a non-empty `key`");
    }
    if (seen.has(brand.key)) {
      throw new AstroidConfigError(
        `Duplicate brand key "${brand.key}" — brand keys must be unique (they drive Host dispatch and schema)`,
      );
    }
    seen.add(brand.key);
  }

  return config;
}
