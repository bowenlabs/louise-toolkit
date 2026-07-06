// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

// Request-scoped Better Auth factory for Louise sites. Built PER REQUEST — the
// D1 binding and Secrets-Store secret only exist at request time on Workers, so
// this can never be a module-level singleton. Better Auth 1.5+ speaks D1
// natively: pass the binding straight to `database` (it uses D1's batch() for
// atomicity; D1 has no interactive transactions).
//
// Plugins, always on: magic-link (studio sign-in, allowlist-gated in the route
// handler), admin (owner/editor roles), passkey (WebAuthn — rpID is derived
// per request from `baseURL`, so a multi-tenant deployment gets the correct
// origin-bound relying party for each tenant). Captcha (Turnstile) mounts only
// when configured. Customer email/password + extra user fields are opt-in.

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { admin, captcha, magicLink } from "better-auth/plugins";
import { sendEmail } from "../email/index.js";
import { getSessionSecret, type KVLike } from "../security/index.js";
import { defaultResolveAdmins } from "./admins.js";
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

export interface LouiseAuthConfig {
  /** Passkey relying-party display name, e.g. "Meg Bowen Studio". */
  rpName: string;
  /** `from` address for the magic-link email. */
  mailFrom: { email: string; name?: string };
  /** Render the magic-link email body (site branding). */
  renderMagicLinkEmail: (args: { url: string; toEmail: string }) => MagicLinkEmail;
  /** Resolve the admin allowlist. Defaults to `OWNER_EMAIL`/`ENGINEER_EMAIL`
   *  from env; a platform passes a per-tenant `tenant_admins` lookup. */
  resolveAdmins?: (env: LouiseAuthEnv) => string[] | Promise<string[]>;
  /** Enable customer email/password sign-in/up. Omit for an admin-only studio. */
  customers?: { minPasswordLength?: number; requireEmailVerification?: boolean };
  /** Extra Better Auth user columns (e.g. `squareCustomerId`). */
  additionalFields?: AdditionalFields;
  /** Session lifetime overrides (defaults: 45-day rolling, daily refresh). */
  session?: { expiresIn?: number; updateAge?: number };
  /** Cache sessions in KV (`secondaryStorage` + `storeSessionInDatabase`): D1
   *  stays the source of truth, KV is the global read cache. Omit for D1-only. */
  sessionCacheKv?: SessionKV;
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
    getSession(input: { headers: Headers }): Promise<{ user?: LouiseSessionUser | null } | null>;
  };
}

/**
 * Construct the request-scoped auth instance. `baseURL` is the tenant origin
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
    },
    account: { accountLinking: { enabled: false } },
    ...(config.customers
      ? {
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: config.customers.requireEmailVerification ?? false,
            minPasswordLength: config.customers.minPasswordLength ?? 8,
          },
        }
      : {}),
    ...(config.additionalFields ? { user: { additionalFields: config.additionalFields } } : {}),
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
      passkey({ rpID: host, rpName: config.rpName, origin: baseURL }),
      ...(captchaKey
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: captchaKey,
              endpoints: ["/sign-in/magic-link"],
            }),
          ]
        : []),
      ...(config.extraPlugins ?? []),
    ],
    // The concrete Better Auth instance carries the full plugin-inferred type;
    // narrow it to the portable, hand-written surface above at this boundary.
  }) as unknown as LouiseAuth;
}
