// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Portal defaults derived from the project config — the single place that knows
// the portal's mount, cookie prefix, table prefix, and guard table.
//
// The isolation constants are fixed rather than configurable, and that's the
// point: the studio instance MUST keep Better Auth's defaults (`/api/auth`, the
// unprefixed tables) because the Louise editor client hardcodes them, so the
// portal is the one that moves. Leaving that to a project invites the one
// mistake that matters — two instances sharing a cookie prefix, where signing
// into one silently signs you out of the other, intermittently, in production.

import type { AstroidConfig, Portal } from "../config.js";
import { ASTROID_PORTAL_BASE_PATH } from "../security/rate-rules.js";
import type { PortalGuardConfig, PortalRoute } from "./guard.js";

/** Cookie prefix for the portal instance. Distinct from the studio's default
 *  (`better-auth`) so the two sessions can coexist on one origin. */
export const ASTROID_PORTAL_COOKIE_PREFIX = "portal";

/** Table-name prefix for the portal's Better Auth tables — `portal_user`,
 *  `portal_session`, … The studio owns the unprefixed names. */
export const ASTROID_PORTAL_TABLE_PREFIX = "portal_";

/** Default guard table: the account area, for any signed-in portal user. */
const DEFAULT_ROUTES: PortalRoute[] = [{ prefix: "/portal" }, { prefix: "/api/portal" }];

/** Everything the generated portal wiring needs, defaults applied. */
export interface ResolvedPortal {
  enabled: boolean;
  basePath: string;
  cookiePrefix: string;
  tablePrefix: string;
  roles: string[];
  /** First role in `roles` — what a newly created account gets. */
  defaultRole: string;
  routes: PortalRoute[];
  home: Record<string, string>;
  signUp: boolean;
  gated: boolean;
}

/** Resolve the portal block, or null when the project has no portal. */
export function astroidPortal(config: AstroidConfig): ResolvedPortal | null {
  const portal: Portal | undefined = config.portal;
  if (!portal?.enabled) return null;

  const roles = portal.roles?.length ? portal.roles : ["customer"];
  return {
    enabled: true,
    basePath: ASTROID_PORTAL_BASE_PATH,
    cookiePrefix: ASTROID_PORTAL_COOKIE_PREFIX,
    tablePrefix: ASTROID_PORTAL_TABLE_PREFIX,
    roles,
    defaultRole: roles[0],
    routes: portal.routes?.length ? portal.routes : DEFAULT_ROUTES,
    home: portal.home ?? {},
    signUp: portal.signUp ?? false,
    gated: portal.gated ?? false,
  };
}

/** The guard config for a project, ready to hand to `portalGuard`. */
export function astroidPortalGuardConfig(config: AstroidConfig): PortalGuardConfig | null {
  const portal = astroidPortal(config);
  if (!portal) return null;
  return {
    routes: portal.routes,
    loginPath: "/login",
    home: (role) => portal.home[role] ?? "/portal",
  };
}
