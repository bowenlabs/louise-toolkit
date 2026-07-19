// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// `defineAstroid` — the Astroid project configuration surface.
//
// Astroid is the opinionated layer over Louise Toolkit + Astro. A site's whole
// shape — its brand + theme + editable home, its commerce backend, its optional
// modules — collapses into ONE typed config here. Astroid consumes it to generate
// the Louise wiring (worker routes, middleware, Drizzle schema, theme tokens) a
// site would otherwise hand-write per repo.
//
// ONE brand per project. Every site Astroid targets (coracle.coffee,
// ghostfire.coffee, themidwestartist.com, louise-web) serves a single brand from a
// single deploy — none does host/tenant dispatch. The axis that genuinely
// multiplexes is *editors* (Louise's org plugin, #100) and *audiences* (a gated
// portal alongside the public site), not brands — so both live here as options on
// the one brand, not as a `brands[]` array.
//
// The vocabulary below is not invented: `Archetype`, `SectionKind`, and
// `ModuleKind` are extracted from the real sites Astroid targets — a storefront
// (coracle), a wholesale front (ghostfire), an artist portfolio (megbowen), and a
// plain marketing baseline (louise-web).

import { AstroidConfigError } from "./errors.js";

/**
 * The starting shape the front-end takes. Not a fork — each archetype is a preset
 * of defaults (which sections/modules are on, nav shape) that the site then tunes.
 * `marketing` = the lean brochure floor (louise-web, no commerce); `storefront` =
 * DTC shop (coracle); `wholesale` = B2B/private-label (ghostfire); `portfolio` =
 * gallery + prints + client portal (megbowen).
 */
export type Archetype = "marketing" | "storefront" | "wholesale" | "portfolio";

/**
 * The section vocabulary — the editable home page is an ordered list of these, top
 * to bottom. Each maps to a themeable component in the Astroid section library.
 * Drawn from real usage across the target sites (annotated below).
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
 * Optional capabilities the site switches on. Pluggable, not core — a portfolio
 * site runs none of the commerce ones. `orderTracking` is shared across both
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

export interface Theme {
  /** Display name — the brand, used in nav, `<title>`, OG cards. */
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

export interface Portal {
  enabled: boolean;
  /** Require a session to view the whole site (Meg Bowen's gated preview), not
   *  just the account area. Default `false`. */
  gated?: boolean;
  /** Modules exposed inside the account area (e.g. `orderTracking`). */
  features?: ModuleKind[];
}

export interface CommerceConfig {
  provider: CommerceProvider;
}

export interface DeployConfig {
  platform: "cloudflare";
  /** Media base for R2 + `cf-image` resizing — matches Louise's media route
   *  (`media.<brand>/cdn-cgi/image`). Default `"/media"`. */
  mediaBase?: string;
}

export interface AstroidConfig {
  /**
   * Stable project slug — the worker/D1/R2 base name and default subdomain (e.g.
   * `"coracle"`). Required and non-empty; it drives the generated binding names.
   */
  key: string;
  /** Hostname(s) this site serves (prod + preview), for custom-domain routes. */
  hosts?: string[];
  /** Starting shape; sets section/module/nav defaults the site can override. */
  archetype: Archetype;
  /** The single brand's theme (display name + color tokens + font). */
  theme: Theme;
  /** The editable home page, top to bottom. Omit to take the archetype default. */
  sections?: SectionKind[];
  /** Optional capabilities switched on for this site. */
  modules?: ModuleKind[];
  /** Gated account/portal area (order tracking, client galleries). */
  portal?: Portal;
  /** Commerce backend. */
  commerce?: CommerceConfig;
  deploy?: DeployConfig;
}

/**
 * Define an Astroid project. An identity function in the shape of Astro's
 * `defineConfig`: it returns the config verbatim with full type-checking +
 * inference, and validates the invariants that would otherwise fail deep inside
 * generation (a non-empty project `key`, since it names the generated bindings;
 * a brand `theme.name` + `colors.brand`, since they seed the site and theme).
 *
 * ```ts
 * export default defineAstroid({
 *   key: "coracle",
 *   archetype: "storefront",
 *   theme: { name: "Coracle Coffee", colors: { brand: "#1f6f78" } },
 *   sections: ["hero", "marquee", "featured", "productGrid", "visit"],
 *   commerce: { provider: "square" },
 *   deploy: { platform: "cloudflare" },
 * });
 * ```
 */
export function defineAstroid(config: AstroidConfig): AstroidConfig {
  if (!config.key || config.key.trim().length === 0) {
    throw new AstroidConfigError(
      "Astroid config requires a non-empty `key` (it names the generated worker/D1/R2 bindings)",
    );
  }
  if (!config.theme || !config.theme.name || config.theme.name.trim().length === 0) {
    throw new AstroidConfigError("Astroid config requires `theme.name` (the brand's display name)");
  }
  if (!config.theme.colors || !config.theme.colors.brand) {
    throw new AstroidConfigError("Astroid config requires `theme.colors.brand` (the primary brand color)");
  }

  return config;
}
