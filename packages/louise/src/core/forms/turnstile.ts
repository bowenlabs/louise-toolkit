// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/forms — Cloudflare Turnstile server-side verification. A form's
// public capture route calls this to check the `cf-turnstile-response` token
// against Turnstile's siteverify endpoint before accepting a submission. The
// secret is the site's (server-only); Louise just owns the request shape.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token with the given secret. Returns `true` only on a
 * confirmed `success`. Any network/parse error returns `false` — a spam check
 * must fail closed (unlike the rate limiter, which fails open so an outage can't
 * lock out sign-in). Pass the client IP (`CF-Connecting-IP`) when available so
 * Turnstile can factor it in.
 */
export async function verifyTurnstileToken(
  secret: string,
  token: string | null,
  remoteIp?: string | null,
): Promise<boolean> {
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
