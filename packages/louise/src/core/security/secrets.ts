// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { SecretBinding } from "./types";

export type { SecretBinding };

/**
 * Anything that can back a secret value: a Secrets Store binding, a plain `vars`
 * string (the shape a public key or a `wrangler secret put` value arrives in),
 * or nothing at all—the binding simply isn't provisioned yet.
 */
export type SecretSource = SecretBinding | string | null | undefined;

export interface ReadSecretOptions {
  /**
   * Sentinel values that mean "not configured yet" and are read as unset. The
   * caller supplies them: the package has no opinion about which string a site
   * seeds its unprovisioned secrets with.
   */
  placeholder?: string | readonly string[];
}

/**
 * Read a secret, returning `null` whenever it is not really configured—the
 * binding is absent, the store isn't provisioned (a declared-but-unset binding
 * throws on `.get()`), the value is empty, or it still holds a placeholder
 * sentinel. The point is that a caller can *degrade*—skip the integration,
 * run a simulated path—instead of throwing or calling an upstream API with a
 * dummy credential.
 *
 * Contrast {@link getSessionSecret}, which fails closed: a missing session
 * secret is an error everywhere but localhost, not a feature to switch off.
 */
export async function readSecret(
  source: SecretSource,
  options: ReadSecretOptions = {},
): Promise<string | null> {
  if (source == null) return null;
  let raw: string | undefined;
  try {
    raw = typeof source === "string" ? source : await source.get();
  } catch {
    return null;
  }
  const value = raw?.trim();
  if (!value) return null;
  const { placeholder } = options;
  const sentinels =
    placeholder === undefined ? [] : typeof placeholder === "string" ? [placeholder] : placeholder;
  return sentinels.includes(value) ? null : value;
}

/**
 * Session-signing secret, from either a Cloudflare Secrets Store binding or a
 * plain `wrangler secret put` string. On localhost (where the store isn't
 * provisioned) a fixed dev secret keeps the sign-in → session loop workable;
 * any deployed hostname fails closed.
 *
 * "Not configured" here covers an unreadable binding, an empty value (a
 * misprovisioned Secrets Store returns `""`), and—when the caller names one—a
 * placeholder sentinel. That last case matters: a scaffold that seeds every
 * secret with a public placeholder must never reach production still signing
 * sessions with it, which is exactly what a plain non-empty check would allow.
 *
 * @param secret     the binding or value (for example, `env.SESSION_SECRET`)
 * @param url        the request URL (its hostname decides the dev fallback)
 * @param devSecret  the localhost-only fallback value; override per site
 * @param options    `placeholder` sentinels to read as not-configured
 */
export async function getSessionSecret(
  secret: SecretSource,
  url: URL,
  devSecret = "louise-dev-secret",
  options: ReadSecretOptions = {},
): Promise<string> {
  const value = await readSecret(secret, options);
  if (value) return value;
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return devSecret;
  throw new Error("SESSION_SECRET is not configured (missing, empty, or a placeholder)");
}
