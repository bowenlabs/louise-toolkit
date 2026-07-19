// The auth seam Astroid's generated worker.ts + middleware.ts import
// (`resolveEditor`), plus the Better Auth catch-all the /api/auth route calls.
//
// DB-managed editors: an admin `user` row IS an editor. That table is BOTH the
// role source and the magic-link allowlist — `resolveAdmins` reads it, so only an
// existing editor's email can request a sign-in link. Seed the first editor with
// `pnpm seed:editors`; add more from the Users panel (editorsRoute), never by
// editing env. Magic-link + passkey come from `getLouiseAuth`; no passwords.

import { astroidMailTheme, magicLinkEmail } from "astroidjs";
import { env } from "cloudflare:workers";
import {
  type EditorSession,
  getLouiseAuth,
  handleAuthRequest,
  type LouiseAuth,
  type MagicLinkEmail,
  resolveEditorSession,
} from "louise-toolkit/auth";
import astroidConfig from "../astroid.config.js";

const BRAND = "__BRAND_NAME__";

// Transactional mail theme, derived from your config's brand colours: the
// palette, the masthead colour band, and a contrast-corrected accent. Pass a
// second argument to override any slot.
const MAIL_THEME = astroidMailTheme(astroidConfig);

/** The DB-managed editor allowlist: every admin `user` row. */
async function resolveAdmins(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT email FROM user WHERE role = 'admin'",
  ).all<{ email: string }>();
  return results.map((r) => r.email);
}

/** The branded sign-in email — Astroid's template over your mail theme. */
function renderMagicLinkEmail({ url, toEmail }: { url: string; toEmail: string }): MagicLinkEmail {
  return magicLinkEmail(MAIL_THEME, { url, toEmail });
}

/** The request-scoped Better Auth instance (magic-link + passkey, DB allowlist). */
function getAuth(request: Request): Promise<LouiseAuth> {
  return getLouiseAuth(env, new URL(request.url).origin, {
    rpName: BRAND,
    mailFrom: { email: env.MAIL_FROM, name: BRAND },
    renderMagicLinkEmail,
    resolveAdmins,
  });
}

/**
 * Re-derive the editor session from the signed Better Auth session on every
 * request — the seam the generated worker.ts + middleware.ts call. Null when the
 * caller isn't a signed-in editor, which is what denies edit/write access.
 */
export async function resolveEditor(request: Request): Promise<EditorSession | null> {
  return resolveEditorSession(await getAuth(request), request);
}

/** Better Auth catch-all with the magic-link allowlist gate (see /api/auth). */
export async function handleAuth(request: Request): Promise<Response> {
  return handleAuthRequest(await getAuth(request), request, await resolveAdmins());
}
