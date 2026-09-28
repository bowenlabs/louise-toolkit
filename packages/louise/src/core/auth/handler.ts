// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import { isAllowedSignInEmail } from "./admins.js";
import type { LouiseAuth } from "./auth.js";

/**
 * Better Auth catch-all with the editor magic-link allowlist gate. A site's
 * `/api/auth/[...all]` route calls this. Non-admin magic-link requests are
 * rejected BEFORE Better Auth runs—no token, no mail, and (at the verify
 * step) no user row—and return the SAME enumeration-safe response a real send
 * returns, so probing the endpoint reveals nothing. Customer email/password
 * sign-up (when enabled) is intentionally NOT gated by this.
 *
 * `admins` is the resolved allowlist (use `defaultResolveAdmins` or the config's
 * `resolveAdmins`—the same source the factory uses).
 */
export async function handleAuthRequest(
  auth: LouiseAuth,
  request: Request,
  admins: readonly string[],
): Promise<Response> {
  // Matched by suffix, not the default mount: an instance on its own
  // `basePath` gets the same gate, and a trailing slash doesn't slip past it.
  // (The factory refuses to mail a non-admin too; this keeps the token from
  // being minted at all, and the response enumeration-safe.)
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (request.method === "POST" && path.endsWith("/sign-in/magic-link")) {
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

/**
 * A redirect that carries every cookie a Better Auth response set, for a
 * server-rendered route that calls the API with `asResponse: true` and then
 * sends the browser on, such as a sign-out link:
 *
 *     const result = await auth.api.signOut({ headers: request.headers, asResponse: true });
 *     return redirectWithCookies(result, "/");
 *
 * Better Auth sets several cookies at once; sign-out expires the session
 * token, the cached session, and the "don't remember me" cookie. Copying them
 * with `headers.get("set-cookie")` joins them into one header, and the browser
 * keeps all but the first, so a signed-out visitor still carries the session.
 * This copies each one with `getSetCookie()`.
 *
 * `location` is where the browser goes. Pass a path the route chose, never one
 * read from the request unchecked (see `safeNextPath`). `status` defaults to
 * 303, which turns a POST into a GET.
 */
export function redirectWithCookies(
  from: Response | Headers,
  location: string,
  status: 301 | 302 | 303 | 307 | 308 = 303,
): Response {
  const headers = new Headers({ location });
  const source = from instanceof Response ? from.headers : from;
  for (const cookie of source.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}
