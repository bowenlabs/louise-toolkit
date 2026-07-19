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
  /** Cloudflare Email Sending — magic-link + notification email. */
  EMAIL: SendEmail;
  /** Static assets (bound by the @astrojs/cloudflare adapter). */
  ASSETS: Fetcher;
  /** Signs Better Auth sessions (`wrangler secret put SESSION_SECRET`). */
  SESSION_SECRET: string;
  /** First editor's email — seeded as an admin, then part of the DB allowlist. */
  OWNER_EMAIL: string;
  /** Optional second bootstrap editor (e.g. your engineer). */
  ENGINEER_EMAIL?: string;
  /** `from` address for outbound email. */
  MAIL_FROM: string;
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
