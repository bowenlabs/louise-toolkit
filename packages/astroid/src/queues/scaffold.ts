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

import type { AstroidConfig, CommerceProvider } from "../config.js";
import { ASTROID_QUEUE_BINDING } from "./messages.js";

/** Per-provider webhook facts: the header, the verifier, and how it's called. */
const PROVIDERS: Record<
  CommerceProvider,
  {
    module: string;
    verifier: string;
    header: string;
    /** The verifier call, given `secret` in scope. */
    call: string;
    /** Secrets Store binding holding the signing secret. */
    secretBinding: string;
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
    secretBinding: "SQUARE_WEBHOOK_SECRET",
    note: "Square signs `notificationUrl + body`, so url.href must match the endpoint you registered.",
  },
  stripe: {
    module: "louise-toolkit/commerce/stripe",
    verifier: "verifyStripeSignature",
    header: "stripe-signature",
    // Stripe's header carries a timestamp; the verifier rejects replays outside
    // its tolerance, so it needs the current time.
    call: 'verifyStripeSignature(raw, headers.get(HEADER) ?? "", secret, Math.floor(Date.now() / 1000))',
    secretBinding: "STRIPE_WEBHOOK_SECRET",
    note: "Stripe's signature is timestamped — the verifier rejects replays outside a 5-minute tolerance.",
  },
  fourthwall: {
    module: "louise-toolkit/commerce/fourthwall",
    verifier: "verifyFourthwallSignature",
    header: "x-fourthwall-hmac-sha256",
    call: "verifyFourthwallSignature(raw, headers.get(HEADER), secret)",
    secretBinding: "FOURTHWALL_WEBHOOK_SECRET",
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
  if (!config.commerce) return "";
  const p = PROVIDERS[config.commerce.provider];
  return [
    "  /** Queue producer — verified webhooks + the cron re-sync (src/queue.ts). */",
    '  COMMERCE_QUEUE: Queue<import("astroidjs").AstroidQueueMessage>;',
    `  /** ${config.commerce.provider} webhook signing secret. Seeded with the`,
    "   *  DUMMY_REPLACE_ME sentinel, which reads as unconfigured — the receiver",
    "   *  answers 503 until it holds a real value. */",
    `  ${p.secretBinding}?: string;`,
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
  const provider = config.commerce?.provider;
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
      ? `      // TODO: re-sync the ${provider} catalog into D1 / cache. Until the`
      : "      // TODO: re-sync whatever this project mirrors from an external source.",
    provider ? "      // commerce module lands, this is a no-op." : "",
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
export function generateAstroidWebhookRoute(config: AstroidConfig): string | null {
  const provider = config.commerce?.provider;
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
    `    secret: await readModuleSecret(env.${p.secretBinding}),`,
    `    queue: env.${ASTROID_QUEUE_BINDING},`,
    `    verify: ({ raw, secret }) => ${p.call},`,
    "  });",
    "};",
    "",
  ].join("\n");
}
