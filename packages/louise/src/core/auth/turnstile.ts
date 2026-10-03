// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Cloudflare Turnstile activation gate. Captcha protecting the magic-link
// endpoint only turns on when BOTH halves of the pair are real: a
// non-placeholder secret AND a real (non-test) site key. Provisioning one
// without the other keeps sign-in working instead of locking the owner out.
//
// That fail-open choice is right for the studio's sign-in and wrong for a
// payment form, where a captcha that quietly turns off leaves a card-testing
// script facing only a rate limit. `resolveCaptcha` tells the two apart, so
// each control picks its own failure mode (ADR 0012, amendment of 2026-10-03).

import { reportDegraded } from "../degraded.js";
import { readSecret } from "../security/index.js";
import type { LouiseAuthEnv } from "./types.js";

/** Sentinel for a not-yet-configured Turnstile secret—keeps captcha OFF. */
export const TURNSTILE_PLACEHOLDER = "DUMMY_REPLACE_ME";

/** Cloudflare's always-passing Turnstile *test* site key. Its token will not
 *  verify against a real secret, so captcha also requires a real site key. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

/** The two Turnstile bindings. Either might be missing. Every `LouiseAuthEnv`
 *  fits, and so does a route's own env that has only these two. */
export type CaptchaEnv = Pick<LouiseAuthEnv, "TURNSTILE_SECRET" | "TURNSTILE_SITE_KEY">;

/** The public site key to render, or null to render no widget (test/unset). */
export function turnstileSiteKey(env: CaptchaEnv): string | null {
  const key = env.TURNSTILE_SITE_KEY?.trim();
  return key && key !== TURNSTILE_TEST_SITE_KEY ? key : null;
}

/** The stored Turnstile secret, or null while it's the placeholder/unreadable. */
export function turnstileSecret(env: CaptchaEnv): Promise<string | null> {
  return readSecret(env.TURNSTILE_SECRET, { placeholder: TURNSTILE_PLACEHOLDER });
}

/** The secret to enforce captcha with, or null to keep it OFF (needs a real
 *  secret AND a real, non-test site key). */
export function activeCaptchaSecret(env: LouiseAuthEnv, secret: string | null): string | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const siteKeyReady = !!siteKey && siteKey !== TURNSTILE_TEST_SITE_KEY;
  return secret && siteKeyReady ? secret : null;
}

/**
 * Is captcha on—and if so, the key to render the widget with and the secret
 * to verify its token against, together. `null` means OFF: render no widget and
 * check no token.
 *
 * One decision for both halves, because a split decision takes sign-in down.
 * A site key that stops resolving (say, after moving Cloudflare accounts)
 * renders no widget; if the server still holds a real secret, it keeps
 * demanding a token no visitor can produce, and every sign-in fails. Deciding
 * the widget and the check from the same call makes that state unreachable.
 * On only when both halves are real—see {@link activeCaptchaSecret}.
 */
export async function activeCaptcha(
  env: LouiseAuthEnv,
): Promise<{ siteKey: string; secret: string } | null> {
  const siteKey = turnstileSiteKey(env);
  const secret = activeCaptchaSecret(env, await turnstileSecret(env));
  return siteKey && secret ? { siteKey, secret } : null;
}

/**
 * Whether a control's captcha is on, from {@link resolveCaptcha}:
 *
 * - `off`: not provisioned. There's no site key, the site key is Cloudflare's
 *   test key, or this is the dev server. Render no widget and check no token.
 * - `on`: render the widget with `siteKey` and verify its token against
 *   `secret`.
 * - `unavailable`: a real site key whose secret can't be read, because the
 *   binding is missing, holds the placeholder, or threw. The host meant the
 *   captcha to be on. Render no widget, and decide per control whether to
 *   refuse the request (fail closed) or let it through (fail open).
 */
export type CaptchaDecision =
  | { kind: "off" }
  | { kind: "on"; siteKey: string; secret: string }
  | { kind: "unavailable" };

/** Options for {@link resolveCaptcha}. */
export interface ResolveCaptchaOptions {
  /**
   * True when the request is served by the local dev server. Pass the build's
   * own flag, such as Vite's `import.meta.env.DEV`. The dev server reads the
   * real site key from the Wrangler config and has no Secrets Store, so a real
   * site key with no readable secret is `off` there rather than `unavailable`.
   *
   * A build-time flag rather than the request's host, because a local preview
   * of a build (`wrangler dev` on the built Worker) rewrites the host to the
   * route's zone: a host test would read that preview as production, and the
   * flag correctly reads it as a build.
   */
  devServer: boolean;
}

/** The `reportDegraded` name {@link resolveCaptcha} reports an `unavailable`
 *  captcha under. */
export const CAPTCHA_UNAVAILABLE_DEGRADED = "auth.captcha-unavailable";

// The report's cause, one per reason. It's a string rather than a detail so it
// reaches the incident record, where the two need different fixes: provision
// the binding, or repair the store or replace the placeholder.
const UNAVAILABLE_CAUSE = {
  missing: "the Turnstile secret binding is missing",
  unreadable: "the Turnstile secret is unreadable, empty, or the placeholder",
} as const;

/**
 * Decide a control's captcha in three states, for a control that must not
 * quietly lose its captcha. See {@link CaptchaDecision}.
 *
 * {@link activeCaptcha} folds "not provisioned" and "provisioned but the secret
 * can't be read" into one `null`, which is right for the studio's sign-in: a
 * broken secret then keeps the owner able to sign in. A checkout can't afford
 * that, because a broken Secrets Store binding would silently turn its captcha
 * off. This call keeps the two apart, so the control can refuse while its
 * captcha is `unavailable`.
 *
 * Use it for the widget and the check alike, as with {@link activeCaptcha}: a
 * page renders the widget only for `on`, and the route verifies a token only
 * for `on`. An `unavailable` result is reported once per call with
 * `reportDegraded` under {@link CAPTCHA_UNAVAILABLE_DEGRADED}, with a cause that
 * says whether the binding is missing or unreadable, so the outage shows up in
 * the log and the incident record before a customer reports it. A binding that
 * throws is also reported as `security.readSecret` by the read itself.
 *
 * @example
 * ```ts
 * const captcha = await resolveCaptcha(env, { devServer: import.meta.env.DEV });
 * if (captcha.kind === "unavailable") return json({ error: "Checkout isn't available right now." }, 503);
 * if (captcha.kind === "on" && !(await verifyTurnstileToken(captcha.secret, token, ip))) {
 *   return json({ error: "Reload the page and try again." }, 403);
 * }
 * ```
 */
export async function resolveCaptcha(
  env: CaptchaEnv,
  options: ResolveCaptchaOptions,
): Promise<CaptchaDecision> {
  const siteKey = turnstileSiteKey(env);
  if (!siteKey) return { kind: "off" };
  const secret = await turnstileSecret(env);
  if (secret) return { kind: "on", siteKey, secret };
  if (options.devServer) return { kind: "off" };
  const reason = env.TURNSTILE_SECRET == null ? "missing" : "unreadable";
  reportDegraded(CAPTCHA_UNAVAILABLE_DEGRADED, UNAVAILABLE_CAUSE[reason], { reason });
  return { kind: "unavailable" };
}
