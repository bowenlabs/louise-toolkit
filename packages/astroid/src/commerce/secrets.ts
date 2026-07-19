// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// What each commerce provider needs before it can do anything, and the gate
// derived from it.
//
// The rest of this module is deliberately credential-free — the adapters are
// pure, the mirror and the loader only touch D1, and `verifyCheckout` takes a
// price lookup rather than a token. That's the right shape: it keeps the parts
// testable and lets the caller own how the fetch happens.
//
// But something still has to answer "is commerce actually on?", and every
// consuming site answered it by hand, differently. Squaring that away here is
// the commerce half of the dormant-until-provisioned convention (#252): the
// names below are the single source of truth for what a provider requires, so
// the wrangler generator can seed them, `astroid doctor` can report them, and a
// storefront can decide between a live catalog and a simulated one — all from
// one declaration instead of three hand-maintained lists.
//
// The webhook secret lives here too, rather than beside the verifier in
// `queues/scaffold.ts`, because it is the same fact: a provider's secret set.
// The scaffold imports it from here so the two can't drift.

import type { CommerceConfig, CommerceProvider } from "../config.js";
import { type ModuleSecrets, resolveModuleSecrets, type SecretSource } from "../secrets.js";
import { astroidCommerceProviders, astroidCommerceRoles } from "./roles.js";

/**
 * Per-provider secret names, split by what they gate.
 *
 * `credentials` is what the provider's `louise-toolkit/commerce/*` client needs
 * to make a call at all; `webhook` is the signing secret its receiver verifies
 * with. They're separable on purpose — a site can receive verified webhooks
 * before it has finished provisioning API access, and the reverse is the normal
 * state of a brand-new integration.
 *
 * Names match what the scaffolded `env.d.ts` declares, so a project can read
 * `env.SQUARE_ACCESS_TOKEN` and have it typed.
 */
export const COMMERCE_PROVIDER_SECRETS: Record<
  CommerceProvider,
  { readonly credentials: readonly string[]; readonly webhook: string }
> = {
  // The location id is not a secret, but it IS required: Square's orders and
  // payments endpoints refuse a request without one, so a token on its own
  // leaves checkout broken rather than dormant. Requiring both is what makes
  // "configured" mean "can actually take money".
  square: {
    credentials: ["SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID"],
    webhook: "SQUARE_WEBHOOK_SECRET",
  },
  stripe: {
    credentials: ["STRIPE_SECRET_KEY"],
    webhook: "STRIPE_WEBHOOK_SECRET",
  },
  // Fourthwall's storefront token is public-safe (it's sent as a query param
  // from the browser in their own SDK), but it is still provisioned, so it
  // follows the same gate — an absent token means no catalog.
  fourthwall: {
    credentials: ["FOURTHWALL_STOREFRONT_TOKEN"],
    webhook: "FOURTHWALL_WEBHOOK_SECRET",
  },
};

/**
 * Where a developer actually gets each provider's credentials.
 *
 * Carried next to the names because the scaffold's job is to leave someone able
 * to finish provisioning without a search: a `.env.example` line that says
 * `SQUARE_ACCESS_TOKEN=DUMMY_REPLACE_ME` and nothing else has told them what to
 * do, only that something is missing.
 */
export const COMMERCE_PROVIDER_SETUP: Record<CommerceProvider, string> = {
  square:
    "developer.squareup.com → your app → Credentials (access token) and Locations (location id). Webhook secret: the same app → Webhooks → Subscriptions.",
  stripe:
    "dashboard.stripe.com → Developers → API keys (secret key). Webhook secret: Developers → Webhooks → your endpoint → Signing secret.",
  fourthwall:
    "Fourthwall dashboard → Settings → For developers → Storefront token. Webhook secret: the same page → Webhooks.",
};

/**
 * Every secret name this project's commerce configuration needs, deduplicated
 * and in a stable order.
 *
 * Deduplication is the point: a site running Square in both roles has one
 * access token, not two, and seeding `SQUARE_ACCESS_TOKEN` twice into a
 * `.dev.vars` would be a bug rather than a redundancy.
 */
export function commerceSecretNames(commerce: CommerceConfig | undefined): string[] {
  const names = astroidCommerceProviders(commerce).flatMap((provider) => [
    ...COMMERCE_PROVIDER_SECRETS[provider].credentials,
    COMMERCE_PROVIDER_SECRETS[provider].webhook,
  ]);
  return [...new Set(names)];
}

/** One provider's resolved gate. */
export interface ProviderStatus {
  provider: CommerceProvider;
  /** Which role(s) this provider fills for the project. */
  roles: ("storefront" | "invoicing")[];
  /** API credentials — false means no live call can be made. */
  credentials: ModuleSecrets<string>;
  /** Webhook signing secret — false means the receiver answers 503. */
  webhook: ModuleSecrets<string>;
  /** True only when both halves resolved. */
  configured: boolean;
}

/** The whole commerce module's gate, per provider. */
export interface CommerceStatus {
  /** True when the project has commerce configured AND every provider is live. */
  configured: boolean;
  /** True when the project declares no commerce at all — not the same as dormant. */
  enabled: boolean;
  providers: ProviderStatus[];
  /** Every unprovisioned secret name across all providers, in declaration order. */
  missing: string[];
}

/** Read one provider's secrets off an env-shaped record. */
async function resolveProvider(
  provider: CommerceProvider,
  roles: ("storefront" | "invoicing")[],
  env: Record<string, SecretSource>,
): Promise<ProviderStatus> {
  const spec = COMMERCE_PROVIDER_SECRETS[provider];
  const pick = (names: readonly string[]) =>
    Object.fromEntries(names.map((n) => [n, env[n]])) as Record<string, SecretSource>;

  const [credentials, webhook] = await Promise.all([
    resolveModuleSecrets(pick(spec.credentials)),
    resolveModuleSecrets(pick([spec.webhook])),
  ]);

  return {
    provider,
    roles,
    credentials,
    webhook,
    configured: credentials.configured && webhook.configured,
  };
}

/**
 * Resolve the commerce module's dormancy from the runtime env.
 *
 * ```ts
 * const status = await resolveCommerceStatus(config.commerce, env);
 * const products = status.configured
 *   ? await syncThenRead(env)          // live
 *   : await readCatalog({ db: env.DB, table });  // whatever the mirror already holds
 * ```
 *
 * Note what "dormant" means for commerce specifically: the D1 mirror is still
 * readable, so an unprovisioned storefront serves the catalog it last synced
 * (usually the seeded sample rows) rather than an error page. That is the whole
 * reason the mirror exists as a separate layer from the provider client.
 */
export async function resolveCommerceStatus(
  commerce: CommerceConfig | undefined,
  env: Record<string, SecretSource>,
): Promise<CommerceStatus> {
  const roles = astroidCommerceRoles(commerce);
  const providers = astroidCommerceProviders(commerce);

  if (providers.length === 0) {
    return { configured: false, enabled: false, providers: [], missing: [] };
  }

  const resolved = await Promise.all(
    providers.map((provider) =>
      resolveProvider(
        provider,
        (["storefront", "invoicing"] as const).filter((r) => roles[r] === provider),
        env,
      ),
    ),
  );

  return {
    configured: resolved.every((p) => p.configured),
    enabled: true,
    providers: resolved,
    missing: resolved.flatMap((p) => [...p.credentials.missing, ...p.webhook.missing]),
  };
}
