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
//     rateLimit: { rules: RATE_RULES, kv: env.KV },
//     cspStyleSrc: "'self' 'unsafe-inline' https://fonts.googleapis.com",
//   });
//
// This subpath is the ONE place Louise touches Astro's types — `astro` is an
// optional peer, pulled in only by sites that import `louise-toolkit/astro`.

import type { APIContext, MiddlewareHandler } from "astro";
import {
  louiseSecurityHeaders,
  matchRateRule,
  type RateLimitBackend,
  type RateRule,
  rateLimit,
  rewriteCspStyleSrc,
} from "../core/security/index.js";

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
  /** Rate-limit backend — a KV counter or Cloudflare's native Rate Limiting
   *  binding. */
  kv: RateLimitBackend;
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
  /** Edit-mode cookie name. Default `"louise_edit"`. */
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
  const editCookie = config.editCookie ?? "louise_edit";

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
        const ip = context.request.headers.get("cf-connecting-ip") ?? "unknown";
        const { ok, retryAfter } = await rateLimit(
          config.rateLimit.kv,
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
          context.cookies.set(editCookie, "1", { path: "/", sameSite: "lax" });
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

    const response = await next();

    // content freshness: cached HTML would hide editor edits. Edit-mode pages are
    // per-editor and must be live (`no-store`); public HTML `no-cache` so edits
    // appear without a manual purge. Only HTML — hashed `/_astro/*` assets keep
    // their immutable caching (set via `_headers`).
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      response.headers.set("Cache-Control", locals.editMode ? "no-store" : "no-cache");
    }

    if (config.cspStyleSrc) rewriteCspStyleSrc(response, config.cspStyleSrc);
    if (config.securityHeaders !== false) {
      louiseSecurityHeaders(response, { hostname: context.url.hostname });
    }

    return response;
  };
}
