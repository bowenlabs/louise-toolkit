// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Resolving the portal session once per request, and guarding mutations.
//
// The middleware resolves it (to gate routes) and so does whatever handler runs
// next (to know who's asking). Both hitting the session store is a wasted D1
// round-trip on every authenticated request, so the in-flight promise is shared
// per request via a `WeakMap` — keyed on the `Request`, which means entries
// disappear with the request rather than needing eviction.
//
// `requireCustomer` then adds the check a session alone doesn't give you:
// same-origin on mutations. A cookie is attached by the browser to any request
// to this origin, including one a third-party page triggered — so a session
// proves identity, and the origin check proves intent.

import type { PortalUser } from "./guard.js";

/** Resolves the portal user for a request, or null when signed out. */
export type PortalSessionResolver = (request: Request) => Promise<PortalUser | null>;

const inFlight = new WeakMap<Request, Promise<PortalUser | null>>();

/**
 * Resolve the portal session at most once per request.
 *
 * Shares the *promise*, not the result, so two callers racing during the same
 * request both await one lookup rather than starting a second.
 */
export function resolvePortalSession(
  request: Request,
  resolve: PortalSessionResolver,
): Promise<PortalUser | null> {
  const existing = inFlight.get(request);
  if (existing) return existing;
  // A rejected lookup degrades to signed-out rather than propagating: missing
  // bindings under plain `astro preview` shouldn't 500 a public page.
  const promise = resolve(request).catch(() => null);
  inFlight.set(request, promise);
  return promise;
}

/** JSON response helper — the shape every portal API route returns. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Methods that change state, and therefore need the origin check. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** True when the request came from this same origin. */
export function isSameOrigin(request: Request): boolean {
  const target = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === target;
  // No Origin header: browsers always send one on cross-origin mutations, so
  // its absence means a same-origin or non-browser caller. Fall back to Referer
  // when present, and allow otherwise — being stricter would break legitimate
  // server-to-server callers without stopping a real CSRF, which always carries
  // an Origin.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === target;
    } catch {
      return false;
    }
  }
  return true;
}

export type CustomerGuardResult =
  | { ok: true; user: PortalUser }
  | { ok: false; response: Response };

/**
 * Guard a portal API handler: a signed-in user, and — on mutations — a
 * same-origin request.
 *
 * ```ts
 * const guard = await requireCustomer(request, (req) => portalUser(req));
 * if (!guard.ok) return guard.response;
 * // guard.user is signed in and this is a same-origin call
 * ```
 *
 * `roles` narrows further, for a route only some portal users may reach.
 */
export async function requireCustomer(
  request: Request,
  resolve: PortalSessionResolver,
  options: { roles?: string[] } = {},
): Promise<CustomerGuardResult> {
  if (MUTATING.has(request.method) && !isSameOrigin(request)) {
    return { ok: false, response: json({ ok: false, error: "Forbidden" }, 403) };
  }

  const user = await resolvePortalSession(request, resolve);
  if (!user) return { ok: false, response: json({ ok: false, error: "Unauthorized" }, 401) };

  if (options.roles?.length && !options.roles.includes(user.role)) {
    return { ok: false, response: json({ ok: false, error: "Forbidden" }, 403) };
  }

  return { ok: true, user };
}
