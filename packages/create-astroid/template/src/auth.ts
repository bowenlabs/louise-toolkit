// The auth seam Astroid's generated worker.ts + middleware.ts import
// (`resolveEditor`), plus the Better Auth catch-all the /api/auth route calls.
//
// DB-managed editors: an admin `user` row IS an editor. That table is BOTH the
// role source and the magic-link allowlist — `resolveAdmins` reads it, so only an
// existing editor's email can request a sign-in link. Seed the first editor with
// `pnpm seed:editors`; add more from the Users panel (editorsRoute), never by
// editing env. Magic-link + passkey come from `getLouiseAuth`; no passwords.

import { env } from "cloudflare:workers";
import {
  type EditorSession,
  getLouiseAuth,
  handleAuthRequest,
  type LouiseAuth,
  type MagicLinkEmail,
  resolveEditorSession,
} from "louise-toolkit/auth";

const BRAND = "__BRAND_NAME__";

/** The DB-managed editor allowlist: every admin `user` row. */
async function resolveAdmins(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT email FROM user WHERE role = 'admin'",
  ).all<{ email: string }>();
  return results.map((r) => r.email);
}

function renderMagicLinkEmail({ url }: { url: string; toEmail: string }): MagicLinkEmail {
  return {
    subject: `Sign in to ${BRAND}`,
    text: `Sign in to ${BRAND}:\n\n${url}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
    html: `<p>Sign in to <strong>${BRAND}</strong>:</p><p><a href="${url}">Open the ${BRAND} editor</a></p><p style="color:#666">This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
  };
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
