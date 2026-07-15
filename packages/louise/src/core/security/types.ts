// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Shared binding-contract types for the Louise security primitives. Each
// primitive takes its binding explicitly (rather than reaching for an ambient
// `Env`), so a site stays free to name its bindings whatever it likes; these
// interfaces just pin the *shape* Louise depends on.

/** The subset of a Cloudflare Secrets Store binding Louise reads. */
export interface SecretBinding {
  get(): Promise<string>;
}

/**
 * Minimal Workers KV shape the rate limiter needs — `get` + `put` with a TTL.
 * Declared structurally so the real `KVNamespace` (from `@cloudflare/workers-types`)
 * satisfies it without a hard dependency on those types.
 */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * The subset of Cloudflare's native Rate Limiting binding Louise uses. Unlike
 * the KV limiter, the budget (limit + period) is fixed in wrangler config on
 * the binding itself — at runtime you only pass a `key`, and the response is
 * just `{ success }` (no remaining/retryAfter). It's in-colo (no round-trip)
 * and cheaper, but permissive/eventually-consistent like KV. Declared
 * structurally so the real binding satisfies it without a hard dependency on
 * `@cloudflare/workers-types`.
 */
export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Either backend the rate limiter accepts: the KV counter (portable, budget set
 * per call) or the native binding (in-colo, budget fixed in config). Callers
 * pass whichever they have — typically `env.RATE_LIMIT ?? env.KV` — so a site
 * gains the native path just by provisioning the binding, and falls back to KV
 * otherwise.
 */
export type RateLimitBackend = KVLike | RateLimiterBinding;

/**
 * Base binding contract the Louise security primitives expect on a Worker's
 * `env`. A site's own `Env` can `extends LouiseEnv`; the auth extraction (#7)
 * widens this into the full `LouiseAuthEnv` surface.
 */
export interface LouiseEnv {
  /** Session-signing secret (Secrets Store). Used by `getSessionSecret`. */
  SESSION_SECRET: SecretBinding;
}
