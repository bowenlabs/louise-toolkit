// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

import { isAllowedSignInEmail } from "./admins.js";
import type { LouiseAuth } from "./auth.js";

/**
 * Better Auth catch-all with the studio magic-link allowlist gate. A site's
 * `/api/auth/[...all]` route calls this. Non-admin magic-link requests are
 * rejected BEFORE Better Auth runs — no token, no mail, and (at the verify
 * step) no user row — and return the SAME enumeration-safe response a real send
 * returns, so probing the endpoint reveals nothing. Customer email/password
 * sign-up (when enabled) is intentionally NOT gated by this.
 *
 * `admins` is the resolved allowlist (use `defaultResolveAdmins` or the config's
 * `resolveAdmins` — the same source the factory uses).
 */
export async function handleAuthRequest(
  auth: LouiseAuth,
  request: Request,
  admins: readonly string[],
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/api/auth/sign-in/magic-link") {
    const body = (await request
      .clone()
      .json()
      .catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email : "";
    if (!isAllowedSignInEmail(admins, email)) {
      return Response.json({ status: true });
    }
  }
  return auth.handler(request);
}
