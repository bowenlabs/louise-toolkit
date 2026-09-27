// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import { defaultResolveAdmins, isAllowedSignInEmail } from "./admins.js";
import type { LouiseAuth } from "./auth.js";
import type { EditorSession, LouiseAuthEnv } from "./types.js";

/**
 * Re-derive the editor (admin) session from the signed Better Auth session on
 * every request—edit access is never trusted from the client. Returns the
 * editor when the session user holds `editorRole` (the admin plugin's "admin"),
 * else null. The site assigns the result to its `locals`.
 */
export async function resolveEditorSession(
  auth: LouiseAuth,
  request: Request,
  editorRole = "admin",
): Promise<EditorSession | null> {
  const result = await auth.api.getSession({ headers: request.headers });
  const user = result?.user;
  if (!user || user.role !== editorRole) return null;
  return {
    userId: user.id,
    email: user.email ?? "",
    // Better Auth defaults name from the email local-part, so it's always set.
    name: user.name || user.email?.split("@")[0] || "Editor",
    role: user.role,
  };
}

/**
 * Re-derive the signed-in user and their role WITHOUT gating on any specific
 * role—for a site's own multi-role auth instance where the role is arbitrary
 * and access is decided per route (via {@link requireRole}) or the UI renders
 * per role. Returns null only when there is no session. Generic and
 * unopinionated: Louise bakes in no role names. (Louise Editor uses the
 * role-gating {@link resolveEditorSession}.)
 */
export async function resolveSession(
  auth: LouiseAuth,
  request: Request,
): Promise<EditorSession | null> {
  const result = await auth.api.getSession({ headers: request.headers });
  const user = result?.user;
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email ?? "",
    name: user.name || user.email?.split("@")[0] || "User",
    role: user.role ?? "",
  };
}

export interface EditorForUserOptions {
  /** The role an editor holds. Default `"admin"`, as in {@link resolveEditorSession}. */
  editorRole?: string;
  /** The auth tables' prefix. Must equal `LouiseAuthConfig.tablePrefix`. */
  tablePrefix?: string;
  /** The sign-in allowlist. Must be the same function `LouiseAuthConfig`
   *  takes. Default `defaultResolveAdmins`, the owner and engineer emails. */
  resolveAdmins?: (env: LouiseAuthEnv) => string[] | Promise<string[]>;
}

/**
 * Re-derive an editor from their user ID, for a credential that isn't a
 * browser session, such as an agent token. Where the cookie path asks Better
 * Auth for the session, this reads the user row, so an editor who's lost
 * access loses it for every token they issued too.
 *
 * Returns null unless the user exists, holds `editorRole`, isn't banned, and
 * is still on the sign-in allowlist. The allowlist check matters more here than
 * for a session: taking an email off the list stops the next sign-in, but a
 * token was never going to sign in again.
 */
export async function editorForUser(
  env: LouiseAuthEnv,
  userId: string,
  options: EditorForUserOptions = {},
): Promise<EditorSession | null> {
  const table = `${options.tablePrefix ?? ""}user`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid auth table prefix: ${options.tablePrefix}`);
  }
  const user = await env.DB.prepare(
    `SELECT "id", "email", "name", "role", "banned", "banExpires" FROM "${table}" WHERE "id" = ?`,
  )
    .bind(userId)
    .first<{
      id: string;
      email: string | null;
      name: string | null;
      role: string | null;
      banned: number | null;
      banExpires: string | number | null;
    }>();
  if (!user || user.role !== (options.editorRole ?? "admin")) return null;
  if (user.banned && !banLifted(user.banExpires)) return null;
  const email = (user.email ?? "").trim().toLowerCase();
  const admins = await (options.resolveAdmins ?? defaultResolveAdmins)(env);
  if (!isAllowedSignInEmail(admins, email)) return null;
  return {
    userId: user.id,
    email: user.email ?? "",
    name: user.name || user.email?.split("@")[0] || "Editor",
    role: user.role,
  };
}

/** Whether a ban with this expiry is over. No expiry is a permanent ban, and an
 *  expiry that doesn't parse counts as still banned. */
function banLifted(expires: string | number | null): boolean {
  if (expires == null) return false;
  const at = typeof expires === "number" ? expires : Date.parse(expires);
  return Number.isFinite(at) && at <= Date.now();
}
