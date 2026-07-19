// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Role-gated routing for the portal.
//
// coracle and ghostfire independently built the same thing: a declarative table
// of `prefix → roles`, walked once per request. Declarative rather than a guard
// call inside each page, because a guard you have to remember to write is a
// guard someone eventually forgets — and the page that forgets it is the one
// that leaks.
//
// Three answers, and which one you give matters:
//
//   not signed in, HTML   → redirect to the login page, carrying `next`
//   not signed in, API    → 401 JSON (a redirect to an HTML login page is
//                           useless to fetch(); it looks like success)
//   signed in, wrong role → 403 for API, and for HTML a redirect to the area
//                           this user DOES have — not back to login, which
//                           reads as "your password failed" when it didn't

/** A signed-in portal user, as far as the guard is concerned. */
export interface PortalUser {
  role: string;
  [key: string]: unknown;
}

/** One rule: everything under `prefix` requires one of `roles`. */
export interface PortalRoute {
  /** Path prefix, e.g. `/portal` — matches the prefix itself and everything
   *  beneath it, but NOT `/portalling`. */
  prefix: string;
  /** Roles allowed through. Empty means "any signed-in user". */
  roles?: string[];
}

export interface PortalGuardConfig {
  /** The rule table, in order. The first matching prefix decides. */
  routes: PortalRoute[];
  /** Where to send a signed-out visitor. Default `/login`. */
  loginPath?: string;
  /** Landing page for a signed-in user, by role — used to bounce someone who
   *  reached an area they don't belong in. Default `/portal` for everyone. */
  home?: (role: string) => string;
}

/** What the guard decided. `null` means "carry on". */
export type GuardDecision =
  | null
  | { kind: "redirect"; location: string }
  | { kind: "json"; status: 401 | 403; body: { ok: false; error: string } };

/** Prefix match on a path SEGMENT boundary — `/portal` covers `/portal` and
 *  `/portal/orders`, but never `/portalling`. */
export function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Decide whether a request may proceed.
 *
 * Pure — it returns a decision rather than a `Response`, so it's testable
 * without an Astro context and the middleware stays responsible for turning a
 * decision into a redirect or a body.
 */
export function portalGuard(
  path: string,
  user: PortalUser | null,
  config: PortalGuardConfig,
): GuardDecision {
  const rule = config.routes.find((r) => matchesPrefix(path, r.prefix));
  if (!rule) return null;

  // An API route answers in JSON whatever happens: redirecting `fetch()` to an
  // HTML login page returns 200 and a page of markup, which client code reads
  // as success and then fails on somewhere far less obvious.
  const isApi = path.startsWith("/api/");

  if (!user) {
    if (isApi) return { kind: "json", status: 401, body: { ok: false, error: "Unauthorized" } };
    const login = config.loginPath ?? "/login";
    return { kind: "redirect", location: `${login}?next=${encodeURIComponent(path)}` };
  }

  const allowed = !rule.roles?.length || rule.roles.includes(user.role);
  if (!allowed) {
    if (isApi) return { kind: "json", status: 403, body: { ok: false, error: "Forbidden" } };
    // Signed in, wrong door. Sending them back to /login would say "your
    // credentials failed" about credentials that worked fine.
    return { kind: "redirect", location: config.home?.(user.role) ?? "/portal" };
  }

  return null;
}

/** Turn a decision into a `Response`. `redirect` is left to the caller, since
 *  Astro's context builds those with its own base-path handling. */
export function guardResponse(decision: Exclude<GuardDecision, null>): Response | null {
  if (decision.kind === "redirect") return null;
  return new Response(JSON.stringify(decision.body), {
    status: decision.status,
    headers: { "content-type": "application/json" },
  });
}
