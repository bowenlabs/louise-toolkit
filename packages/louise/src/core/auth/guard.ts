// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { EditorSession } from "./types.js";

/**
 * Same-origin (CSRF) check for cookie-authenticated mutations. Requires a
 * same-origin `Origin` header, falling back to `Referer`, and *rejects when
 * neither is present*—so a non-browser client (or a stripped header) can't
 * proceed on the session cookie alone. Browsers always send `Origin` on
 * cross-origin writes, so legitimate same-origin editor requests are unaffected.
 */
export function isSameOrigin(request: Request): boolean {
  const host = new URL(request.url).host;
  const check = (raw: string | null): boolean | null => {
    if (!raw) return null;
    try {
      return new URL(raw).host === host;
    } catch {
      return false; // present but unparseable → treat as mismatch
    }
  };
  const byOrigin = check(request.headers.get("origin"));
  if (byOrigin !== null) return byOrigin;
  const byReferer = check(request.headers.get("referer"));
  if (byReferer !== null) return byReferer;
  return false; // neither Origin nor Referer → reject
}

/** A request plus its middleware-resolved editor session. */
export interface EditorRequest {
  request: Request;
  editor: EditorSession | null;
}

/**
 * Guard for editor-gated endpoints: a same-origin check on mutations
 * (cookie-authenticated writes) plus a resolved editor session. Returns an
 * error `Response`, or null when the request may proceed.
 */
export function requireEditor(ctx: EditorRequest, mutation = true): Response | null {
  if (mutation && !isSameOrigin(ctx.request)) {
    return Response.json({ error: "Bad origin" }, { status: 403 });
  }
  if (!ctx.editor) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** The framework-`context`-shaped slice the editor guard needs: the request
 *  plus the middleware-resolved editor on `locals`. Structural on purpose, so a
 *  site passes its own request context straight through—no framework type
 *  dependency here. */
export interface EditorContext {
  request: Request;
  locals: { editor?: EditorSession | null };
}

/** Methods that read. Everything else is treated as a write. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Context adapter over {@link requireEditor}: bridges a framework `context`
 * (`{ request, locals.editor }`) to the package's `{ request, editor }` shape,
 * so an editor-gated framework route is a one-liner—`const
 * denied = requireEditorFromContext(context); if (denied) return denied;`
 * rather than each site re-declaring the same bridge in its own `lib/guard`.
 * A framework's route context fits as-is once its locals declare `editor`.
 *
 * `mutation` defaults to the request's method: a write (anything but
 * GET/HEAD/OPTIONS) gets the same-origin check, a read does not. Pass it
 * explicitly to override—for example, `true` for a GET that has side effects.
 */
export function requireEditorFromContext(
  ctx: EditorContext,
  mutation: boolean = !SAFE_METHODS.has(ctx.request.method.toUpperCase()),
): Response | null {
  return requireEditor({ request: ctx.request, editor: ctx.locals.editor ?? null }, mutation);
}

/**
 * A post-sign-in `?next=` target reduced to a same-origin path, or `fallback`.
 *
 * Handing `next` to `location.assign` or a redirect unchecked is an open
 * redirect (`?next=https://evil.example`) and, in a browser, script execution
 * (`?next=javascript:…`). A regex over the raw string is not enough: browsers
 * strip tab and newline characters and read `\` as `/`, so `/%09/evil.example`
 * and `/\evil.example` both become `//evil.example`: protocol-relative, that is,
 * off-site. This resolves `raw` with the WHATWG URL parser, the same algorithm
 * the browser will apply, against a placeholder origin, and accepts it only if
 * it stayed on that origin. What comes back is the normalized path + query +
 * hash, never the caller's original string.
 *
 * `fallback` is required: where a user lands by default is the site's call.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return fallback;
  const base = "https://next.invalid";
  try {
    const url = new URL(raw, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/** True when `role` is one of `allowed`. Roles are arbitrary, site-defined
 *  strings; Louise bakes none in. */
export function hasRole(role: string | null | undefined, allowed: readonly string[]): boolean {
  return role != null && allowed.includes(role);
}

/** A request plus the current user's resolved role (from a session). */
export interface RoleRequest {
  request: Request;
  role: string | null | undefined;
}

/**
 * Guard for role-gated endpoints: a same-origin (CSRF) check on mutations plus
 * a membership test of the session's `role` against `allowed`. Returns 401 when
 * unauthenticated, 403 on a wrong role or bad origin, or null to proceed.
 * Generic and unopinionated—it works with any site's roles and any auth
 * instance; the content editor gate is the binary {@link requireEditor}.
 */
export function requireRole(
  ctx: RoleRequest,
  allowed: readonly string[],
  mutation = true,
): Response | null {
  if (mutation && !isSameOrigin(ctx.request)) {
    return Response.json({ error: "Bad origin" }, { status: 403 });
  }
  if (ctx.role == null) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!allowed.includes(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Copy only allowlisted keys from a payload. */
export function pick(input: Record<string, unknown>, allow: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (allow.has(k)) out[k] = v;
  return out;
}
