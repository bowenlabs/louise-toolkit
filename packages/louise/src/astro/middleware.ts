// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/astro — the shared Louise Astro middleware, as a factory. Every
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
// (The brand font is bundled + base64-inlined — no Google Fonts host to allow.
// The middleware auto-allows `data:` fonts in the response CSP, so a strict
// `font-src` needs no manual change for the inlined @font-face.)
//
// This subpath is the ONE place Louise touches Astro's types — `astro` is an
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
} from "../core/security/index.js";
import { LOUISE_EDIT_COOKIE } from "../core/worker/edge-cache.js";

/** The locals this middleware writes. A site's `App.Locals` should declare at
 *  least these (plus anything it sets via {@link LouiseMiddlewareConfig.extend},
 *  e.g. a `customer`). */
interface LouiseLocals {
  editor: unknown;
  editMode: boolean;
}

export interface LouiseMiddlewareRateLimit {
  /** The site's rate-limit rules — the public POST surfaces worth protecting. */
  rules: RateRule[];
  /**
   * Rate-limit backend — a KV counter or Cloudflare's native Rate Limiting
   * binding, or a getter that yields one. A getter is resolved per request, so a
   * `cloudflare:workers` `env` binding is read in request scope rather than at
   * module-eval — the same reason editor Actions take `getEnv: () => env`. A
   * getter that yields a falsy backend (e.g. the KV namespace isn't provisioned
   * yet) simply skips rate-limiting — fail open, consistent with {@link rateLimit}.
   */
  kv: RateLimitBackend | (() => RateLimitBackend | undefined);
}

export interface LouiseMiddlewareConfig<TEditor = unknown> {
  /**
   * Resolve the editor session for a request — the site wraps its own auth,
   * e.g. `resolveEditorSession(await getLouiseAuth(env, origin), request)`. A
   * truthy result is written to `locals.editor` and unlocks edit mode; `null`
   * renders the public page. A thrown error (e.g. missing bindings under plain
   * `astro preview`) degrades to public rendering.
   */
  resolveEditor: (request: Request) => TEditor | null | Promise<TEditor | null>;
  /** Rate-limit the public POST surfaces before any other work. Omit to skip. */
  rateLimit?: LouiseMiddlewareRateLimit;
  /**
   * `style-src` replacement for the response CSP header — the site's allow-list.
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
   * Extra per-request work after editor resolution, before `next()` — e.g.
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
   * `extend` try/catch, because a guard that throws must fail closed — a
   * swallowed error there would serve the protected page.
   */
  guard?: (context: APIContext) => Response | undefined | Promise<Response | undefined>;
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
        // limiting — fail open, like `rateLimit` itself.
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
        // exits. The cookie alone never grants anything — the session above is
        // always re-checked, so a stale cookie without a session renders public.
        const param = context.url.searchParams.get("louise");
        if (context.url.searchParams.has("louise") && param !== "off") {
          // `secure` only over https, so plain-http localhost dev still round-trips
          // the toggle. The cookie grants nothing on its own — the session above is
          // re-verified every request — so this is hygiene, not a control.
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
      await config.extend?.(context);
    } catch {
      // Missing bindings (e.g. plain `astro preview`) → public rendering.
    }

    // Outside the catch above, on purpose: a guard exists to REFUSE, so an
    // error inside it must not be swallowed into "carry on and render the
    // protected page". Locals are already populated by `extend` at this point.
    const denied = await config.guard?.(context);
    if (denied) return denied;

    const response = await next();

    // content freshness: cached HTML would hide editor edits. Edit-mode pages are
    // per-editor and must be live (`no-store`); public HTML `no-cache` so edits
    // appear without a manual purge. Only HTML — hashed `/_astro/*` assets keep
    // their immutable caching (set via `_headers`).
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      response.headers.set("Cache-Control", locals.editMode ? "no-store" : "no-cache");
    }

    if (config.cspStyleSrc) rewriteCspStyleSrc(response, config.cspStyleSrc);
    // Louise's bundled brand font is an inlined `data:` @font-face (loaded on
    // every edit surface), so guarantee the CSP permits data: fonts — no-op
    // without a CSP header or when already allowed. Saves consumers a font-src edit.
    allowCspDataFonts(response);
    if (config.securityHeaders !== false) {
      louiseSecurityHeaders(response, { hostname: context.url.hostname });
    }

    return response;
  };
}
