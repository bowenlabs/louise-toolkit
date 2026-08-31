// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Durable-Object rate limiter — the only *atomic* counter available on Workers.
//
// `security/rate-limit` (KV) and Cloudflare's native Rate Limiting binding are
// both permissive and eventually consistent: a read→write gap can undercount
// under a burst, and the native binding's budget is per-location, so an attacker
// spreading across colos gets one budget per colo. That is fine for blunting
// form spam. It is weak for the auth surface, which is why this exists.
//
// A Durable Object handles one request at a time, so read-decide-write inside it
// IS atomic — no CAS, no Lua, no races. One object per key (the caller derives
// the id from the key), so no single object becomes the global bottleneck; a DO
// sustains roughly 500–1,000 simple operations per second, which is a per-key
// ceiling here rather than a per-site one.
//
// Following the `louise-toolkit/realtime` and `louise-toolkit/workflows` pattern,
// the SITE owns the `DurableObject` subclass and the wrangler binding (only it
// imports `cloudflare:workers`); this module provides the logic the subclass
// delegates to. Runtime types are ambient (@cloudflare/workers-types), so nothing
// runtime-only is imported here.
//
//   // site worker.ts — owns the class + the wrangler `durable_objects` binding:
//   import { DurableObject } from "cloudflare:workers";
//   import { createRateLimiter } from "louise-toolkit/security";
//   export class RateLimitDO extends DurableObject<Env> {
//     #rl = createRateLimiter(this.ctx);
//     fetch(request: Request) { return this.#rl.fetch(request); }
//     alarm() { return this.#rl.alarm(); }
//   }
//
//   // and where the limit is consumed (e.g. Better Auth's rateLimit.customStorage):
//   durableRateLimitStorage(env.RATE_LIMIT_DO)

/** One consume decision. Mirrors Better Auth's `BetterAuthRateLimitStorage`. */
export interface DurableRateLimitResult {
  allowed: boolean;
  /** Seconds until the window frees up. `null` while allowed. */
  retryAfter: number | null;
}

/** The budget a single consume is measured against. */
export interface DurableRateLimitRule {
  /** Window length in seconds. */
  window: number;
  /** Requests permitted per window. */
  max: number;
}

/** What the site's `DurableObject` subclass delegates to. */
export interface RateLimiter {
  fetch(request: Request): Promise<Response>;
  /** Clears the counter once its window has passed, so an idle key stops
   *  occupying storage. Wire this to the subclass's `alarm()`. */
  alarm(): Promise<void>;
}

/** Persisted counter. One per object, because one object serves one key. */
interface CounterState {
  count: number;
  /** Absolute epoch-ms at which the window ends. */
  resetAt: number;
}

const STORAGE_KEY = "counter";

/**
 * The DO-side logic: a fixed-window counter that is genuinely atomic because the
 * runtime serializes calls into a single object.
 *
 * Fixed window rather than sliding, matching `security/rate-limit`: a client can
 * get up to ~2x the budget across a window boundary, which is an accepted cost
 * for a counter that is one number instead of a list of timestamps.
 */
export function createRateLimiter(
  ctx: DurableObjectState,
  now: () => number = Date.now,
): RateLimiter {
  const consume = async (rule: DurableRateLimitRule): Promise<DurableRateLimitResult> => {
    const at = now();
    const windowMs = Math.max(rule.window, 1) * 1000;
    const state = await ctx.storage.get<CounterState>(STORAGE_KEY);

    // Absent or expired: start a fresh window at 1.
    if (!state || at >= state.resetAt) {
      const resetAt = at + windowMs;
      await ctx.storage.put(STORAGE_KEY, { count: 1, resetAt } satisfies CounterState);
      // Reap the counter shortly after its window ends. Without this an object
      // keyed by client IP would keep a few bytes forever, per IP, per site.
      await ctx.storage.setAlarm(resetAt + 1000);
      return { allowed: true, retryAfter: null };
    }

    // Inside the window and already at budget. `resetAt` is NOT extended — the
    // window must end when it was scheduled to, or a client under sustained load
    // would never be let back in.
    if (state.count >= rule.max) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((state.resetAt - at) / 1000)) };
    }

    await ctx.storage.put(STORAGE_KEY, { ...state, count: state.count + 1 });
    return { allowed: true, retryAfter: null };
  };

  return {
    async fetch(request) {
      let rule: DurableRateLimitRule;
      try {
        const body = (await request.json()) as Partial<DurableRateLimitRule>;
        const window = Number(body?.window);
        const max = Number(body?.max);
        if (!Number.isFinite(window) || !Number.isFinite(max) || window <= 0 || max <= 0) {
          return Response.json(
            { error: "window and max must be positive numbers" },
            { status: 400 },
          );
        }
        rule = { window, max };
      } catch {
        return Response.json({ error: "expected a JSON body" }, { status: 400 });
      }
      return Response.json(await consume(rule));
    },
    async alarm() {
      // Only reap if the window really has passed: an alarm can fire late, and a
      // newer window may have been opened since it was set.
      const state = await ctx.storage.get<CounterState>(STORAGE_KEY);
      if (!state || now() >= state.resetAt) await ctx.storage.delete(STORAGE_KEY);
      else await ctx.storage.setAlarm(state.resetAt + 1000);
    },
  };
}

/** The subset of a Durable Object namespace binding this needs. Declared
 *  structurally so the real binding satisfies it without a hard dependency on
 *  `@cloudflare/workers-types`. */
export interface RateLimitNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

/** A `consume` function shaped for Better Auth's `rateLimit.customStorage`. */
export interface DurableRateLimitStorage {
  consume(key: string, rule: DurableRateLimitRule): Promise<DurableRateLimitResult>;
}

/**
 * Consume against the DO for `key`, one object per key.
 *
 * **Fails open**, like `security/rate-limit`: any transport error allows the
 * request. A limiter outage must never take down sign-in — the alternative is an
 * unreachable DO locking every editor out of their own site.
 */
export function durableRateLimitStorage(ns: RateLimitNamespace): DurableRateLimitStorage {
  return {
    consume: async (key, rule) => {
      try {
        const stub = ns.get(ns.idFromName(key));
        // A whole Request rather than (url, init): a DO stub's `fetch` accepts
        // both, but the one-argument form is the shape this module declares, and
        // keeping the declared surface minimal is what lets the binding satisfy
        // it structurally without depending on @cloudflare/workers-types.
        const res = await stub.fetch(
          new Request("https://rate-limit.louise/consume", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ window: rule.window, max: rule.max }),
          }),
        );
        if (!res.ok) return { allowed: true, retryAfter: null };
        const body = (await res.json()) as Partial<DurableRateLimitResult>;
        // Only a definite `false` blocks; an unreadable answer is not a block.
        if (body?.allowed === false) {
          const retryAfter = Number(body.retryAfter);
          return {
            allowed: false,
            retryAfter: Number.isFinite(retryAfter) ? retryAfter : rule.window,
          };
        }
        return { allowed: true, retryAfter: null };
      } catch {
        return { allowed: true, retryAfter: null };
      }
    },
  };
}
