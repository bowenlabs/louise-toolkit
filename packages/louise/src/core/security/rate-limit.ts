// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Lightweight KV-backed fixed-window rate limiter for a site's public POST
// surfaces (magic-link sign-in, contact/inquiry actions, checkout, …). No
// dedicated rate-limit service — just the KV binding with a per-window counter,
// keyed by whatever the caller passes (typically client IP). Intentionally simple:
//
//   - Fixed window (not sliding): a bucket per `floor(now / window)`. Good
//     enough to blunt abuse; a determined attacker could get up to ~2x the
//     limit across a window boundary, which is acceptable here.
//   - KV has no atomic increment, so a get→put race can undercount under a
//     burst. That only ever lets a few *extra* requests through — it never
//     wrongly blocks — so it fails safe for legitimate users.
//   - **Fails open**: any KV error returns `ok: true`. A limiter outage must
//     never take down sign-in or the contact form.
//
// The *rules* (which routes, which budgets) are site policy — a site defines its
// own `RateRule[]` and passes it to `matchRateRule`. Only the mechanism lives here.

import type { KVLike } from "./types";

export type { KVLike };

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the current window resets (for Retry-After). */
  retryAfter: number;
}

/**
 * Consume one unit against `key`'s current window. `windowSec` must be ≥ 60
 * (KV's minimum TTL). Returns `ok: false` once `limit` is reached.
 */
export async function rateLimit(
  kv: KVLike,
  key: string,
  limit: number,
  windowSec: number,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const sec = Math.floor(now / 1000);
  const windowStart = sec - (sec % windowSec);
  const retryAfter = windowStart + windowSec - sec;
  const bucket = `rl:${key}:${windowStart}`;
  try {
    const current = Number((await kv.get(bucket)) ?? 0) || 0;
    if (current >= limit) return { ok: false, remaining: 0, retryAfter };
    // TTL covers the window plus a small buffer so the counter self-expires.
    await kv.put(bucket, String(current + 1), { expirationTtl: windowSec + 10 });
    return { ok: true, remaining: limit - current - 1, retryAfter };
  } catch {
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}

/** A limited route: matched on method + pathname, with its own budget. */
export interface RateRule {
  name: string;
  method: string;
  /** Exact path or a prefix test. */
  match: (path: string) => boolean;
  limit: number;
  windowSec: number;
}

/**
 * First matching rule for a request, or null. The site owns the `rules` array
 * (its own routes + budgets); pass it in. Editor endpoints are usually
 * session-gated and omitted so the editor can never lock itself out.
 */
export function matchRateRule(
  rules: readonly RateRule[],
  method: string,
  path: string,
): RateRule | null {
  for (const rule of rules) {
    if (rule.method === method && rule.match(path)) return rule;
  }
  return null;
}
