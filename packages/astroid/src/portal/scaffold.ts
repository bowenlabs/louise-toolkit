// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The portal's SCAFFOLD-ONCE pieces: the second Better Auth instance, and the
// `App.Locals` / `CloudflareEnv` additions that come with it.
//
// The auth instance is scaffolded rather than generated because a site edits it
// — the reset email, the role a new account gets, extra user columns. What
// Astroid fixes are the three things that must not drift: the mount, the cookie
// prefix, and the table prefix. Get any of those wrong and the two instances
// fight over one origin's cookies, which fails intermittently and looks like a
// session bug rather than a configuration one.

import type { AstroidConfig } from "../config.js";
import { astroidPortal } from "./config.js";

/**
 * `src/portal-auth.ts` — the portal Better Auth instance and its session
 * resolver.
 *
 * Returns null when the project has no portal.
 */
export function generateAstroidPortalAuth(config: AstroidConfig): string | null {
  const portal = astroidPortal(config);
  if (!portal) return null;

  return [
    "// The PORTAL auth instance — customers/members, separate from the editor.",
    "//",
    "// Scaffolded once; yours to edit (the reset email, extra user columns, what",
    "// role a new account gets). Three things should NOT change: the basePath,",
    "// the cookiePrefix, and the tablePrefix. The studio instance keeps Better",
    "// Auth's defaults because the Louise editor client hardcodes them, so this",
    "// one moves — and if the two ever share a cookie prefix, signing into one",
    "// silently signs you out of the other.",
    'import { astroidMailTheme, magicLinkEmail, passwordResetEmail, resolveMailer, sendTransactional } from "astroidjs";',
    'import { env } from "cloudflare:workers";',
    'import { getLouiseAuth } from "louise-toolkit/auth";',
    'import astroidConfig from "../astroid.config.js";',
    "",
    "const MAIL_THEME = astroidMailTheme(astroidConfig);",
    "",
    "/** The request-scoped portal auth instance. */",
    "function getPortalAuth(request: Request) {",
    "  return getLouiseAuth(env, new URL(request.url).origin, {",
    "    rpName: astroidConfig.theme.name,",
    "    mailFrom: { email: env.MAIL_FROM, name: astroidConfig.theme.name },",
    "    // The portal never sends magic links — it's email + password — but the",
    "    // toolkit's config asks for a renderer, so give it the real one.",
    "    renderMagicLinkEmail: ({ url, toEmail }) => magicLinkEmail(MAIL_THEME, { url, toEmail }),",
    `    basePath: ${JSON.stringify(portal.basePath)},`,
    `    cookiePrefix: ${JSON.stringify(portal.cookiePrefix)},`,
    `    tablePrefix: ${JSON.stringify(portal.tablePrefix)},`,
    "    customers: {",
    "      minPasswordLength: 8,",
    portal.signUp
      ? "      // Public sign-up is ON for this project."
      : "      // Accounts are provisioned by staff — no public sign-up.",
    `      disableSignUp: ${!portal.signUp},`,
    "      sendResetPassword: async ({ user, url }) => {",
    "        // Through `resolveMailer`, NOT a hand-built options object: it is the",
    "        // only thing that applies the DUMMY_REPLACE_ME sentinel check. Built by",
    "        // hand, a fresh deploy with a real EMAIL binding but a placeholder",
    "        // MAIL_FROM read as configured and called the Email API with an envelope",
    "        // sender of literally \"DUMMY_REPLACE_ME\" — rejected upstream, swallowed",
    "        // here, and reported to the user as a reset email that was sent.",
    "        const mailer = await resolveMailer(env);",
    "        await sendTransactional(mailer, [",
    "          { to: user.email, content: passwordResetEmail(MAIL_THEME, { url, toEmail: user.email }) },",
    "        ]);",
    "      },",
    "    },",
    "    // The portal has its own users — never the editor allowlist.",
    "    resolveAdmins: () => [],",
    "  });",
    "}",
    "",
    "/** Better Auth catch-all for the portal, mounted at its own basePath. */",
    "export async function handlePortalAuth(request: Request): Promise<Response> {",
    "  const auth = await getPortalAuth(request);",
    "  return auth.handler(request);",
    "}",
    "",
    "/**",
    " * Resolve the signed-in portal user, or null. The generated middleware passes",
    " * this to `resolvePortalSession`, which shares the lookup for the request.",
    " */",
    "export async function resolvePortalUser(request: Request) {",
    "  try {",
    "    const auth = await getPortalAuth(request);",
    "    const session = await auth.api.getSession({ headers: request.headers });",
    "    const user = session?.user;",
    "    if (!user) return null;",
    `    return { id: user.id, email: user.email ?? "", role: user.role ?? ${JSON.stringify(portal.defaultRole)} };`,
    "  } catch {",
    "    // No bindings (plain `astro preview`) → treat as signed out.",
    "    return null;",
    "  }",
    "}",
    "",
  ].join("\n");
}

/**
 * `src/pages/api/portal-auth/[...all].ts` — the portal's Better Auth catch-all,
 * mounted at its own basePath so it never collides with the studio's
 * `/api/auth`.
 *
 * Lives here rather than as a literal in `create-astroid` for the same reason
 * the archetype sections moved (#277): the scaffolder is plain JS, so a drifted
 * import path there is invisible until a user's build fails. It is also the half
 * `generateAstroidPortalAuth` is useless without — `src/portal-auth.ts` exports
 * `handlePortalAuth`, and nothing calls it unless this route exists.
 *
 * Returns null when the project has no portal.
 */
export function generateAstroidPortalAuthRoute(config: AstroidConfig): string | null {
  if (!astroidPortal(config)) return null;
  return [
    "// The portal Better Auth catch-all, mounted at its own basePath so it",
    "// never collides with the studio's /api/auth.",
    'import type { APIRoute } from "astro";',
    'import { handlePortalAuth } from "../../../portal-auth.js";',
    "",
    "export const prerender = false;",
    "",
    "export const ALL: APIRoute = ({ request }) => handlePortalAuth(request);",
    "",
  ].join("\n");
}

/**
 * The `App.Locals` member the portal adds, as a block `create-astroid`
 * substitutes into `src/env.d.ts`. Empty without a portal — a project that
 * types `portalUser` it never sets is inviting a null-check nobody needs.
 */
export function generateAstroidPortalLocals(config: AstroidConfig): string {
  if (!astroidPortal(config)) return "";
  return [
    "    /** The signed-in PORTAL user (customers/members) — distinct from",
    "     *  `editor`, which is the studio session. Null when signed out. */",
    '    portalUser: import("astroidjs").PortalUser | null;',
  ].join("\n");
}
