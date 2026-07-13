/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { EmailSender } from "louise/email";

// Bindings this Worker exposes (see wrangler.jsonc). Read via
// `import { env } from "cloudflare:workers"`.
type CloudflareEnv = {
  /** Demo orders (nightly-reset). */
  SANDBOX_DB: D1Database;
  /** Per-IP rate limiter. */
  RL: KVNamespace;
  /** Cloudflare Email Sending binding (louise/email). */
  EMAIL: EmailSender;
  /** Square sandbox access token (secret — `wrangler secret put SQUARE_TOKEN`). */
  SQUARE_TOKEN: string;
  /** Public Square sandbox application id. */
  SQUARE_APP_ID: string;
  /** Square sandbox location id. */
  SQUARE_LOCATION: string;
  /** "sandbox" | "production". */
  SQUARE_ENV: "sandbox" | "production";
  /** Confirmation-email From address (onboarded sending domain). */
  FROM_EMAIL: string;
  /** Static assets fetcher (Astro adapter). */
  ASSETS: Fetcher;
};
