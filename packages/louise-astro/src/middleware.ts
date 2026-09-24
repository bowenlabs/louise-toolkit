// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/astro—the shared Louise Astro middleware, as a factory. Every
// Louise site's `middleware.ts` runs the same flow; only the auth wiring, rate
// rules, and CSP allow-list vary. `createLouiseMiddleware` owns the flow and
// takes those as config, so a site's middleware collapses to:
//
//   export const onRequest = createLouiseMiddleware({
//     resolveEditor: (req) =>
//       resolveEditorSession(getLouiseAuth(env, new URL(req.url).origin), req),
//     rateLimit: { rules: RATE_RULES, kv: () => env.RL },
//     cspStyleSrc: "'self' 'unsafe-inline'",
//   });
//
// (The brand font is bundled + base64-inlined—no Google Fonts host to allow.
// The middleware auto-allows `data:` fonts in the response CSP, so a strict
// `font-src` needs no manual change for the inlined @font-face.)
//
// This subpath is the ONE place Louise touches Astro's types—`astro` is an
// optional peer, pulled in only by sites that import `louise-toolkit/astro`.

import type { APIContext, MiddlewareHandler } from "astro";
import {
  allowCspDataFonts,
  louiseSecurityHeaders,
  matchRateRule,
  type RateLimitBackend,
  type RateRule,
  rateLimit,
  rewriteCspStyleSrc,
} from "louise-toolkit/security";
import type { EditorSession } from "louise-toolkit/auth";
import {
  isLouisePublicPath,
  LOUISE_API_PREFIX,
  LOUISE_EDIT_COOKIE,
  louiseApiGate,
  underPrefix,
} from "louise-toolkit/worker";

/** The locals this middleware writes. A site's `App.Locals` should declare at
 *  least these (plus anything it sets via {@link LouiseMiddlewareConfig.extend},
 *  for example, a `customer`). */
interface LouiseLocals {
  editor: unknown;
  editMode: boolean;
}

export interface LouiseMiddlewareRateLimit {
  /** The site's rate-limit rules—the public POST surfaces worth protecting. */
  rules: RateRule[];
  /**
   * Rate-limit backend—a KV counter or Cloudflare's native Rate Limiting
   * binding, or a getter that yields one. A getter is resolved per request, so a
   * `cloudflare:workers` `env` binding is read in request scope rather than at
   * module-eval—the same reason editor Actions take `getEnv: () => env`. A
   * getter that yields a falsy backend (for example, the KV namespace isn't provisioned
   * yet) simply skips rate-limiting—fail open, consistent with {@link rateLimit}.
   */
  kv: RateLimitBackend | (() => RateLimitBackend | undefined);
}

export interface LouiseMiddlewareApiGate {
  /** Path the gate protects. Default `/api/louise`, on a segment boundary. */
  prefix?: string;
  /**
   * Paths under the prefix an anonymous request may still reach, on top of the
   * toolkit's own public routes at their default mounts (forms and vitals—see
   * `isLouisePublicPath`).
   *
   * A path, not a mark on the route, because middleware runs before it knows
   * which route file will answer: a route can't declare itself public here the
   * way `publicRoute` does for `composeWorker`.
   */
  isPublic?: (pathname: string) => boolean;
}

export interface LouiseMiddlewareConfig<TEditor = unknown> {
  /**
   * Resolve the editor session for a request—the site wraps its own auth,
   * for example, `resolveEditorSession(await getLouiseAuth(env, origin), request)`. A
   * truthy result is written to `locals.editor` and unlocks edit mode; `null`
   * renders the public page. A thrown error (for example, missing bindings under plain
   * `astro preview`) degrades to public rendering.
   */
  resolveEditor: (request: Request) => TEditor | null | Promise<TEditor | null>;
  /** Rate-limit the public POST surfaces before any other work. Omit to skip. */
  rateLimit?: LouiseMiddlewareRateLimit;
  /**
   * `style-src` replacement for the response CSP header—the site's allow-list.
   * Astro's `security.csp` hashes inline island styles, which voids the
   * `'unsafe-inline'` the data-driven `style=""` carriers need; this rewrites
   * ONLY `style-src` (script hashes stay verbatim). No-op without a CSP header
   * (astro dev). Omit to skip.
   */
  cspStyleSrc?: string;
  /** Apply {@link louiseSecurityHeaders} (HSTS, nosniff, referrer, …) to the
   *  response. Default `true`. */
  securityHeaders?: boolean;
  /**
   * Hosts to keep out of search indexes—sent as `X-Robots-Tag: noindex`.
   * For example, `(host) => isNoindexHost(host, { prefixes: ["preview."] })`. Set here
   * rather than in a page, because a streamed page's headers are already gone.
   */
  noindex?: (hostname: string) => boolean;
  /**
   * Extra per-request work after editor resolution, before `next()`—for example,
   * resolve a second session (a shop customer) onto `locals`. Runs inside the
   * same try/catch, so a throw degrades to public rendering.
   */
  extend?: (context: APIContext) => void | Promise<void>;
  /**
   * Authorize the request after {@link extend} has populated `locals`, and
   * before the page runs. Return a `Response` to short-circuit (a redirect, a
   * 401/403), or `undefined` to continue.
   *
   * Deliberately separate from `extend`: sessions must be resolved before
   * anything can be authorized against them, and collapsing the two would make
   * that ordering a convention rather than a guarantee. It runs OUTSIDE the
   * `extend` try/catch, because a guard that throws must fail closed—a
   * swallowed error there would serve the protected page.
   */
  guard?: (context: APIContext) => Response | undefined | Promise<Response | undefined>;
  /**
   * Rewrite the request internally before the page runs—return the path to
   * render, or `undefined` to render the requested one. Runs **after**
   * {@link guard}, so policy is still expressed against the URL the visitor
   * actually asked for rather than an internal one.
   *
   * This exists because neither existing hook can rewrite: `extend` returns
   * `void` and `guard` returns only a `Response`. Astro permits exactly one
   * middleware file, and in a generated one there is nowhere else to put it.
   *
   * The motivating case is host dispatch—serving `*.example.com` from one
   * Worker by mapping a subdomain onto an internal path prefix. The middleware
   * stays policy-free: what a host means, and whether an unknown one is a 404,
   * belong to the site.
   *
   * ```ts
   * rewrite: (context) => {
   *   const tenant = context.locals.tenant;
   *   return tenant ? `/t/${tenant.slug}${context.url.pathname}` : undefined;
   * },
   * ```
   *
   * The visitor's URL is unchanged—this is an internal rewrite, not a
   * redirect, so `context.url` still reads as the public address and links
   * rendered from it stay correct.
   */
  rewrite?: (context: APIContext) => string | undefined | Promise<string | undefined>;
  /**
   * Deny-by-default gate for the editor API (ADR 0012), for routes mounted as
   * framework API routes (`runEditorRoute`) rather than `composeWorker` routes.
   * `true`—or an object to change the prefix or add public paths—and every
   * request under `/api/louise` must resolve to an editor, with writes and
   * WebSocket upgrades origin-checked, before any route runs. Gated responses
   * get `Cache-Control: no-store` unless the route set its own. Omit to skip.
   *
   * Behind `composeWorker({ gate })` this is a second check on requests the
   * worker already let through, and costs nothing extra: the editor is
   * resolved on every request regardless.
   */
  apiGate?: boolean | LouiseMiddlewareApiGate;
  /** Edit-mode cookie name. Default {@link LOUISE_EDIT_COOKIE} (`"louise_edit"`).
   *  Change it and the `withEdgeCache` bypass predicate must be told too, or an
   *  editor gets served the cached public page. */
  editCookie?: string;
}

/**
 * Build the shared Louise Astro middleware: rate-limit → resolve the editor
 * session + sticky `?louise` edit mode → `next()` → content-freshness cache headers
 * + CSP `style-src` rewrite + transport security headers. Sites supply the bits
 * that vary via {@link LouiseMiddlewareConfig} and export the result as
 * `onRequest`.
 */
export function createLouiseMiddleware<TEditor = unknown>(
  config: LouiseMiddlewareConfig<TEditor>,
): MiddlewareHandler {
  // The default comes from the same constant `isEditRequest` reads, so the
  // cookie this sets and the predicate that looks for it cannot drift apart.
  const editCookie = config.editCookie ?? LOUISE_EDIT_COOKIE;
  const apiGate = config.apiGate === true ? {} : config.apiGate || undefined;
  const apiPrefix = apiGate?.prefix ?? LOUISE_API_PREFIX;

  return async (context, next) => {
    // Rate-limit the public, unauthenticated POST surfaces before any other
    // work. Keyed by client IP via a KV counter; `rateLimit` fails open on a KV
    // error so a limiter outage never takes down sign-in or the contact form.
    if (config.rateLimit) {
      const rule = matchRateRule(
        config.rateLimit.rules,
        context.request.method,
        context.url.pathname,
      );
      if (rule) {
        // Resolve the backend only for a matched surface, and per request: a
        // getter defers the `env` binding read to request scope (never
        // module-eval). A falsy backend (binding not yet provisioned) skips
        // limiting—fail open, like `rateLimit` itself.
        const backend =
          typeof config.rateLimit.kv === "function" ? config.rateLimit.kv() : config.rateLimit.kv;
        if (backend) {
          const ip = context.request.headers.get("cf-connecting-ip") ?? "unknown";
          const { ok, retryAfter } = await rateLimit(
            backend,
            `${rule.name}:${ip}`,
            rule.limit,
            rule.windowSec,
          );
          if (!ok) {
            return new Response(
              JSON.stringify({ error: "Too many requests. Please try again shortly." }),
              {
                status: 429,
                headers: { "content-type": "application/json", "retry-after": String(retryAfter) },
              },
            );
          }
        }
      }
    }

    const locals = context.locals as LouiseLocals;
    locals.editor = null;
    locals.editMode = false;

    try {
      const editor = await config.resolveEditor(context.request);
      if (editor) {
        locals.editor = editor;
        // Edit mode is sticky: ?louise enters (sets a cookie), ?louise=off
        // exits. The cookie alone never grants anything—the session above is
        // always re-checked, so a stale cookie without a session renders public.
        const param = context.url.searchParams.get("louise");
        if (context.url.searchParams.has("louise") && param !== "off") {
          // `secure` only over https, so plain-http localhost dev still round-trips
          // the toggle. The cookie grants nothing on its own—the session above is
          // re-verified every request—so this is hygiene, not a control.
          context.cookies.set(editCookie, "1", {
            path: "/",
            sameSite: "lax",
            secure: context.url.protocol === "https:",
          });
          locals.editMode = true;
        } else if (param === "off") {
          context.cookies.delete(editCookie, { path: "/" });
        } else {
          locals.editMode = context.cookies.get(editCookie)?.value === "1";
        }
      }
    } catch {
      // Missing bindings (for example, plain `astro preview`, an unprovisioned
      // SESSION_SECRET) → public rendering. Auth degrading is fine; what it
      // must NOT do is cancel anything else.
    }

    // The API gate, before extend: it needs only the editor, and a refused
    // request shouldn't pay for the site's extra work. A `resolveEditor` that
    // threw left `locals.editor` null above, so where pages degrade to public
    // the API fails closed—refused, not served anonymously.
    const pathname = context.url.pathname;
    const gatedApi =
      apiGate !== undefined &&
      underPrefix(pathname, apiPrefix) &&
      !isLouisePublicPath(pathname) &&
      !apiGate.isPublic?.(pathname);
    if (gatedApi) {
      const denied = await louiseApiGate(context.request, undefined, {
        resolveEditor: () => locals.editor as EditorSession | null,
        prefix: apiPrefix,
      });
      if (denied) return finish(context, denied);
    }

    // extend gets its OWN catch, deliberately separate from auth's. When these
    // shared one, `resolveEditor` throwing (a sentinel SESSION_SECRET—the
    // dormant-until-provisioned state every module is supposed to survive)
    // silently skipped extend too, and everything extend feeds died with it:
    // `locals.tenant` never set, so host dispatch quietly served the ordinary
    // site on every tenant subdomain. An unprovisioned editor secret must
    // degrade to "signed out", never to "storefronts don't resolve".
    try {
      await config.extend?.(context);
    } catch {
      // extend's own failure still degrades to public rendering.
    }

    // Outside the catch above, on purpose: a guard exists to REFUSE, so an
    // error inside it must not be swallowed into "carry on and render the
    // protected page". Locals are already populated by `extend` at this point.
    const denied = await config.guard?.(context);
    if (denied) return denied;

    // After the guard, deliberately: a rewrite changes which page renders, not
    // who may see it, so authorizing against the rewritten path would mean
    // policy written in internal URLs the site never publishes.
    //
    // Outside the try/catch too, for the same reason the guard is: a rewrite
    // that throws must not degrade into rendering the UNREWRITTEN path, which
    // for host dispatch is another tenant's page.
    const rewrite = await config.rewrite?.(context);

    const response = rewrite === undefined ? await next() : await next(rewrite);

    // An editor's JSON must not land in a shared cache. A route that chose its
    // own policy keeps it.
    if (gatedApi && !response.headers.has("cache-control")) {
      response.headers.set("Cache-Control", "no-store");
    }
    return finish(context, response);
  };

  /** The response-side work every answer gets, a gate refusal included. */
  function finish(context: APIContext, response: Response): Response {
    const locals = context.locals as LouiseLocals;
    // content freshness: cached HTML would hide editor edits. Edit-mode pages are
    // per-editor and must be live (`no-store`); public HTML `no-cache` so edits
    // appear without a manual purge. Only HTML—hashed `/_astro/*` assets keep
    // their immutable caching (set via `_headers`).
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      response.headers.set("Cache-Control", locals.editMode ? "no-store" : "no-cache");
    }

    if (config.cspStyleSrc) rewriteCspStyleSrc(response, config.cspStyleSrc);
    // Louise's bundled brand font is an inlined `data:` @font-face (loaded on
    // every edit surface), so guarantee the CSP permits data: fonts—no-op
    // without a CSP header or when already allowed. Saves consumers a font-src edit.
    allowCspDataFonts(response);
    const noindex = config.noindex?.(context.url.hostname) ?? false;
    if (config.securityHeaders !== false) {
      louiseSecurityHeaders(response, { hostname: context.url.hostname, noindex });
    } else if (noindex) {
      response.headers.set("X-Robots-Tag", "noindex");
    }

    return response;
  }
}
