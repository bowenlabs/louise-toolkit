// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

import type { SecretBinding } from "./types";

export type { SecretBinding };

/**
 * Session-signing secret from a Cloudflare Secrets Store binding. On localhost
 * (where the store isn't provisioned) a fixed dev secret keeps the sign-in →
 * session loop workable; any deployed hostname fails closed (re-throws).
 *
 * @param secret     the Secrets Store binding (e.g. `env.SESSION_SECRET`)
 * @param url        the request URL (its hostname decides the dev fallback)
 * @param devSecret  the localhost-only fallback value; override per site
 */
export async function getSessionSecret(
  secret: SecretBinding,
  url: URL,
  devSecret = "louise-dev-secret",
): Promise<string> {
  const isDev = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  try {
    const value = await secret.get();
    if (value) return value;
    // An empty secret would silently weaken session signing (a misprovisioned
    // Secrets Store returns ""). Treat it as a failure, not a valid secret: dev
    // falls back below, any deployed host fails closed.
    if (isDev) return devSecret;
    throw new Error("SESSION_SECRET is empty");
  } catch (err) {
    if (isDev) return devSecret;
    throw err;
  }
}
