// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// `louise/auth` — the Better Auth setup shared by every Louise site:
// magic-link + passkey editor sign-in (allowlist-gated), optional customer
// email/password, and captcha, behind one configurable, request-scoped factory.
// Framework-agnostic: the site wires these into its Astro middleware/routes.

export {
  getLouiseAuth,
  type LouiseAuth,
  type LouiseAuthConfig,
  type MagicLinkEmail,
  type SessionKV,
} from "./auth.js";
export { defaultResolveAdmins, isAllowedSignInEmail } from "./admins.js";
export { resolveEditorSession, resolveSession } from "./session.js";
export { handleAuthRequest } from "./handler.js";
export { authSchemaOptions, type AuthSchemaConfig, generateAuthSchemaSql } from "./schema-gen.js";
export {
  type EditorContext,
  type EditorRequest,
  hasRole,
  isSameOrigin,
  pick,
  requireEditor,
  requireEditorFromContext,
  requireRole,
  type RoleRequest,
} from "./guard.js";
export {
  activeCaptchaSecret,
  TURNSTILE_PLACEHOLDER,
  TURNSTILE_TEST_SITE_KEY,
  turnstileSecret,
  turnstileSiteKey,
} from "./turnstile.js";
export type { EditorSession, LouiseAuthEnv } from "./types.js";
