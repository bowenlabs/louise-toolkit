// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

import type { LouiseAuthEnv } from "./types.js";

/**
 * Default admin allowlist: `OWNER_EMAIL` + optional `ENGINEER_EMAIL` from env,
 * lowercased, empties dropped (so a missing var never widens access). A
 * multi-tenant platform overrides this via `LouiseAuthConfig.resolveAdmins`
 * with a per-tenant `tenant_admins` lookup.
 */
export function defaultResolveAdmins(env: LouiseAuthEnv): string[] {
  return [env.OWNER_EMAIL, env.ENGINEER_EMAIL]
    .map((e) => e?.trim().toLowerCase())
    .filter((e): e is string => !!e);
}

/** Case-insensitive membership test against a resolved allowlist. */
export function isAllowedSignInEmail(admins: readonly string[], email: string): boolean {
  return admins.includes(email.trim().toLowerCase());
}
