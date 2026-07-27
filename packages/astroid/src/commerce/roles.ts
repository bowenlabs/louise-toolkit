// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Provider ROLES, not "the provider".
//
// The obvious model is one commerce provider per site. It's wrong, and the
// toolkit's own clients prove it: `louise-toolkit/commerce/stripe` has no
// catalog API whatsoever — it exposes invoices, customers, and payment intents.
// `fourthwall` is the mirror image: a catalog and a cart, no invoicing. Square
// happens to do both. A single `CommerceProvider` abstraction that assumed
// catalog + checkout would therefore have a permanent hole wherever Stripe sits.
//
// That's not hypothetical. themidwestartist.com runs Stripe for **invoicing**
// (commissions, originals) alongside Fourthwall for the **storefront** (merch) —
// two providers, one site, each doing the half it can do.
//
// So a project assigns providers to roles, and Astroid validates the assignment
// against what each provider's client can actually serve.

import { AstroidConfigError } from "../errors.js";
import type { CommerceConfig, CommerceProvider } from "../config.js";

/** What a provider is being used FOR. */
export type CommerceRole = "storefront" | "invoicing" | "pos";

/**
 * Which roles each provider can serve, derived from the surface its
 * `louise-toolkit/commerce/*` client actually exposes — not from what the
 * vendor's full API could theoretically do.
 *
 *   square      catalog + orders + payments, `createInvoice`/`publishInvoice`,
 *               AND locations + per-location price overrides + inventory counts
 *   stripe      invoices + payment intents; NO catalog
 *   fourthwall  catalog + cart; NO invoicing, and NO locations or inventory —
 *               its Platform API is create-only for products, so it cannot
 *               model stock held at a place
 *
 * Square alone can serve `pos`, and that is a fact about the clients rather than
 * a preference: `pos` needs `listLocations`, `location_overrides` and
 * `batchChangeInventory`, none of which the other two clients expose.
 */
export const PROVIDER_ROLES: Record<CommerceProvider, readonly CommerceRole[]> = {
  square: ["storefront", "invoicing", "pos"],
  stripe: ["invoicing"],
  fourthwall: ["storefront"],
};

/** The providers filling each role. Any may be absent. */
export interface ResolvedCommerceRoles {
  storefront?: CommerceProvider;
  invoicing?: CommerceProvider;
  pos?: CommerceProvider;
}

/**
 * Resolve a `commerce` block into role assignments.
 *
 * The `provider` shorthand assigns to the provider's *natural* role — the one it
 * can serve — so `{ provider: "square" }` is a storefront and
 * `{ provider: "stripe" }` is invoicing. Guessing "storefront" for both would
 * produce a storefront with no catalog API behind it.
 */
export function astroidCommerceRoles(commerce: CommerceConfig | undefined): ResolvedCommerceRoles {
  if (!commerce) return {};
  const roles: ResolvedCommerceRoles = {};

  if (commerce.provider) {
    const natural = PROVIDER_ROLES[commerce.provider];
    // Square serves both; the shorthand means the storefront, since that's the
    // role that shapes the site (a catalog, a cart, product pages).
    roles[natural.includes("storefront") ? "storefront" : "invoicing"] = commerce.provider;
  }
  if (commerce.storefront) roles.storefront = commerce.storefront;
  if (commerce.invoicing) roles.invoicing = commerce.invoicing;
  if (commerce.pos) roles.pos = commerce.pos;

  return roles;
}

/** Every distinct provider this project talks to, in a stable order. */
export function astroidCommerceProviders(commerce: CommerceConfig | undefined): CommerceProvider[] {
  const { storefront, invoicing, pos } = astroidCommerceRoles(commerce);
  return [...new Set([storefront, invoicing, pos].filter((p): p is CommerceProvider => !!p))];
}

/**
 * True when this project sells in person — the switch for locations,
 * per-location pricing and inventory.
 */
export const hasPos = (commerce: CommerceConfig | undefined): boolean =>
  Boolean(astroidCommerceRoles(commerce).pos);

/**
 * True when Square is used with more than one Location, i.e. the location id
 * comes from the request rather than the environment.
 *
 * Deliberately independent of which ROLE Square fills: a project could run
 * multi-location invoicing without a `pos` storefront, and the consequence —
 * no ambient `SQUARE_LOCATION_ID` — is the same either way.
 */
export const hasMultiLocation = (commerce: CommerceConfig | undefined): boolean =>
  commerce?.square?.locations === "multi";

/** True when this project sells anything at all. */
export const hasStorefront = (commerce: CommerceConfig | undefined): boolean =>
  Boolean(astroidCommerceRoles(commerce).storefront);

/**
 * Reject a role assignment the provider's client cannot serve. Called from
 * `defineAstroid`, so `invoicing: "fourthwall"` fails at config load with a
 * message naming the alternatives — rather than at runtime, on the first
 * invoice, as a missing function.
 */
export function assertCommerceRoles(commerce: CommerceConfig | undefined): void {
  if (!commerce) return;

  const known = (provider: CommerceProvider) => {
    if (!PROVIDER_ROLES[provider]) {
      throw new AstroidConfigError(
        `Unknown commerce provider ${JSON.stringify(provider)} (expected ${Object.keys(PROVIDER_ROLES).join(" | ")})`,
      );
    }
  };

  const check = (role: CommerceRole, provider: CommerceProvider | undefined) => {
    if (!provider) return;
    known(provider);
    if (!PROVIDER_ROLES[provider].includes(role)) {
      const able = (Object.keys(PROVIDER_ROLES) as CommerceProvider[]).filter((p) =>
        PROVIDER_ROLES[p].includes(role),
      );
      const missing = {
        storefront: "catalog",
        invoicing: "invoicing",
        pos: "locations/inventory",
      }[role];
      throw new AstroidConfigError(
        `commerce: ${provider} can't serve the "${role}" role — its louise-toolkit client has no ${missing} API. Providers that can: ${able.join(", ")}.`,
      );
    }
  };

  // The shorthand assigns itself to a role it can serve, so it only has to be a
  // provider we know about.
  if (commerce.provider) known(commerce.provider);
  check("storefront", commerce.storefront);
  check("invoicing", commerce.invoicing);
  check("pos", commerce.pos);

  // `square.locations` only means something if Square is actually in play.
  // Silently ignoring it would let a typo'd config look like it had opted into
  // multi-location when nothing reads the setting.
  if (commerce.square && !astroidCommerceProviders(commerce).includes("square")) {
    throw new AstroidConfigError(
      'commerce.square is set but no role is assigned to Square. Assign it to "storefront", "invoicing" or "pos", or drop the square block.',
    );
  }
}
