// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Request-scoped Better Auth factory for Louise sites. Built PER REQUEST — the
// D1 binding and Secrets-Store secret only exist at request time on Workers, so
// this can never be a module-level singleton. Better Auth 1.5+ speaks D1
// natively: pass the binding straight to `database` (it uses D1's batch() for
// atomicity; D1 has no interactive transactions).
//
// Plugins, always on: magic-link (editor sign-in, allowlist-gated in the route
// handler), admin (owner/editor roles), passkey (WebAuthn — rpID is derived
// per request from `baseURL`, so passkeys bind to the site's own origin, dev
// and prod alike). Captcha (Turnstile) mounts only when configured. Customer
// email/password + extra user fields are opt-in.

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { admin, captcha, magicLink, organization } from "better-auth/plugins";
import { sendEmail } from "../email/index.js";
import { getSessionSecret, type KVLike } from "../security/index.js";
import { defaultResolveAdmins } from "./admins.js";
import { LOUISE_USER_FIELDS } from "./fields.js";
import { invitationAcceptUrl } from "./org.js";
import { activeCaptchaSecret, turnstileSecret } from "./turnstile.js";
import type { LouiseAuthEnv } from "./types.js";

type BetterAuthOptions = Parameters<typeof betterAuth>[0];
type AdditionalFields = NonNullable<NonNullable<BetterAuthOptions["user"]>["additionalFields"]>;

/** Workers KV shape the session cache needs — `get`/`put` (from KVLike) + delete. */
export interface SessionKV extends KVLike {
  delete(key: string): Promise<void>;
}

/** The rendered magic-link email a site supplies via config. */
export interface MagicLinkEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Multi-editor tenancy via the Better Auth organization plugin (issue #100):
 * multiple editors/roles per organization, org-scoped membership + invitations,
 * and optional teams. Enabling it adds the `organization`/`member`/`invitation`
 * tables (plus `team`/`teamMember` when `teams` is on) and an
 * `activeOrganizationId` column on `session`, so the SAME shape MUST be set on
 * `AuthSchemaConfig.organizations` when regenerating the migration — otherwise
 * the committed schema drifts from what the runtime queries ("always generate,
 * never hand-roll"). Editor access for members is gated by `resolveOrgEditor`
 * (org role), a second axis beside the global admin allowlist.
 */
export interface LouiseOrganizationsConfig {
  /** Enable teams within organizations (adds the `team`/`teamMember` tables and
   *  an `activeTeamId` column on `session`). Off by default. */
  teams?: boolean;
  /** Let any signed-in user create an organization (Better Auth's default).
   *  Set false to restrict creation to your own server-side/provisioning flow.
   *  Runtime-only — does not affect the generated schema. */
  allowUserToCreateOrganization?: boolean;
  /** Render the member-invitation email body (site branding), mirroring
   *  `renderMagicLinkEmail`. Wiring it turns on invite emails: the factory
   *  builds the accept `url` from the invitation id + `acceptInvitationPath`,
   *  renders via this, and sends over the `EMAIL` binding (dev logs the link).
   *  Omit to skip invite emails — invitations are still created and acceptable
   *  through the API/client. Reuses the {@link MagicLinkEmail} rendered shape. */
  renderInvitationEmail?: (args: {
    /** The accept-invitation link to embed (see `invitationAcceptUrl`). */
    url: string;
    /** The invitee's email (the `to` address). */
    toEmail: string;
    /** The organization the invitee is being asked to join. */
    organizationName: string;
    /** The email of the member who sent the invite. */
    inviterEmail: string;
    /** The org role the invitee is being granted (e.g. "member", "admin"). */
    role: string;
  }) => MagicLinkEmail;
  /** Path the invitation accept `url` points at, joined to the site origin with
   *  `?id=<invitationId>`. Default `/organization/accept-invitation`. */
  acceptInvitationPath?: string;
}

export interface LouiseAuthConfig {
  /** Passkey relying-party display name, e.g. "Meg Bowen Studio". */
  rpName: string;
  /** `from` address for the magic-link email. */
  mailFrom: { email: string; name?: string };
  /** Render the magic-link email body (site branding). */
  renderMagicLinkEmail: (args: { url: string; toEmail: string }) => MagicLinkEmail;
  /** Resolve the admin allowlist. Defaults to `OWNER_EMAIL`/`ENGINEER_EMAIL`
   *  from env; override to source it elsewhere (e.g. a DB lookup). */
  resolveAdmins?: (env: LouiseAuthEnv) => string[] | Promise<string[]>;
  /** Enable customer email/password sign-in/up. Omit for an admin-only editor. */
  customers?: { minPasswordLength?: number; requireEmailVerification?: boolean };
  /** Extra Better Auth user columns (e.g. `squareCustomerId`). */
  additionalFields?: AdditionalFields;
  /** Table-name prefix for a same-D1 auth boundary (issue #15, Option B), e.g.
   *  `"auth_"`. Renames the auth tables so they're a visible namespace in one
   *  database; MUST match the prefix passed to `generateAuthSchemaSql`. Omit for
   *  default table names (identical to prior behavior). */
  tablePrefix?: string;
  /** Session lifetime overrides (defaults: 45-day rolling, daily refresh). */
  session?: { expiresIn?: number; updateAge?: number };
  /** Cache sessions in KV (`secondaryStorage` + `storeSessionInDatabase`): D1
   *  stays the source of truth, KV is the global read cache. Omit for D1-only. */
  sessionCacheKv?: SessionKV;
  /** Enable multi-editor tenancy (organization plugin). Omit for a single-editor
   *  site. Mirror this on `AuthSchemaConfig.organizations` when regenerating the
   *  migration. See {@link LouiseOrganizationsConfig}. */
  organizations?: LouiseOrganizationsConfig;
  /** Additional Better Auth plugins. */
  extraPlugins?: NonNullable<BetterAuthOptions["plugins"]>;
  /** localhost-only dev secret passed to `getSessionSecret`. */
  devSecret?: string;
  /** Display name for newly-created non-admin users (default "Editor"). */
  defaultUserName?: string;
}

/**
 * KV-backed Better Auth `secondaryStorage`. Clamps TTL to KV's 60s minimum so
 * a short-lived write (e.g. Better Auth's internal rate limiter) can't error.
 */
function kvSecondaryStorage(kv: SessionKV): NonNullable<BetterAuthOptions["secondaryStorage"]> {
  return {
    get: (key) => kv.get(key),
    set: async (key, value, ttl) => {
      await kv.put(key, value, ttl ? { expirationTtl: Math.max(ttl, 60) } : undefined);
    },
    delete: (key) => kv.delete(key),
  };
}

/** The current user on a resolved session (Better Auth + admin-plugin `role`). */
export interface LouiseSessionUser {
  id: string;
  email?: string;
  name?: string;
  role?: string;
}

/**
 * The slice of the Better Auth instance Louise uses and re-exposes. Hand-written
 * rather than the inferred `betterAuth()` type on purpose: the passkey plugin's
 * inferred type pulls in `@simplewebauthn/server` and `zod` internals that
 * aren't nameable in a published `.d.ts` (TS2742), and pinning the surface here
 * also insulates consumers from Better Auth's internal type churn.
 */
export interface LouiseAuth {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user?: LouiseSessionUser | null;
      // Present with the organization plugin: the session's active org, if the
      // client has selected one (see `activeOrganizationId` in ./org.ts).
      session?: { activeOrganizationId?: string | null } | null;
    } | null>;
  };
}

/**
 * Construct the request-scoped auth instance. `baseURL` is the site origin
 * (Better Auth signs callback URLs and binds the passkey rpID against it);
 * derive it from the request.
 */
export async function getLouiseAuth(
  env: LouiseAuthEnv,
  baseURL: string,
  config: LouiseAuthConfig,
): Promise<LouiseAuth> {
  const url = new URL(baseURL);
  const host = url.hostname;
  const isDev = host === "localhost" || host === "127.0.0.1";
  const secret = await getSessionSecret(env.SESSION_SECRET, url, config.devSecret);
  const admins = (await (config.resolveAdmins ?? defaultResolveAdmins)(env)).map((e) =>
    e.trim().toLowerCase(),
  );
  const captchaKey = activeCaptchaSecret(env, await turnstileSecret(env));
  const isAdmin = (email: string | null | undefined) =>
    admins.includes((email ?? "").trim().toLowerCase());

  // Same-D1 auth namespace (issue #15, Option B): when set, every auth table is
  // renamed `<prefix><model>` so it queries the same tables the namespaced
  // `generateAuthSchemaSql` emits. Empty prefix → default names, no overrides.
  const prefix = config.tablePrefix ?? "";
  const userOptions = {
    ...(prefix ? { modelName: `${prefix}user` } : {}),
    // Louise's standard first/last name fields, ahead of the site's own extras.
    additionalFields: { ...LOUISE_USER_FIELDS, ...config.additionalFields },
  };

  // Member-invitation email (org plugin): only wired when the site provides a
  // renderer. Captured as a const so its narrowed (non-undefined) type carries
  // into the `sendInvitationEmail` closure below.
  const renderInvite = config.organizations?.renderInvitationEmail;
  const acceptPath = config.organizations?.acceptInvitationPath;

  return betterAuth({
    database: env.DB,
    baseURL,
    secret,
    // Single custom domain in prod, localhost in dev.
    trustedOrigins: [baseURL],
    ...(config.sessionCacheKv
      ? { secondaryStorage: kvSecondaryStorage(config.sessionCacheKv) }
      : {}),
    session: {
      expiresIn: config.session?.expiresIn ?? 60 * 60 * 24 * 45,
      updateAge: config.session?.updateAge ?? 60 * 60 * 24,
      // D1 stays authoritative so a KV TTL lapse recovers instead of logging out.
      ...(config.sessionCacheKv ? { storeSessionInDatabase: true } : {}),
      ...(prefix ? { modelName: `${prefix}session` } : {}),
    },
    account: {
      accountLinking: { enabled: false },
      ...(prefix ? { modelName: `${prefix}account` } : {}),
    },
    ...(prefix ? { verification: { modelName: `${prefix}verification` } } : {}),
    ...(config.customers
      ? {
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: config.customers.requireEmailVerification ?? false,
            minPasswordLength: config.customers.minPasswordLength ?? 8,
          },
        }
      : {}),
    ...(Object.keys(userOptions).length ? { user: userOptions } : {}),
    databaseHooks: {
      user: {
        create: {
          // Configured admins → "admin" (editor role); everyone else → "user".
          // Default the display name so the required `name` column is never blank.
          before: async (user) => ({
            data: {
              ...user,
              name: user.name || user.email?.split("@")[0] || config.defaultUserName || "Editor",
              role: isAdmin(user.email) ? "admin" : "user",
            },
          }),
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url: link }) => {
          // Local dev has no EMAIL binding — log the link instead.
          if (isDev) {
            console.log(`[dev] Magic link for ${email}: ${link}`);
            return;
          }
          const mail = config.renderMagicLinkEmail({ url: link, toEmail: email });
          await sendEmail(env.EMAIL, {
            from: config.mailFrom,
            to: email,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          });
        },
      }),
      admin(),
      // rpID is origin-bound: a localhost-enrolled passkey won't work on prod.
      passkey({
        rpID: host,
        rpName: config.rpName,
        origin: baseURL,
        ...(prefix ? { schema: { passkey: { modelName: `${prefix}passkey` } } } : {}),
      }),
      ...(captchaKey
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: captchaKey,
              endpoints: ["/sign-in/magic-link"],
            }),
          ]
        : []),
      // Multi-editor tenancy (issue #100). The `schema` model-name overrides
      // keep the org tables inside the same-D1 auth namespace when `tablePrefix`
      // is set — the same way user/session/passkey are prefixed above — so the
      // runtime queries the exact tables `generateAuthSchemaSql` emits.
      ...(config.organizations
        ? [
            organization({
              ...(config.organizations.teams ? { teams: { enabled: true } } : {}),
              ...(config.organizations.allowUserToCreateOrganization !== undefined
                ? {
                    allowUserToCreateOrganization:
                      config.organizations.allowUserToCreateOrganization,
                  }
                : {}),
              // Invite email: mirror `sendMagicLink` — dev logs the accept link,
              // prod renders (site branding) + sends over the EMAIL binding.
              // Better Auth returns only the invitation id; we build the URL.
              sendInvitationEmail: renderInvite
                ? async (data) => {
                    const link = invitationAcceptUrl(baseURL, data.id, acceptPath);
                    if (isDev) {
                      console.log(
                        `[dev] Invitation for ${data.email} → ${data.organization.name}: ${link}`,
                      );
                      return;
                    }
                    const mail = renderInvite({
                      url: link,
                      toEmail: data.email,
                      organizationName: data.organization.name,
                      inviterEmail: data.inviter.user.email,
                      role: data.role,
                    });
                    await sendEmail(env.EMAIL, {
                      from: config.mailFrom,
                      to: data.email,
                      subject: mail.subject,
                      html: mail.html,
                      text: mail.text,
                    });
                  }
                : undefined,
              ...(prefix
                ? {
                    schema: {
                      organization: { modelName: `${prefix}organization` },
                      member: { modelName: `${prefix}member` },
                      invitation: { modelName: `${prefix}invitation` },
                      ...(config.organizations.teams
                        ? {
                            team: { modelName: `${prefix}team` },
                            teamMember: { modelName: `${prefix}teamMember` },
                          }
                        : {}),
                    },
                  }
                : {}),
            }),
          ]
        : []),
      ...(config.extraPlugins ?? []),
    ],
    // The concrete Better Auth instance carries the full plugin-inferred type;
    // narrow it to the portable, hand-written surface above at this boundary.
  }) as unknown as LouiseAuth;
}
