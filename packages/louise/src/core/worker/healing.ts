// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/worker—`withHealing`: self-healing recovery for Worker
// routes.
//
// Louise primitives never throw a raw `Error`—every failure is a typed
// `LouiseError` carrying a machine-readable `.code` (DB_ERROR, CACHE_ERROR,
// STORAGE_ERROR, …). That typed surface is exactly what a recovery layer needs:
// `withHealing` wraps a route and, when it throws a `LouiseError`, consults a
// per-code policy to decide what to do instead of surfacing a 500.
//
// Three deterministic strategies, composable per error code:
//
//   - **retry**: re-run the route (with optional exponential backoff).
//     For transient infrastructure blips (D1/R2/KV hiccups).
//   - **fallback**: serve a degraded/stale Response instead of throwing.
//     Fails *soft*: a stale cache hit beats an error page.
//   - **escalate**: hand the failure off out-of-band via `ctx.waitUntil`,
//     so recovery never blocks (or breaks) the response.
//
// The escalation hook is the seam a future *self-updating* loop plugs into:
// today `escalate` might enqueue the failure for a human or a deterministic
// job; tomorrow it can enqueue `describeFailure(...)` onto a queue that an
// agent drains, reproduces, and opens a fix PR against. Nothing here depends on
// that; `withHealing` is pure library code with no AI or network coupling. It
// just turns typed errors into structured, actionable signals and gives you the
// place to route them.
//
// Design notes, in keeping with the rest of Louise:
//   - **Fails toward availability.** A route that has a `fallback` for its
//     error code returns that fallback rather than a 500; only codes with no
//     matching rule re-throw. (Same spirit as security/rate-limit's fail-open.)
//   - **Deterministic + injectable.** `sleep` is injected (default real timer)
//     so tests exercise backoff without wall-clock delay.
//   - **Retries re-run the whole route.** Safe for idempotent reads; unsafe for
//     non-idempotent writes (a retried POST can double-write). `retries`
//     defaults to 0; opt in only for codes whose route is safe to repeat.

import { LouiseError } from "../errors.js";
import type { WorkerRoute } from "./index.js";

/**
 * The subset of `LouiseError.code`s that represent *transient* infrastructure
 * failures—the ones generally safe to retry, given an idempotent route.
 * Provided as guidance for building a policy; `withHealing` itself matches on
 * whatever codes your `rules` declare, not on this list.
 */
export const TRANSIENT_CODES = ["DB_ERROR", "CACHE_ERROR", "STORAGE_ERROR", "QUEUE_ERROR"] as const;

/**
 * Context handed to a rule's `fallback` / `escalate` callback describing the
 * failure being healed. Carries the request and the typed error so a fallback
 * can consult a stale cache and an escalation can build a diagnostic payload.
 */
export interface HealingContext<Env = unknown> {
  readonly request: Request;
  readonly env: Env;
  readonly ctx: ExecutionContext;
  /** The typed error that triggered healing (the last one, if retried). */
  readonly error: LouiseError;
  /** `error.code`—the key matched against the policy (for example, "DB_ERROR"). */
  readonly code: string;
  /** How many times the route was invoked before giving up (>= 1). */
  readonly attempts: number;
}

/** What to do when a route throws a `LouiseError` of a given code. */
export interface HealingRule<Env = unknown> {
  /**
   * Extra attempts after the first failure (0 = never retry). Each retry
   * re-invokes the wrapped route. Only enable for idempotent routes.
   */
  readonly retries?: number;
  /**
   * Base backoff in ms between retries; attempt N waits
   * `backoffMs * 2 ** (N - 1)`. Defaults to 0 (retry immediately). Backoff
   * holds the request open, so keep it small on the hot path.
   */
  readonly backoffMs?: number;
  /**
   * Serve this Response instead of throwing once retries are exhausted—the
   * "stale-fallback" strategy. Return for example, a cached copy or a graceful
   * degraded page. If omitted (and nothing else handles it), the error
   * re-throws.
   */
  readonly fallback?: (ctx: HealingContext<Env>) => Response | Promise<Response>;
  /**
   * Hand the failure off out-of-band. Runs via `ctx.waitUntil`, so it never
   * blocks the response and its own errors can't break the request. This is
   * where a self-updating pipeline hooks in—for example, `enqueue(env.HEAL_QUEUE,
   * describeFailure(ctx))`.
   */
  readonly escalate?: (ctx: HealingContext<Env>) => void | Promise<void>;
}

export interface HealingOptions<Env = unknown> {
  /** Recovery rules keyed by `LouiseError.code`. */
  readonly rules: Readonly<Record<string, HealingRule<Env>>>;
  /**
   * Applied when a caught `LouiseError`'s code has no explicit rule. Omit to
   * re-throw unrecognized codes (the safe default—never heal what you didn't
   * plan for).
   */
  readonly fallbackRule?: HealingRule<Env>;
  /**
   * Injected delay for backoff. Defaults to a real `setTimeout`. Tests pass a
   * resolved no-op to run backoff logic without real time passing.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap a {@link WorkerRoute} so thrown `LouiseError`s are healed by policy
 * instead of surfacing as failures.
 *
 * On each invocation the wrapped route runs. If it returns (a `Response` or
 * `undefined` pass-through) that value is returned unchanged. If it throws:
 *
 *   1. Non-`LouiseError`s re-throw immediately—we only heal typed errors.
 *   2. The error's `code` selects a rule (`rules[code]`, else `fallbackRule`).
 *      No matching rule ⇒ re-throw.
 *   3. While attempts remain under the rule's `retries`, back off and re-run.
 *   4. Once retries are exhausted: `escalate` (fire-and-forget via
 *      `waitUntil`), then `fallback` (return its Response)—or re-throw the
 *      last error if the rule has neither.
 *
 * @example
 * const healed = withHealing(apiRoute, {
 *   rules: {
 *     DB_ERROR: {
 *       retries: 2,
 *       backoffMs: 50,
 *       fallback: ({ request }) => serveStale(request),
 *       escalate: ({ env, ...c }) => enqueue(env.HEAL_QUEUE, describeFailure(c)),
 *     },
 *   },
 * });
 * export default composeWorker({ routes: [healed], fetch: ssrHandler });
 */
export function withHealing<Env = unknown>(
  route: WorkerRoute<Env>,
  options: HealingOptions<Env>,
): WorkerRoute<Env> {
  const sleep = options.sleep ?? realSleep;

  return async (request, env, ctx) => {
    let attempts = 0;
    // Bounded by the largest `retries` of any rule we actually hit; the loop
    // always terminates because a throw either retries (attempts++), returns a
    // fallback, or re-throws.
    for (;;) {
      attempts++;
      try {
        return await route(request, env, ctx);
      } catch (err) {
        // Only typed Louise failures are healable—anything else is a real
        // bug and must propagate untouched.
        if (!(err instanceof LouiseError)) throw err;

        const rule = options.rules[err.code] ?? options.fallbackRule;
        if (!rule) throw err; // no policy for this code—surface it

        const retries = rule.retries ?? 0;
        if (attempts <= retries) {
          const backoff = (rule.backoffMs ?? 0) * 2 ** (attempts - 1);
          if (backoff > 0) await sleep(backoff);
          continue; // re-run the route
        }

        // Retries exhausted—heal deterministically.
        const healingCtx: HealingContext<Env> = {
          request,
          env,
          ctx,
          error: err,
          code: err.code,
          attempts,
        };

        // Escalate out-of-band. Wrapped so a throwing/ rejecting `escalate`
        // can never affect the response we're about to return.
        if (rule.escalate) {
          const escalate = rule.escalate;
          ctx.waitUntil(Promise.resolve().then(() => escalate(healingCtx)));
        }

        if (rule.fallback) return await rule.fallback(healingCtx);
        throw err; // escalate-only rule (or neither): still surface the error
      }
    }
  };
}

/**
 * A serializable snapshot of a healed failure—the payload you'd hand to an
 * out-of-band recovery job (a queue message, a log line, a self-updating
 * agent's work item). Deliberately flat and dependency-free so it survives
 * `JSON.stringify` across a queue boundary.
 */
export interface FailureReport {
  /** `LouiseError.code`, for example, "DB_ERROR". */
  readonly code: string;
  readonly message: string;
  readonly method: string;
  readonly url: string;
  /** Attempts made before giving up. */
  readonly attempts: number;
  /** Epoch ms when the report was built. */
  readonly at: number;
}

/**
 * Build a {@link FailureReport} from a {@link HealingContext}—the concrete
 * thing an `escalate` hook enqueues. `now` is injectable for deterministic
 * tests.
 */
export function describeFailure(ctx: HealingContext, now: number = Date.now()): FailureReport {
  return {
    code: ctx.code,
    message: ctx.error.message,
    method: ctx.request.method,
    url: ctx.request.url,
    attempts: ctx.attempts,
    at: now,
  };
}
