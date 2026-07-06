// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louise/commerce — shared primitives for the provider clients: money helpers
// and webhook-signature crypto (HMAC-SHA256 + a constant-time compare). The
// provider glue lives in the sibling subpaths:
//   louisecms/commerce/stripe · /square · /fourthwall
// All three verify webhooks with these helpers, so the crypto lives here once.

/** A money amount, expressed in a currency's minor unit (e.g. cents). */
export interface Money {
  /** Amount in the currency's minor unit — cents for USD. */
  amount: number;
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
}

/** Minor units (cents) → major units — `2500` → `25`. */
export function centsToMajor(cents: number): number {
  return cents / 100;
}

/** Hex-encode raw bytes. */
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64-encode raw bytes. */
function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function signHmacSha256(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

/** HMAC-SHA256 of `message` under `secret`, hex-encoded (Stripe's encoding). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return toHex(await signHmacSha256(secret, message));
}

/** HMAC-SHA256 of `message` under `secret`, base64-encoded (Square + Fourthwall). */
export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  return toBase64(await signHmacSha256(secret, message));
}

/**
 * Constant-time-ish string compare (avoids early-exit timing leaks). Compare a
 * freshly-computed signature against the value from a request header with this.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
