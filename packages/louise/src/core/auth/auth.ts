// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Request-scoped Better Auth factory for Louise sites. Built PER REQUEST—the
// D1 binding and Secrets-Store secret only exist at request time on Workers, so
// this can never be a module-level singleton. Better Auth 1.5+ speaks D1
// natively: pass the binding straight to `database` (it uses D1's batch() for
// atomicity; D1 has no interactive transactions).
//
// Plugins, always on: magic-link (editor sign-in, allowlist-gated, unless
// customers sign in by link too) and passkey (WebAuthn—rpID is derived per
// request from `baseURL`, so passkeys bind to the site's own origin, dev and
// prod alike). Admin (owner/editor roles and the user-administration endpoints)
// is on for an editor-only instance and off for any instance with `customers`
// set unless the site sets `customers.adminEndpoints`. Captcha (Turnstile) mounts only when configured.
// Customer sign-in (password or magic link) and extra user fields are opt-in.

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin, captcha, magicLink, organization } from "better-auth/plugins";
import { reportDegraded } from "../degraded.js";
import { sendEmail } from "../email/index.js";
import {
  type DurableRateLimitStorage,
  durableRateLimitStorage,
  getSessionSecret,
  type KVLike,
  type RateLimitNamespace,
} from "../security/index.js";
import { defaultResolveAdmins } from "./admins.js";
import { LOUISE_USER_FIELDS } from "./fields.js";
import { invitationAcceptUrl } from "./org.js";
import { activeCaptchaSecret, TURNSTILE_PLACEHOLDER, turnstileSecret } from "./turnstile.js";
import type { LouiseAuthEnv } from "./types.js";

type BetterAuthOptions = Parameters<typeof betterAuth>[0];
type AdditionalFields = NonNullable<NonNullable<BetterAuthOptions["user"]>["additionalFields"]>;

/** Workers KV shape the session cache needs—`get`/`put` (from KVLike) + delete. */
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
 * `AuthSchemaConfig.organizations` when regenerating the migration—otherwise
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
   *  Runtime-only—does not affect the generated schema. */
  allowUserToCreateOrganization?: boolean;
  /** Render the member-invitation email body (site branding), mirroring
   *  `renderMagicLinkEmail`. Wiring it turns on invite emails: the factory
   *  builds the accept `url` from the invitation id + `acceptInvitationPath`,
   *  renders via this, and sends over the `EMAIL` binding (dev logs the link).
   *  Omit to skip invite emails—invitations are still created and acceptable
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
    /** The org role the invitee is being granted (for example, "member", "admin"). */
    role: string;
  }) => MagicLinkEmail;
  /** Path the invitation accept `url` points at, joined to the site origin with
   *  `?id=<invitationId>`. Default `/organization/accept-invitation`. */
  acceptInvitationPath?: string;
}

export interface LouiseAuthConfig {
  /** Passkey relying-party display name, for example, "Meg Bowen Studio". */
  rpName: string;
  /**
   * Passkey relying-party ID. Defaults to the request origin's hostname, which
   * is right for a single-origin site and wrong the moment an admin app lives on
   * its own subdomain: origin-derived means `example.com` and
   * `studio.example.com` mint **two separate passkeys** for the same person.
   *
   * Pin it to the apex (`"example.com"`) and one passkey authenticates on both,
   * because a credential registered for a domain is usable on its subdomains.
   *
   * **The sessions stay separate, and that is the point.** Sharing a credential
   * is not sharing a login. Pair this with **host-only cookies**—no `Domain`
   * attribute, `crossSubDomainCookies` off (the default)—and a distinct
   * {@link LouiseAuthConfig.cookiePrefix} per instance. Widening the cookie to
   * the parent domain would broadcast the admin session to every sibling
   * subdomain, including untrusted tenant storefronts, which is the failure this
   * option exists to avoid rather than cause.
   *
   * Must be the origin's own domain or a parent of it; a browser rejects a
   * registration whose rpID is neither, so a typo fails at enrolment rather than
   * silently. Note rpID is a bare **domain**, never a scheme or a port.
   */
  rpID?: string;
  /** `from` address for the magic-link email. */
  mailFrom: { email: string; name?: string };
  /** Render the magic-link email body (site branding). */
  renderMagicLinkEmail: (args: { url: string; toEmail: string }) => MagicLinkEmail;
  /** Resolve the admin allowlist. Defaults to `OWNER_EMAIL`/`ENGINEER_EMAIL`
   *  from env; override to source it elsewhere (for example, a DB lookup). */
  resolveAdmins?: (env: LouiseAuthEnv) => string[] | Promise<string[]>;
  /** Enable customer sign-in and sign-up. Omit for an admin-only editor. */
  customers?: {
    /**
     * How customers sign in. Default `"password"`: email and password, with the
     * password options below.
     *
     * `"magic-link"` turns email and password off and opens the magic-link
     * endpoint to every address instead of only the admin allowlist: anyone can
     * ask for a one-time link, and following it signs them in, creating the
     * account unless `disableSignUp` is set. The link itself verifies the
     * account's email. Serve the instance with `auth.handler`, not
     * {@link handleAuthRequest}, whose gate admits only admins.
     *
     * Because a stranger can make the site send mail, three things guard the
     * endpoint, and two of them are the site's to turn on:
     *
     * - **Better Auth's rate limiter**, on for every instance off localhost.
     *   Set {@link LouiseAuthConfig.rateLimitDo} too: the KV and in-memory
     *   fallbacks undercount under a burst.
     * - **Turnstile**, only when both a real secret and a real site key are
     *   set. With the test keys, which every Worker Preview gets, or with none,
     *   the captcha is off, so the endpoint mails any address that asks. Each
     *   link sent that way off localhost logs an `auth.magic-link-no-captcha`
     *   degrade.
     * - **{@link LouiseAuthConfig.waitUntil}**, so the send leaves the response
     *   path and the endpoint answers in the same time whether or not it mails.
     */
    signIn?: "password" | "magic-link";
    /** Password sign-in only. Default 8. */
    minPasswordLength?: number;
    /** Password sign-in only. A link proves the address, so it needs no flag. */
    requireEmailVerification?: boolean;
    /** Close public sign-up—accounts are provisioned by staff instead. With
     *  `"magic-link"`, an address with no account gets no email at all; set
     *  {@link LouiseAuthConfig.waitUntil}, or the response time shows which
     *  addresses have one. */
    disableSignUp?: boolean;
    /** Password sign-in only. Revoke existing sessions when a password is
     *  reset. Default `true`: a reset usually means the old credentials are
     *  compromised. */
    revokeSessionsOnPasswordReset?: boolean;
    /** Password sign-in only. Send the self-serve reset link. Omit to leave
     *  reset unavailable. */
    sendResetPassword?: (args: { user: { email: string }; url: string }) => Promise<void> | void;
    /**
     * Mount Better Auth's admin endpoints on this instance. Default `false`.
     *
     * The admin plugin serves user administration at `<basePath>/admin/*`:
     * listing, creating, and removing users, setting roles, banning, and
     * impersonation. Their only check is the session user's `role`, and a
     * customer instance has no use for them, so it leaves them off.
     *
     * Off, the instance keeps what the plugin did for every request: the `role`
     * and ban columns stay in the user table and on the session user, a new
     * account still gets its role, and a banned user can't start a new session.
     * A ban set in the database doesn't end the sessions the user already has;
     * delete their rows in the `session` table, and their entries in
     * {@link LouiseAuthConfig.sessionCacheKv} when it's set. The schema doesn't
     * change, so turning this on or off needs no migration.
     *
     * One instance that serves both editors and customers counts as a customer
     * instance, so it loses these endpoints too. Setting this on it gives every
     * editor, who holds the `admin` role, the power to list, remove, and
     * impersonate every customer.
     *
     * Set it only when the site administers its customers through these
     * endpoints, and make sure no customer row can hold an admin role.
     */
    adminEndpoints?: boolean;
  };
  /**
   * Mount point for this instance's routes. Default `/api/auth`.
   *
   * The reason this is configurable: a site can run TWO instances on one origin
   * (the editor studio and a customer portal), and they must not share a mount.
   * The studio keeps the default, because the Louise editor client hardcodes it;
   * a second instance takes its own.
   */
  basePath?: string;
  /**
   * Cookie name prefix. Default Better Auth's own (`better-auth`).
   *
   * Two instances on one origin MUST differ here, or their session cookies
   * collide and signing into one silently signs you out of the other.
   */
  cookiePrefix?: string;
  /** Extra Better Auth user columns (for example, `squareCustomerId`). */
  additionalFields?: AdditionalFields;
  /** Table-name prefix for a same-D1 auth boundary (issue #15, Option B), for example,
   *  `"auth_"`. Renames the auth tables so they're a visible namespace in one
   *  database; MUST match the prefix passed to `generateAuthSchemaSql`. Omit for
   *  default table names (identical to prior behavior). */
  tablePrefix?: string;
  /** Session lifetime overrides (defaults: 45-day rolling, daily refresh). */
  session?: { expiresIn?: number; updateAge?: number };
  /** Cache sessions in KV (`secondaryStorage` + `storeSessionInDatabase`): D1
   *  stays the source of truth, KV is the global read cache. Omit for D1-only. */
  sessionCacheKv?: SessionKV;
  /**
   * Where single-use verification values—magic links, password resets—are
   * stored and consumed. Only meaningful alongside {@link sessionCacheKv};
   * without it there is no secondary storage and these always live in D1.
   *
   * Defaults to `"database"`, and that default is a security one. Better Auth
   * 1.7 requires `SecondaryStorage.getAndDelete` to be atomic precisely so one
   * of these values cannot be consumed twice. Over KV it cannot be—there is
   * no atomic primitive, and KV's cross-colo convergence widens the replay
   * window well past a simple race. D1 is strongly consistent and deletes
   * atomically, so consuming from there closes it, and KV stays what it is
   * meant to be here: a session read cache.
   *
   * `"secondary"` restores the pre-0.27 behaviour (consume from KV). It trades
   * that guarantee for one less D1 read on the verification path; take it only
   * if you have measured that read and decided it matters.
   */
  verificationStorage?: "database" | "secondary";
  /**
   * Durable Object namespace backing Better Auth's own rate limiter.
   *
   * The limiter itself is on for every instance unless the host in `baseURL`
   * is `localhost` or `127.0.0.1`, whether or not this is set; this only
   * chooses where it counts. Better Auth enables it by itself only when
   * `NODE_ENV` is `production`, which a Worker never sets, so the factory turns
   * it on. It keys each count on the instance (host and `basePath`), the
   * `CF-Connecting-IP` header, and the path, and answers a burst with a 429.
   * Its default budgets, per address and path, are 100 requests per 10
   * seconds, 3 per 10 seconds on sign-in and sign-up, and 5 a minute each for
   * sending and following a magic link.
   *
   * Wire this and rate limiting stops going through KV entirely: Better Auth
   * checks `rateLimit.customStorage` BEFORE secondary storage, so the KV
   * `increment` is never called. That matters because a DO is the only atomic
   * counter on Workers—it handles one request at a time, so read-decide-write
   * inside it cannot race. The KV path can undercount under a burst, and
   * Cloudflare's native Rate Limiting binding is documented as permissive,
   * eventually consistent, and scoped PER LOCATION, so an attacker spread across
   * colos gets one budget per colo. Acceptable for form spam; weak for sign-in.
   *
   * The site owns the `DurableObject` subclass and the wrangler binding—see
   * `createRateLimiter` in `louise-toolkit/security` for the shape. One object
   * per key, so no single object becomes a bottleneck.
   *
   * Omit to count in KV when `sessionCacheKv` is set, otherwise in a map in
   * the isolate's memory, which each isolate keeps on its own.
   */
  rateLimitDo?: RateLimitNamespace;
  /**
   * The runtime's `waitUntil`, from `cloudflare:workers` or the request's
   * execution context. Better Auth hands it the work it can finish after the
   * response: here, sending a magic-link email. Without it the endpoint
   * waits for the send, so how long it takes tells a caller whether an email
   * went out, which matters once a customer instance mails only existing
   * accounts (`customers.disableSignUp` with `signIn: "magic-link"`).
   *
   * A failed send in the background is logged, not returned: the person sees
   * the same "check your inbox" either way.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
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
 * The user columns Better Auth's admin plugin declares, for an instance that
 * leaves the plugin off. Declared here instead, the instance still writes and
 * reads `role` and the ban state, so the session user keeps its `role` and the
 * generated schema, which always includes them, stays the one the runtime uses.
 * `input: false`, as in the plugin, so no one sets their own role or ban
 * through `update-user` or sign-up.
 */
const ADMIN_USER_FIELDS = {
  role: { type: "string", required: false, input: false },
  banned: { type: "boolean", defaultValue: false, required: false, input: false },
  banReason: { type: "string", required: false, input: false },
  banExpires: { type: "date", required: false, input: false },
} as const;

/** KV's floor for `expirationTtl`. Shorter TTLs are rejected outright. */
const KV_MIN_TTL_SEC = 60;

/**
 * KV-backed Better Auth `secondaryStorage`. Clamps TTL to KV's 60-second minimum so
 * a short-lived write (for example, Better Auth's internal rate limiter) can't error.
 *
 * Better Auth 1.7 added two methods to this interface, both specified as
 * *atomic*. Cloudflare KV has no atomic primitives and is eventually consistent,
 * so neither can be honoured exactly—the same constraint `security/rate-limit`
 * documents for its own KV counters. What each one does here, and what it costs:
 *
 *   - `increment`—a fixed-window counter, bucketed by `floor(now / ttl)` the
 *     way `security/rate-limit` does it, rather than one long-lived key. A clock
 *     bucket is what makes the window actually *reset*: KV cannot set a value
 *     without also setting a TTL, so a single key would have its expiry pushed
 *     forward on every write and a busy client would never be unblocked. The
 *     read→write gap can undercount under a burst, which lets a few extra
 *     requests through but never wrongly blocks; a client can also get up to ~2x
 *     the budget across a bucket boundary. Both fail safe for legitimate users.
 *     Note the TTL floor above interacts with Better Auth's default 10-second window:
 *     the bucket key still rotates every 10 seconds, so the limit is enforced over the
 *     intended window and only the spent bucket lingers (unread) for 60 seconds.
 *
 *     **This is the fallback, not the recommendation.** Set
 *     {@link LouiseAuthConfig.rateLimitDo} and none of the above applies: Better
 *     Auth checks `rateLimit.customStorage` before secondary storage, so this
 *     method is never called and the counter becomes a Durable Object, which is
 *     genuinely atomic. This path remains for sites that have not provisioned
 *     one.
 *
 *   - `getAndDelete`—a read followed by a delete. Better Auth requires this to
 *     be atomic so a single-use verification value (magic link, password reset)
 *     cannot be consumed twice; over KV it cannot be, and KV's cross-colo
 *     convergence widens the replay window well past a simple race.
 *
 *     Which is why, by default, nothing reaches it: `verificationStorage`
 *     defaults to `"database"`, so those values are consumed from D1 and this
 *     method only ever sees whatever else Better Auth chooses to route through
 *     secondary storage. It is implemented honestly rather than removed because
 *     a site can opt back in with `verificationStorage: "secondary"`, and
 *     because Better Auth may consume other single-use values here later.
 */
export function kvSecondaryStorage(
  kv: SessionKV,
): NonNullable<BetterAuthOptions["secondaryStorage"]> {
  const putWithTtl = (key: string, value: string, ttl?: number) =>
    kv.put(key, value, ttl ? { expirationTtl: Math.max(ttl, KV_MIN_TTL_SEC) } : undefined);
  return {
    get: (key) => kv.get(key),
    set: async (key, value, ttl) => {
      await putWithTtl(key, value, ttl);
    },
    delete: (key) => kv.delete(key),
    getAndDelete: async (key) => {
      const value = await kv.get(key);
      // Skip the delete when there was nothing there—a miss is the common case
      // on a replayed or expired link, and KV writes are the metered operation.
      if (value !== null) await kv.delete(key);
      return value;
    },
    increment: async (key, ttl) => {
      const window = Math.max(ttl, 1);
      const bucket = `${key}:${Math.floor(Date.now() / 1000 / window)}`;
      const next = (Number(await kv.get(bucket)) || 0) + 1;
      await putWithTtl(bucket, String(next), window);
      return next;
    },
  };
}

/** Better Auth's in-memory limit, kept per isolate. Module state, so the count
 *  outlives the per-request instance; the cap stops a flood of addresses from
 *  growing it without bound. */
const memoryCounts = new Map<string, { count: number; resetAt: number }>();
const MEMORY_COUNTS_MAX = 10_000;

/**
 * Where Better Auth's limiter counts when the site hasn't wired `rateLimitDo`:
 * KV when `sessionCacheKv` is set, the same fixed window Better Auth's
 * secondary storage uses, otherwise a map in the isolate's memory. Both are
 * Better Auth's own fallbacks, rebuilt here so that {@link scopedRateLimitStorage}
 * can sit in front of them; Better Auth offers no way to change a key before it
 * reaches its built-in stores.
 */
function fallbackRateLimitStorage(kv: SessionKV | undefined): DurableRateLimitStorage {
  if (kv) {
    const { increment } = kvSecondaryStorage(kv);
    return {
      consume: async (key, rule) =>
        (await increment(key, rule.window)) <= rule.max
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: rule.window },
    };
  }
  return {
    consume: async (key, rule) => {
      const now = Date.now();
      if (memoryCounts.size >= MEMORY_COUNTS_MAX) {
        for (const [k, v] of memoryCounts) if (now >= v.resetAt) memoryCounts.delete(k);
        // Still full of live counts: drop the oldest, as Better Auth's own map
        // does, rather than clearing them all and resetting every budget.
        for (const k of memoryCounts.keys()) {
          if (memoryCounts.size < MEMORY_COUNTS_MAX) break;
          memoryCounts.delete(k);
        }
      }
      const entry = memoryCounts.get(key);
      if (!entry || now >= entry.resetAt) {
        memoryCounts.set(key, { count: 1, resetAt: now + rule.window * 1000 });
        return { allowed: true, retryAfter: null };
      }
      if (entry.count >= rule.max) {
        return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
      }
      entry.count += 1;
      return { allowed: true, retryAfter: null };
    },
  };
}

/**
 * Prefix every rate-limit key with the instance it belongs to. Better Auth keys
 * a count on the client address and the path with `basePath` removed, so an
 * editor at `/api/auth` and a customer instance at `/api/shop-auth` would both
 * count `/sign-in/magic-link` in one bucket: customers asking for links from a
 * shop's Wi-Fi would spend the owner's sign-in budget. The host keeps two sites
 * on one Worker apart the same way.
 */
function scopedRateLimitStorage(
  scope: string,
  inner: DurableRateLimitStorage,
): DurableRateLimitStorage {
  return { consume: (key, rule) => inner.consume(`${scope}|${key}`, rule) };
}

/** The current user on a resolved session (Better Auth's user, with the admin
 *  plugin's `role`, which a customer instance declares itself). */
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
    /**
     * Ends the session the request's cookie names and returns Better Auth's
     * response, whose `set-cookie` headers expire the session cookies. Pass it
     * to `redirectWithCookies` to sign someone out from a server-rendered route.
     */
    signOut(input: { headers: Headers; asResponse: true }): Promise<Response>;
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
  // The placeholder sentinel scaffolds seed every secret with reads as unset
  // here, as it does for Turnstile, so a deploy that never replaced it fails
  // closed instead of signing sessions with a publicly known key.
  const secret = await getSessionSecret(env.SESSION_SECRET, url, config.devSecret, {
    placeholder: TURNSTILE_PLACEHOLDER,
  });
  const admins = (await (config.resolveAdmins ?? defaultResolveAdmins)(env)).map((e) =>
    e.trim().toLowerCase(),
  );
  const captchaKey = activeCaptchaSecret(env, await turnstileSecret(env));
  const isAdmin = (email: string | null | undefined) =>
    admins.includes((email ?? "").trim().toLowerCase());
  // Customers sign in by magic link: the endpoint opens to every address and
  // email and password stay off (see `customers.signIn`).
  const customerLinks = config.customers?.signIn === "magic-link";
  const customerSignUpClosed = customerLinks && !!config.customers?.disableSignUp;
  // A customer instance leaves the admin endpoints off unless the site asks for
  // them (see `customers.adminEndpoints`).
  const adminEndpoints = !config.customers || config.customers.adminEndpoints === true;

  // Same-D1 auth namespace (issue #15, Option B): when set, every auth table is
  // renamed `<prefix><model>` so it queries the same tables the namespaced
  // `generateAuthSchemaSql` emits. Empty prefix → default names, no overrides.
  const prefix = config.tablePrefix ?? "";
  // Keep single-use verification values on D1 even when KV is caching sessions;
  // see `verificationStorage`. Only set when there IS a secondary storage to
  // divert them from; without `sessionCacheKv` the option is a no-op and
  // emitting it would just be noise in the Better Auth config.
  const verificationOptions = {
    ...(prefix ? { modelName: `${prefix}verification` } : {}),
    ...(config.sessionCacheKv
      ? { storeInDatabase: (config.verificationStorage ?? "database") === "database" }
      : {}),
  };
  const userOptions = {
    ...(prefix ? { modelName: `${prefix}user` } : {}),
    // Louise's standard first/last name fields, ahead of the site's own extras.
    // Without the admin plugin, its columns too, so `role` and bans still work.
    additionalFields: {
      ...LOUISE_USER_FIELDS,
      ...config.additionalFields,
      // Last, so a site field with the same name can't make `role` or a ban
      // something a person sets for themselves.
      ...(adminEndpoints ? {} : ADMIN_USER_FIELDS),
    },
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
    // A second instance on the same origin needs its own mount and its own
    // cookie prefix, or the two sessions collide.
    ...(config.basePath ? { basePath: config.basePath } : {}),
    advanced: {
      ...(config.cookiePrefix ? { cookiePrefix: config.cookiePrefix } : {}),
      ...(config.waitUntil ? { backgroundTasks: { handler: config.waitUntil } } : {}),
      // Better Auth 1.7.7 checks the database schema before its first query,
      // by default, and caches the verdict on the instance. This factory
      // builds an instance per request, so the cache never outlives one: every
      // request that touched auth would list D1's tables and read each one's
      // columns first, and any difference would fail the request. The auth
      // schema is this kit's to keep right: `generateAuthSchemaSql` emits it
      // and the site's migrations apply it.
      database: { validateSchema: false },
      // Better Auth reads the client IP from `X-Forwarded-For` by default, and
      // only when it holds one address. A client can send its own, which
      // Cloudflare appends to, and then no IP resolves and every request
      // shares one bucket per path: a stranger could spend everyone's sign-in
      // budget. Cloudflare sets `CF-Connecting-IP` itself and overwrites any
      // copy a client sends.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    // Single custom domain in prod, localhost in dev.
    trustedOrigins: [baseURL],
    ...(config.sessionCacheKv
      ? { secondaryStorage: kvSecondaryStorage(config.sessionCacheKv) }
      : {}),
    rateLimit: {
      // Better Auth enables its limiter by itself only when `NODE_ENV` is
      // `production`, which a Worker never sets, so without this it's off on
      // every instance: the editor's magic-link and passkey endpoints included.
      // Off on localhost, where a burst is someone testing, not an attack.
      enabled: !isDev,
      // Checked ahead of secondaryStorage by Better Auth, so wiring the Durable
      // Object retires the KV `increment` rather than merely documenting its
      // limits. Always set, so every count is scoped to this instance.
      customStorage: scopedRateLimitStorage(
        `${host}${config.basePath ?? "/api/auth"}`,
        config.rateLimitDo
          ? durableRateLimitStorage(config.rateLimitDo)
          : fallbackRateLimitStorage(config.sessionCacheKv),
      ),
    },
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
    ...(Object.keys(verificationOptions).length ? { verification: verificationOptions } : {}),
    ...(config.customers && !customerLinks
      ? {
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: config.customers.requireEmailVerification ?? false,
            minPasswordLength: config.customers.minPasswordLength ?? 8,
            ...(config.customers.disableSignUp ? { disableSignUp: true } : {}),
            // Default ON: a reset usually means the old credentials leaked, so
            // leaving other sessions alive defeats the point of resetting.
            revokeSessionsOnPasswordReset: config.customers.revokeSessionsOnPasswordReset ?? true,
            // Wrapped, not passed through: Better Auth's signature demands a
            // strict `Promise<void>` and hands over its full user record, while
            // the config surface here asks only for `{ email }` and tolerates a
            // sync callback.
            ...(config.customers.sendResetPassword
              ? {
                  sendResetPassword: async (data: { user: { email: string }; url: string }) => {
                    await config.customers?.sendResetPassword?.({
                      user: { email: data.user.email },
                      url: data.url,
                    });
                  },
                }
              : {}),
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
      // The admin plugin refuses a banned user a new session. Without the
      // plugin, this does the same, so a ban outlives turning the endpoints off.
      // It doesn't end a session the user already has: the plugin's `ban-user`
      // endpoint revoked those, and it isn't mounted here.
      ...(adminEndpoints
        ? {}
        : {
            session: {
              create: {
                before: async (session, ctx) => {
                  if (!ctx) return;
                  const user = (await ctx.context.internalAdapter.findUserById(session.userId)) as {
                    banned?: boolean | null;
                    banExpires?: Date | string | null;
                  } | null;
                  if (!user?.banned) return;
                  // An expired ban is cleared and no longer applies, as with
                  // the plugin.
                  if (user.banExpires && new Date(user.banExpires).getTime() < Date.now()) {
                    await ctx.context.internalAdapter.updateUser(session.userId, {
                      banned: false,
                      banReason: null,
                      banExpires: null,
                    });
                    return;
                  }
                  throw new APIError("FORBIDDEN", {
                    message: "You can't sign in to this account.",
                    code: "BANNED_USER",
                  });
                },
              },
            },
          }),
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        // Without this, following a link to an address with no account creates
        // one, whatever `emailAndPassword.disableSignUp` says.
        ...(customerSignUpClosed ? { disableSignUp: true } : {}),
        sendMagicLink: async ({ email, url: link }, ctx) => {
          // Unless customers sign in by link, magic links are editor sign-in,
          // so only the allowlist gets one. `handleAuthRequest` refuses
          // everyone else before Better Auth runs, but only on the route that
          // calls it: an instance served straight from `auth.handler` (a
          // customer portal on its own `basePath`) would otherwise mail a
          // working sign-in link—one that creates the account—to any address
          // anyone typed. The token Better Auth has already stored is never
          // delivered, so it's inert.
          if (!customerLinks && !isAdmin(email)) return;
          // Customer links with sign-up closed: an address with no account
          // would only reach an error page, so it gets no email, and the
          // response stays the same either way.
          if (customerSignUpClosed && !isAdmin(email)) {
            const found = await ctx?.context.internalAdapter.findUserByEmail(email);
            if (!found?.user) return;
          }
          // Local dev has no EMAIL binding—log the link instead.
          if (isDev) {
            console.log(`[dev] Magic link for ${email}: ${link}`);
            return;
          }
          // An open endpoint with no captcha mails whoever asks. Say so on
          // every send, so a site that meant to turn Turnstile on finds out.
          if (customerLinks && !captchaKey && !isAdmin(email)) {
            reportDegraded("auth.magic-link-no-captcha", undefined, { host });
          }
          const mail = config.renderMagicLinkEmail({ url: link, toEmail: email });
          const send = sendEmail(
            env.EMAIL,
            {
              from: config.mailFrom,
              to: email,
              subject: mail.subject,
              html: mail.html,
              text: mail.text,
            },
            // The request's own hostname, not a build-time flag: with no EMAIL
            // binding on localhost the magic link is printed to the console, which
            // is the only way to sign in locally. A better signal than the
            // bundler's `import.meta.env` too—it reflects THIS request.
            { dev: isDev },
          );
          // Off the response path when the site passed `waitUntil`, so the
          // endpoint answers as fast whether or not it mailed; awaited
          // otherwise. Better Auth's own plugin awaits this callback directly.
          await (ctx ? ctx.context.runInBackgroundOrAwait(send) : send);
        },
      }),
      // User administration at `<basePath>/admin/*`, guarded only by the
      // session user's role. An editor-only instance needs it; any instance
      // with `customers` set, one shared with editors included, gets it only by
      // asking (see `customers.adminEndpoints`).
      ...(adminEndpoints ? [admin()] : []),
      // rpID is domain-bound: a localhost-enrolled passkey won't work on prod.
      // Defaults to this origin's hostname; an explicit value (typically the
      // apex) lets one passkey cover an admin subdomain too—see the option.
      passkey({
        rpID: config.rpID ?? host,
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
      // is set—the same way user/session/passkey are prefixed above—so the
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
              // Invite email: mirror `sendMagicLink`—dev logs the accept link,
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
                    await sendEmail(
                      env.EMAIL,
                      {
                        from: config.mailFrom,
                        to: data.email,
                        subject: mail.subject,
                        html: mail.html,
                        text: mail.text,
                      },
                      { dev: isDev },
                    );
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
