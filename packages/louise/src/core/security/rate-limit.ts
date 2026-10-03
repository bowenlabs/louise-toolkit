// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Lightweight KV-backed fixed-window rate limiter for a site's public POST
// surfaces (magic-link sign-in, contact/inquiry actions, checkout, …). No
// dedicated rate-limit service—just the KV binding with a per-window counter,
// keyed by whatever the caller passes (typically client IP). Intentionally simple:
//
//   - Fixed window (not sliding): a bucket per `floor(now / window)`. Good
//     enough to blunt abuse; a determined attacker could get up to ~2x the
//     limit across a window boundary, which is acceptable here.
//   - KV has no atomic increment, so a get→put race can undercount under a
//     burst. That only ever lets a few *extra* requests through—it never
//     wrongly blocks, so it fails safe for legitimate users.
//   - **Fails open**: any KV error returns `ok: true`. A limiter outage must
//     never take down sign-in or the contact form. It's reported with
//     `reportDegraded`, so an open limiter doesn't go unnoticed.
//
// The *rules* (which routes, which budgets) are site policy: a site defines its
// own `RateRule[]` and passes it to `matchRateRule`. Only the mechanism lives here.
//
// A site can instead pass Cloudflare's native Rate Limiting binding (any
// `RateLimitBackend`; see `rateLimit` below). That path is in-colo and cheaper
// for the hot abuse-control surfaces, but its budget lives in wrangler config
// (the `limit`/`windowSec` args become advisory) and it only reports a boolean.

import { reportDegraded } from "../degraded.js";
import type { KVLike, RateLimitBackend, RateLimiterBinding } from "./types";

export type { RateLimitBackend };

/** True for the native Rate Limiting binding (has `limit()`); false for KV. */
function isNativeLimiter(backend: RateLimitBackend): backend is RateLimiterBinding {
  return typeof (backend as RateLimiterBinding).limit === "function";
}

// The native binding's period is capped at 60 seconds (Cloudflare only allows 10 or
// 60), and the runtime response carries no reset clock, so on a block we can't
// report the caller's intended `windowSec` (which may be far larger) as
// Retry-After without misleading the client. Cap it at the largest possible
// native window instead—a safe, bounded upper bound.
const NATIVE_MAX_PERIOD_SEC = 60;

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the current window resets (for Retry-After). */
  retryAfter: number;
}

/**
 * Consume one unit against `key`'s current window. Returns `ok: false` once the
 * budget is reached. Fails open on any backend error.
 *
 * The `backend` is either a KV binding or Cloudflare's native Rate Limiting
 * binding:
 *   - **KV**—`windowSec` must be ≥ 60 (KV's minimum TTL); `limit`/`windowSec`
 *     define the budget here, and the result's `remaining`/`retryAfter` are exact.
 *   - **native binding**—the budget lives in wrangler config, so `limit` and
 *     `windowSec` are *advisory* (ignored beyond the key); `remaining` is
 *     best-effort and `retryAfter` is a bounded upper estimate. It's in-colo and
 *     cheaper—preferred for the hot public abuse-control surfaces.
 */
export async function rateLimit(
  backend: RateLimitBackend,
  key: string,
  limit: number,
  windowSec: number,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  if (isNativeLimiter(backend)) {
    try {
      const { success } = await backend.limit({ key: `rl:${key}` });
      return success
        ? { ok: true, remaining: Math.max(0, limit - 1), retryAfter: 0 }
        : { ok: false, remaining: 0, retryAfter: NATIVE_MAX_PERIOD_SEC };
    } catch (err) {
      // Fails open—a limiter outage must never take down sign-in or a form.
      // The key stays out of the report: it's usually a visitor's IP address.
      reportDegraded("security.rateLimit", err, { backend: "native" });
      return { ok: true, remaining: limit, retryAfter: 0 };
    }
  }
  const kv = backend;
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
  } catch (err) {
    reportDegraded("security.rateLimit", err, { backend: "kv" });
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}

/** A limited route: matched on method + pathname, with its own budget. */
export interface RateRule {
  name: string;
  method: string;
  /**
   * Exact path or a prefix test. {@link matchRateRule} calls it with the path
   * as given and with its {@link normalizeRatePath} form, so write it against
   * the canonical path (`p === "/api/checkout"`) and the slashed and encoded
   * spellings of that path match too.
   */
  match: (path: string) => boolean;
  limit: number;
  windowSec: number;
}

// The same bound the router uses before it refuses a request as multiply
// encoded. A path still changing after this many decodes is left as it stands.
const MAX_DECODE_ITERATIONS = 10;
const DUPLICATE_SLASHES = /\/{2,}/g;

/**
 * The canonical form of a request path, for matching rate rules: percent-decoded
 * until it stops changing, with each run of slashes collapsed to one and any
 * trailing slash removed. The root path stays `/`.
 *
 * Routers commonly answer every one of these spellings from one endpoint: a
 * trailing slash is ignored by default, and duplicate slashes and
 * percent-encoded letters are normalized before routes are matched. A rule that
 * tests the raw path for equality misses every other spelling, and the endpoint
 * behind it gets no limit. So `/api//checkout/` and `/api/%63heckout` both
 * normalize to `/api/checkout`.
 *
 * Decoding uses `decodeURI`, so an encoded reserved character such as `%2F`
 * stays encoded and can't turn into a path separator. An invalid escape stops
 * the decoding and keeps what decoded so far.
 */
export function normalizeRatePath(path: string): string {
  let decoded = path;
  for (let i = 0; i < MAX_DECODE_ITERATIONS; i++) {
    let next: string;
    try {
      next = decodeURI(decoded);
    } catch {
      break;
    }
    if (next === decoded) break;
    decoded = next;
  }
  const collapsed = decoded.replace(DUPLICATE_SLASHES, "/");
  return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}

/**
 * First matching rule for a request, or null. The site owns the `rules` array
 * (its own routes + budgets); pass it in. Editor endpoints are usually
 * session-gated and omitted so the editor can never lock itself out.
 *
 * Each rule is tested against `path` as given and against its
 * {@link normalizeRatePath} form, and either one matching is a match. The
 * normalized test means an exact rule for `/api/checkout` also limits
 * `/api/checkout/`, which the router sends to the same endpoint. The test on
 * the path as given keeps a rule written for a slashed path (a site with
 * trailing slashes always on) matching as it did before.
 */
export function matchRateRule(
  rules: readonly RateRule[],
  method: string,
  path: string,
): RateRule | null {
  const normalized = normalizeRatePath(path);
  for (const rule of rules) {
    if (rule.method !== method) continue;
    if (rule.match(path) || (normalized !== path && rule.match(normalized))) return rule;
  }
  return null;
}
