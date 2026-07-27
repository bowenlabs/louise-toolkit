// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Editor-auth convention + the two-instance isolation guard.
//
// Astroid runs up to TWO Better Auth instances on one origin: the EDITOR (the
// studio — magic-link + passkey, a DB-managed admin allowlist) and, optionally, a
// second PORTAL instance (customers/members/a shop account — see `portal/`). The
// editor owns Better Auth's default mount (`/api/auth`) and cookie because the
// Louise editor client hardcodes them; its tables are namespaced with the
// `louise_` prefix so a second instance can take the unprefixed `user`/`session`
// tables without collision. The portal is the one that MOVES — a distinct mount,
// cookie prefix, and (by default) table prefix.
//
// The failure this guards against is subtle and intermittent: two instances that
// share a cookie prefix silently sign you out of one when you sign into the other,
// in production, looking like a session bug rather than a config one. So the
// isolation is asserted at config load, naming the collision.

import type { AstroidConfig } from "../config.js";
import { AstroidConfigError } from "../errors.js";
import { astroidPortal } from "../portal/config.js";

/**
 * The editor Better Auth instance's table prefix — `louise_user`,
 * `louise_session`, … The unprefixed names are left free for a second (portal)
 * instance. Consumed by the generated `editorsRoute` and mirrored by the
 * scaffolded `src/auth.ts` (`getLouiseAuth({ tablePrefix })`) + its migration.
 */
export const ASTROID_EDITOR_TABLE_PREFIX = "louise_";

/**
 * The editor instance keeps Better Auth's default cookie prefix (the Louise
 * editor client is built against it). Named here so the isolation guard can
 * reject a portal that would collide with it.
 */
export const ASTROID_EDITOR_COOKIE_PREFIX = "better-auth";

/** The editor's Better Auth table name for a given model (e.g. `louise_user`). */
export function astroidEditorTable(model: string): string {
  return `${ASTROID_EDITOR_TABLE_PREFIX}${model}`;
}

/**
 * Reject a portal whose isolation would collide with the editor instance on the
 * same origin. Called from `defineAstroid`. A no-op when there is no portal.
 *
 * The two dangerous overlaps:
 *  - a shared cookie prefix → signing into one instance signs you out of the
 *    other (the intermittent-prod-logout the fixed defaults exist to prevent);
 *  - a shared table prefix → the two instances read/write one `user` table, so
 *    an editor and a customer can become the same account.
 */
export function assertAuthIsolation(config: AstroidConfig): void {
  const portal = astroidPortal(config);
  if (!portal) return;

  if (!portal.cookiePrefix || portal.cookiePrefix === ASTROID_EDITOR_COOKIE_PREFIX) {
    throw new AstroidConfigError(
      `portal.cookiePrefix must be set and distinct from the editor's (${JSON.stringify(
        ASTROID_EDITOR_COOKIE_PREFIX,
      )}). Two instances sharing a cookie prefix silently sign you out of one when ` +
        'you sign into the other. Pick a project-specific prefix (e.g. "acme_shop").',
    );
  }
  if (portal.tablePrefix === ASTROID_EDITOR_TABLE_PREFIX) {
    throw new AstroidConfigError(
      `portal.tablePrefix must differ from the editor's (${JSON.stringify(
        ASTROID_EDITOR_TABLE_PREFIX,
      )}) — a shared table prefix merges the two instances into one user table. ` +
        "Leave it unset (the unprefixed `user`/`session` tables) or use a distinct prefix.",
    );
  }
}
