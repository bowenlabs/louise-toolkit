/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// The Cloudflare bindings this Worker exposes (wrangler.jsonc), read via
// `import { env } from "cloudflare:workers"`. Astroid generated the wrangler
// bindings; this is the type over them. Add a binding here when you add one to
// wrangler.jsonc (e.g. AI, a Queue, a Durable Object).
type CloudflareEnv = {
  /** D1 — pages / site_settings / media / inquiries + the Better Auth tables. */
  DB: D1Database;
  /** R2 — uploaded media, streamed back through the Worker at MEDIA_URL. */
  MEDIA: R2Bucket;
  /** Public base for media URLs (the framework-agnostic media route reads this). */
  MEDIA_URL: string;
  /** Cloudflare Images — upload dimensions + server-side transforms. */
  IMAGES: ImagesBinding;
  /** KV — the security rate limiter. */
  RL: KVNamespace;
  /** KV — the autosave draft write-buffer (optional; falls back to direct D1). */
  DRAFTS?: KVNamespace;
  /**
   * Cloudflare Email Sending — magic-link + notification email. Typed as the
   * toolkit's `EmailSender`, i.e. the modern object-form `send({to, from, …})`
   * API. NOT workers-types' `SendEmail`, which is the legacy `cloudflare:email`
   * binding: that one routes through Email Routing and can only deliver to
   * *verified* destination addresses.
   */
  EMAIL: import("louise-toolkit/email").EmailSender;
  /** Static assets (bound by the @astrojs/cloudflare adapter). */
  ASSETS: Fetcher;
  /**
   * Signs Better Auth sessions (`wrangler secret put SESSION_SECRET`). A
   * Secrets Store binding works here too — Louise reads either shape.
   */
  SESSION_SECRET: string;
  /**
   * Turnstile secret. Scaffolded with the DUMMY_REPLACE_ME sentinel, which
   * reads as "not configured" — captcha stays off until this AND a real
   * (non-test) site key are both set, so half-provisioning can't lock you out.
   */
  TURNSTILE_SECRET?: string;
  /** Public Turnstile site key; the always-passing test key keeps captcha off. */
  TURNSTILE_SITE_KEY?: string;
  /** First editor's email — seeded as an admin, then part of the DB allowlist. */
  OWNER_EMAIL: string;
  /** Optional second bootstrap editor (e.g. your engineer). */
  ENGINEER_EMAIL?: string;
  /** `from` address for outbound email. */
  MAIL_FROM: string;__ASTROID_ENV_BINDINGS__
};

// `env` from `cloudflare:workers` is typed as the augmentable `Cloudflare.Env`.
declare namespace Cloudflare {
  interface Env extends CloudflareEnv {}
}

// Middleware sets these; bindings themselves come from `cloudflare:workers`.
declare namespace App {
  interface Locals {
    /** Resolved editor session (authorizes writes). Null when not signed in. */
    editor: import("louise-toolkit/auth").EditorSession | null;
    /** Whether the page should render edit affordances. */
    editMode: boolean;
  }
}
