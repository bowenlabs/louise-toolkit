// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Cloudflare Turnstile activation gate. Captcha protecting the magic-link
// endpoint only turns on when BOTH halves of the pair are real: a
// non-placeholder secret AND a real (non-test) site key. Provisioning one
// without the other keeps sign-in working instead of locking the owner out.

import { readSecret } from "../security/index.js";
import type { LouiseAuthEnv } from "./types.js";

/** Sentinel for a not-yet-configured Turnstile secret — keeps captcha OFF. */
export const TURNSTILE_PLACEHOLDER = "DUMMY_REPLACE_ME";

/** Cloudflare's always-passing Turnstile *test* site key. Its token will not
 *  verify against a real secret, so captcha also requires a real site key. */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

/** The public site key to render, or null to render no widget (test/unset). */
export function turnstileSiteKey(env: LouiseAuthEnv): string | null {
  const key = env.TURNSTILE_SITE_KEY?.trim();
  return key && key !== TURNSTILE_TEST_SITE_KEY ? key : null;
}

/** The stored Turnstile secret, or null while it's the placeholder/unreadable. */
export function turnstileSecret(env: LouiseAuthEnv): Promise<string | null> {
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
 * Is captcha on — and if so, the key to render the widget with and the secret
 * to verify its token against, together. `null` means OFF: render no widget and
 * check no token.
 *
 * One decision for both halves, because a split decision takes sign-in down.
 * A site key that stops resolving (say, after moving Cloudflare accounts)
 * renders no widget; if the server still holds a real secret, it keeps
 * demanding a token no visitor can produce, and every sign-in fails. Deciding
 * the widget and the check from the same call makes that state unreachable.
 * On only when both halves are real — see {@link activeCaptchaSecret}.
 */
export async function activeCaptcha(
  env: LouiseAuthEnv,
): Promise<{ siteKey: string; secret: string } | null> {
  const siteKey = turnstileSiteKey(env);
  const secret = activeCaptchaSecret(env, await turnstileSecret(env));
  return siteKey && secret ? { siteKey, secret } : null;
}
