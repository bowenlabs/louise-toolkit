// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

import type { EditorSession } from "./types.js";

/**
 * Same-origin (CSRF) check for cookie-authenticated mutations. Requires a
 * same-origin `Origin` header, falling back to `Referer`, and *rejects when
 * neither is present* — so a non-browser client (or a stripped header) can't
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
 *  site passes its Astro `APIContext` straight through — no `astro` type
 *  dependency here. */
export interface EditorContext {
  request: Request;
  locals: { editor?: EditorSession | null };
}

/**
 * Context adapter over {@link requireEditor}: bridges a framework `context`
 * (`{ request, locals.editor }`) to the package's `{ request, editor }` shape,
 * so an editor-gated Astro `APIRoute` is a one-liner —
 * `const denied = requireEditorFromContext(context); if (denied) return denied;`
 * — instead of each site re-declaring the same bridge in its own `lib/guard`.
 */
export function requireEditorFromContext(ctx: EditorContext, mutation = true): Response | null {
  return requireEditor({ request: ctx.request, editor: ctx.locals.editor ?? null }, mutation);
}

/** Copy only allowlisted keys from a payload. */
export function pick(input: Record<string, unknown>, allow: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (allow.has(k)) out[k] = v;
  return out;
}
