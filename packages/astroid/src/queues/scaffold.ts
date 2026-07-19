// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The two SCAFFOLD-ONCE files the queue pipeline needs: the consumer seam
// (`src/queue.ts`) and the provider webhook receiver.
//
// Deliberately not part of the regenerated trio. Both exist to be edited — the
// consumer is where a project says what a catalog refresh actually does, and the
// webhook route is where it narrows which events it cares about. Regenerating
// over them would erase exactly the work they're for. The same boundary
// `generateAstroidWrangler` already lives on.

import { astroidCatalogMirror } from "../commerce/mirror.js";
import { astroidCommerceProviders, astroidCommerceRoles } from "../commerce/roles.js";
import { COMMERCE_PROVIDER_SECRETS } from "../commerce/secrets.js";
import type { AstroidConfig, CommerceProvider } from "../config.js";
import { ASTROID_QUEUE_BINDING } from "./messages.js";

/**
 * Per-provider webhook facts: the header, the verifier, and how it's called.
 *
 * The signing-secret NAME is deliberately not here — it's one field of a
 * provider's secret set, which `commerce/secrets.ts` owns so the wrangler
 * generator, the status report, and this scaffold all read the same list.
 */
const PROVIDERS: Record<
  CommerceProvider,
  {
    module: string;
    verifier: string;
    header: string;
    /** The verifier call, given `secret` in scope. */
    call: string;
    note: string;
  }
> = {
  square: {
    module: "louise-toolkit/commerce/square",
    verifier: "verifySquareSignature",
    header: "x-square-hmacsha256-signature",
    // Square signs the notification URL CONCATENATED with the body, so the URL
    // has to match what's configured in the Square dashboard exactly.
    call: "verifySquareSignature(url.href, raw, headers.get(HEADER), secret)",
    note: "Square signs `notificationUrl + body`, so url.href must match the endpoint you registered.",
  },
  stripe: {
    module: "louise-toolkit/commerce/stripe",
    verifier: "verifyStripeSignature",
    header: "stripe-signature",
    // Stripe's header carries a timestamp; the verifier rejects replays outside
    // its tolerance, so it needs the current time.
    call: 'verifyStripeSignature(raw, headers.get(HEADER) ?? "", secret, Math.floor(Date.now() / 1000))',
    note: "Stripe's signature is timestamped — the verifier rejects replays outside a 5-minute tolerance.",
  },
  fourthwall: {
    module: "louise-toolkit/commerce/fourthwall",
    verifier: "verifyFourthwallSignature",
    header: "x-fourthwall-hmac-sha256",
    call: "verifyFourthwallSignature(raw, headers.get(HEADER), secret)",
    note: "Fourthwall signs the raw body only.",
  },
};

/**
 * The extra `CloudflareEnv` members the queue pipeline introduces, as a block
 * `create-astroid` substitutes into the scaffolded `src/env.d.ts`.
 *
 * Substituted rather than always present because a declaration is a promise: a
 * marketing site that types `COMMERCE_QUEUE` is claiming a binding its
 * `wrangler.jsonc` never creates, and the first `env.COMMERCE_QUEUE.send()`
 * someone writes against that type fails at runtime with the type system's
 * blessing. Empty string when the project runs no consumer.
 */
export function generateAstroidEnvBindings(config: AstroidConfig): string {
  const providers = astroidCommerceProviders(config.commerce);
  if (providers.length === 0) return "";
  return [
    "  /** Queue producer — verified webhooks + the cron re-sync (src/queue.ts). */",
    '  COMMERCE_QUEUE: Queue<import("astroidjs").AstroidQueueMessage>;',
    // One secret SET per provider: a site running Stripe for invoicing and
    // Fourthwall for the storefront talks to both, credentialed and signed
    // independently. Every one is optional, because every one is allowed to be
    // absent — that's what leaves the module dormant rather than broken.
    ...providers.flatMap((provider) => [
      `  /** ${provider} API credentials. Absent or still holding the`,
      "   *  DUMMY_REPLACE_ME sentinel reads as unconfigured, which leaves commerce",
      "   *  dormant: the D1 mirror still serves, nothing calls upstream. */",
      ...COMMERCE_PROVIDER_SECRETS[provider].credentials.map((name) => `  ${name}?: string;`),
      `  /** ${provider} webhook signing secret. Until it holds a real value the`,
      "   *  receiver answers 503, so the provider keeps retrying and events",
      "   *  delivered before you provisioned it still land afterwards. */",
      `  ${COMMERCE_PROVIDER_SECRETS[provider].webhook}?: string;`,
    ]),
  ].join("\n");
}

/**
 * `src/queue.ts` — the consumer seam the generated worker imports.
 *
 * `astroidQueueHandler` already owns the dispatch every site wrote (periodic
 * refresh, catalog-affecting webhook, no-op for everything else); what's left
 * for the project is what "refresh" means, which is why this is a file and not
 * a generated constant.
 */
export function generateAstroidQueueSeam(config: AstroidConfig): string {
  // The STOREFRONT provider — it's the one with a catalog to re-sync. An
  // invoicing-only provider has nothing for this hook to do.
  const provider = astroidCommerceRoles(config.commerce).storefront;
  const table = astroidCatalogMirror(config).table;
  return [
    "// The queue consumer — what each message actually does.",
    "//",
    "// Scaffolded once; yours to edit. `astroidQueueHandler` owns the dispatch",
    "// (a periodic refresh and any catalog-affecting webhook trigger a re-sync;",
    "// everything else acks as a no-op), so what's left here is what a refresh",
    "// MEANS for this project.",
    "//",
    "// Throwing marks the message for retry. That's usually right — a failed",
    "// refresh means the site is serving stale data — and Cloudflare routes it to",
    "// the DLQ once it exceeds max_retries (wrangler.jsonc).",
    'import { astroidQueueHandler, type AstroidQueueMessage } from "astroidjs";',
    "",
    "export async function handleQueueMessage(",
    "  env: CloudflareEnv,",
    "  message: AstroidQueueMessage,",
    "): Promise<void> {",
    "  await astroidQueueHandler({",
    "    refreshCatalog: async () => {",
    provider
      ? `      // TODO: fetch the ${provider} catalog, normalize each item with`
      : "      // TODO: fetch your catalog and normalize each item to a CatalogItem,",
    provider
      ? `      // ${provider}ToCatalogItem, then hand the array to astroidCatalogSync:`
      : "      // then hand the array to astroidCatalogSync:",
    "      //",
    `      //   const items = (await listCatalog(token)).map(${provider ?? "provider"}ToCatalogItem);`,
    `      //   await astroidCatalogSync(items, { db: env.DB, table: ${JSON.stringify(table)} });`,
    "      //",
    "      // The sync is idempotent (keyed on the provider's id) and never",
    "      // writes an owner-edited column, so it's safe to run on every event.",
    "      void env;",
    "    },",
    "  })(message);",
    "}",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * The provider webhook receiver — `src/pages/api/webhooks/<provider>.ts`.
 *
 * Thin on purpose: `handleWebhook` owns the ordering (verify the raw body before
 * parsing) and the status-code contract (which codes ask the provider to retry
 * and which tell it to stop). What's here is the provider's own header and
 * verifier, plus the secret read.
 *
 * Returns null when the project has no commerce provider — nothing to receive.
 */
export function generateAstroidWebhookRoute(
  config: AstroidConfig,
  forProvider?: CommerceProvider,
): string | null {
  const provider = forProvider ?? astroidCommerceProviders(config.commerce)[0];
  if (!provider) return null;
  const p = PROVIDERS[provider];

  return [
    `// ${provider[0].toUpperCase()}${provider.slice(1)} webhook receiver.`,
    "//",
    "// Scaffolded once; yours to edit. The order is the important part and",
    "// `handleWebhook` owns it: the raw body is verified BEFORE anything parses",
    "// it, then the event is enqueued and this returns immediately. The consumer",
    "// (src/queue.ts) does the actual work, with Cloudflare owning retries + DLQ.",
    "//",
    `// ${p.note}`,
    "//",
    "// Unprovisioned (the secret is absent or still the placeholder) answers 503,",
    "// which keeps the provider retrying — so events delivered before you set the",
    "// secret land afterwards instead of being lost.",
    'import type { APIRoute } from "astro";',
    'import { handleWebhook, readModuleSecret } from "astroidjs";',
    'import { env } from "cloudflare:workers";',
    `import { ${p.verifier} } from ${JSON.stringify(p.module)};`,
    "",
    "export const prerender = false;",
    "",
    `const HEADER = ${JSON.stringify(p.header)};`,
    "",
    "export const POST: APIRoute = async ({ request, url }) => {",
    "  const headers = request.headers;",
    "  return handleWebhook(request, url, {",
    `    provider: ${JSON.stringify(provider)},`,
    `    secret: await readModuleSecret(env.${COMMERCE_PROVIDER_SECRETS[provider].webhook}),`,
    `    queue: env.${ASTROID_QUEUE_BINDING},`,
    `    verify: ({ raw, secret }) => ${p.call},`,
    "  });",
    "};",
    "",
  ].join("\n");
}

/**
 * Every webhook receiver this project needs, as `{ path, contents }`.
 *
 * Plural because roles are: a site running Stripe for invoicing beside
 * Fourthwall for the storefront receives from both, each with its own signing
 * secret and header. One route per provider, not per role — a provider filling
 * two roles still has one endpoint and one secret.
 */
export function generateAstroidWebhookRoutes(
  config: AstroidConfig,
): { path: string; contents: string }[] {
  return astroidCommerceProviders(config.commerce).flatMap((provider) => {
    const contents = generateAstroidWebhookRoute(config, provider);
    return contents ? [{ path: `src/pages/api/webhooks/${provider}.ts`, contents }] : [];
  });
}
