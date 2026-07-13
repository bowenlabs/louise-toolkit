/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { EmailSender } from "louise/email";

// Cloudflare *bindings* this Worker exposes (see wrangler.jsonc), read via
// `import { env } from "cloudflare:workers"`. The string config (SQUARE_*,
// FROM_EMAIL) is typed + validated by the astro:env schema instead — see
// astro.config.mjs, consumed via `astro:env/server`.
type CloudflareEnv = {
  /** Demo orders (nightly-reset). */
  SANDBOX_DB: D1Database;
  /** Per-IP rate limiter. */
  RL: KVNamespace;
  /** Cloudflare Email Sending binding (louise/email). */
  EMAIL: EmailSender;
  /** Static assets fetcher (Astro adapter). */
  ASSETS: Fetcher;
};
