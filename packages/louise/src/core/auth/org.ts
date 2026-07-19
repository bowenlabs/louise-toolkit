// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Org-membership editor access (issue #100). The organization plugin
// (getLouiseAuth's `organizations` option) introduces a SECOND access axis
// beside the global admin allowlist: a user may edit an organization's content
// when they hold an editor role (owner/admin by default) in THAT organization.
//
// `resolveEditorSession` gates on the global admin-plugin role (the owner/
// engineer superusers, from the env allowlist — unchanged). `resolveOrgEditor`
// gates on org membership instead, so a per-tenant editor never has to be in the
// deploy-wide allowlist. The two coexist: a newly-invited org member gets the
// global role "user" (they're not in the allowlist), and their edit rights come
// from membership. The site decides which organization a request belongs to —
// the sole org for a single site, or resolved from the hostname for multi-tenant
// hosting — and passes it in, so Louise stays unopinionated about that mapping,
// exactly like `requireRole`.
//
// Membership is read straight from Better Auth's `member` table over D1 (that
// table is owned by Better Auth, like `user` in editor/editors.ts), so this
// needs no version-specific server API and honors the same `tablePrefix`.

import type { LouiseAuth } from "./auth.js";
import type { EditorSession } from "./types.js";

/** Default org roles that may edit content: the organization plugin's `owner`
 *  and `admin`. Plain `member` is non-editing unless a site widens this. */
export const DEFAULT_ORG_EDITOR_ROLES = ["owner", "admin"] as const;

/** Default path the invitation-accept link points at (joined to the site
 *  origin). Override via `LouiseOrganizationsConfig.acceptInvitationPath`. */
export const DEFAULT_ACCEPT_INVITATION_PATH = "/organization/accept-invitation";

/**
 * Build the URL an invitation email links to: the site origin (`baseURL`) +
 * `acceptPath`, carrying the invitation id as `?id=`. Better Auth doesn't
 * generate invite URLs — `sendInvitationEmail` hands back only the invitation
 * id — so the app constructs the link the accept-invitation endpoint/page reads.
 * An absolute `acceptPath` resolves against the origin, ignoring any path on
 * `baseURL`; an empty path falls back to {@link DEFAULT_ACCEPT_INVITATION_PATH}.
 */
export function invitationAcceptUrl(
  baseURL: string,
  invitationId: string,
  acceptPath: string = DEFAULT_ACCEPT_INVITATION_PATH,
): string {
  const url = new URL(acceptPath || DEFAULT_ACCEPT_INVITATION_PATH, baseURL);
  url.searchParams.set("id", invitationId);
  return url.toString();
}

/** An editor session resolved from organization membership: the base editor
 *  fields plus the organization it's scoped to (`role` is the org role, not the
 *  global admin-plugin role). */
export interface OrgEditorSession extends EditorSession {
  organizationId: string;
}

export interface ResolveOrgEditorOptions {
  /** The organization the request is scoped to. The site resolves this — the
   *  sole org for a single site, or per-hostname for multi-tenant hosting (see
   *  {@link activeOrganizationId} for the session's active org). */
  organizationId: string;
  /** Org roles allowed to edit. Defaults to {@link DEFAULT_ORG_EDITOR_ROLES}. */
  editorRoles?: readonly string[];
  /** `member` table prefix — must equal the auth `tablePrefix` (Option B).
   *  Validated as a SQL identifier before it's interpolated into the query. */
  tablePrefix?: string;
}

// Same identifier guard the schema generator enforces on `tablePrefix`, so a
// stray char can't slip into the interpolated table name.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Resolve the editor session for `organizationId` from the signed-in user's
 * membership. Returns the {@link OrgEditorSession} when the user is a member
 * whose org role is in `editorRoles` (owner/admin by default), else null —
 * mirroring {@link resolveEditorSession}'s "null means not an editor" contract,
 * so it drops straight into `editorsRoute`/`guardEditor` as a `resolveEditor`.
 * Access is re-derived from the session + DB on every request; nothing is
 * trusted from the client.
 */
export async function resolveOrgEditor(
  auth: LouiseAuth,
  db: D1Database,
  request: Request,
  opts: ResolveOrgEditorOptions,
): Promise<OrgEditorSession | null> {
  const prefix = opts.tablePrefix ?? "";
  if (prefix && !IDENT_RE.test(prefix)) {
    throw new Error(`Invalid tablePrefix ${JSON.stringify(prefix)} (must match ${IDENT_RE})`);
  }
  const result = await auth.api.getSession({ headers: request.headers });
  const user = result?.user;
  if (!user) return null;

  const roles = opts.editorRoles ?? DEFAULT_ORG_EDITOR_ROLES;
  const row = await db
    .prepare(`SELECT role FROM "${prefix}member" WHERE userId = ? AND organizationId = ? LIMIT 1`)
    .bind(user.id, opts.organizationId)
    .first<{ role: string | null }>();
  const role = row?.role;
  if (!role || !roles.includes(role)) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    // Better Auth defaults name from the email local-part, so it's always set.
    name: user.name || user.email?.split("@")[0] || "Editor",
    role,
    organizationId: opts.organizationId,
  };
}

/**
 * The organization the current session has marked active — Better Auth stores it
 * on the session once the client calls `setActiveOrganization`. Convenience for
 * the single-site case: resolve the active org, then gate with
 * {@link resolveOrgEditor}. Returns null when there is no session or no active
 * org (e.g. the user hasn't selected one yet).
 */
export async function activeOrganizationId(
  auth: LouiseAuth,
  request: Request,
): Promise<string | null> {
  const result = await auth.api.getSession({ headers: request.headers });
  return result?.session?.activeOrganizationId ?? null;
}
