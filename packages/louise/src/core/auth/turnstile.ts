// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

// Cloudflare Turnstile activation gate. Captcha protecting the magic-link
// endpoint only turns on when BOTH halves of the pair are real: a
// non-placeholder secret AND a real (non-test) site key. Provisioning one
// without the other keeps sign-in working instead of locking the owner out.

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
export async function turnstileSecret(env: LouiseAuthEnv): Promise<string | null> {
  try {
    const value = await env.TURNSTILE_SECRET.get();
    return value && value !== TURNSTILE_PLACEHOLDER ? value : null;
  } catch {
    return null;
  }
}

/** The secret to enforce captcha with, or null to keep it OFF (needs a real
 *  secret AND a real, non-test site key). */
export function activeCaptchaSecret(env: LouiseAuthEnv, secret: string | null): string | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const siteKeyReady = !!siteKey && siteKey !== TURNSTILE_TEST_SITE_KEY;
  return secret && siteKeyReady ? secret : null;
}
