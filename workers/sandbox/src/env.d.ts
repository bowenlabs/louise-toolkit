/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { EmailSender } from "louise-toolkit/email";
import type { RateLimiterBinding } from "louise-toolkit/security";

// Cloudflare *bindings* this Worker exposes (see wrangler.jsonc), read via
// `import { env } from "cloudflare:workers"`. The string config (SQUARE_*,
// FROM_EMAIL) is typed + validated by the astro:env schema instead — see
// astro.config.mjs, consumed via `astro:env/server`.
type CloudflareEnv = {
  /** Demo orders (nightly-reset). */
  SANDBOX_DB: D1Database;
  /** Per-IP daily rate-limit budget (KV counter). */
  RL: KVNamespace;
  /** Native in-colo burst guard on the pay/email surface (see wrangler.jsonc
   *  `ratelimits`). Optional — checkout falls back to the KV budget without it. */
  RATE_LIMIT?: RateLimiterBinding;
  /** Cloudflare Email Sending binding (louise-toolkit/email). */
  EMAIL: EmailSender;
  /** Static assets fetcher (Astro adapter). */
  ASSETS: Fetcher;
};
