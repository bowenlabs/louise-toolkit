// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/worker — the API gate (ADR 0012).
//
// Every editor route guards itself, and so far every one has remembered to.
// The gate makes that true by construction: under the protected prefix a
// request must resolve to an editor unless the route it's headed for declared
// itself public. A route that forgets its guard is denied, not open.
//
// It sits in front of the per-route guards, not instead of them. The routes
// still need the `EditorSession` itself, and `runEditorRoute` runs a factory
// with no `composeWorker` — and so no gate — at all. The gate answers "may this
// request enter the API"; the route answers "may this editor do this".

import { requireEditor } from "../auth/guard.js";
import type { EditorSession } from "../auth/types.js";
import { louiseSecurityHeaders } from "../security/headers.js";
import type { WorkerRoute } from "./index.js";

/**
 * Resolve the editor (admin) session for a request. The site wraps its own
 * auth — typically `resolveEditorSession(getLouiseAuth(env, url), request)`.
 * Returning `null` means "not an editor".
 */
export type ResolveEditor<Env> = (
  request: Request,
  env: Env,
) => EditorSession | null | Promise<EditorSession | null>;

export interface ApiGateConfig<Env> {
  /** The same resolver the editor routes are given. Passing the same function
   *  means the session is looked up once per request, not once per layer. */
  resolveEditor: ResolveEditor<Env>;
  /**
   * Path the gate protects. Default `/api/louise`. Matched on a segment
   * boundary: `/api/louise` and `/api/louise/…`, never `/api/louise-foo`.
   */
  prefix?: string;
}

/** Where the editor API lives unless a site says otherwise. */
export const LOUISE_API_PREFIX = "/api/louise";

/** Whether `pathname` falls under `prefix`, on a segment boundary. */
export function underPrefix(pathname: string, prefix: string): boolean {
  const base = prefix.replace(/\/+$/, "");
  return pathname === base || pathname.startsWith(`${base}/`);
}

// ─── One session lookup per request ─────────────────────────────────────────

// Keyed by the Request object (so it lives exactly as long as the request) and
// then by resolver identity (so two different resolvers never share a result).
const resolved = new WeakMap<Request, Map<unknown, Promise<EditorSession | null>>>();

/**
 * `resolveEditor(request, env)`, memoized per request and resolver. The gate
 * and the route's own guard both ask; only the first asks the session store.
 */
export function resolveEditorOnce<Env>(
  request: Request,
  env: Env,
  resolveEditor: ResolveEditor<Env>,
): Promise<EditorSession | null> {
  let byResolver = resolved.get(request);
  if (!byResolver) {
    byResolver = new Map();
    resolved.set(request, byResolver);
  }
  let editor = byResolver.get(resolveEditor);
  if (!editor) {
    editor = Promise.resolve().then(() => resolveEditor(request, env));
    byResolver.set(resolveEditor, editor);
  }
  return editor;
}

// ─── Public routes ──────────────────────────────────────────────────────────

// `Symbol.for`, so two copies of the package in one bundle still agree.
const PUBLIC = Symbol.for("louise-toolkit.publicRoute");

/**
 * Mark a route as reachable without an editor session under the gated prefix
 * — a contact form, a vitals beacon. The route that is public says so here,
 * rather than a path list in the site's config that drifts from the code.
 * A public route still does its own checks (origin, validation, rate limit).
 */
export function publicRoute<Env>(route: WorkerRoute<Env>): WorkerRoute<Env> {
  const marked: WorkerRoute<Env> = (request, env, ctx) => route(request, env, ctx);
  Object.defineProperty(marked, PUBLIC, { value: true });
  return marked;
}

/** Whether `route` was wrapped in {@link publicRoute}. */
export function isPublicRoute(route: WorkerRoute<never>): boolean {
  return (route as unknown as Record<symbol, unknown>)[PUBLIC] === true;
}

// ─── The gate ───────────────────────────────────────────────────────────────

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Decide whether `request` may enter the editor API. Returns `null` to let it
 * through — including every request outside the prefix, which isn't the gate's
 * business — or the 401/403 `Response` to send instead.
 *
 * Credentials are the session cookie, so every unsafe method is origin-checked
 * (CSRF). So is a WebSocket upgrade: it's a GET, and a cross-site page can open
 * a socket that carries the editor's cookie, so method alone would let it by.
 * Bearer tokens (ADR 0009) will skip the origin check — a browser can't attach
 * one cross-site — decided by which credential authenticated, never by a
 * missing `Origin`.
 */
export async function louiseApiGate<Env>(
  request: Request,
  env: Env,
  config: ApiGateConfig<Env>,
): Promise<Response | null> {
  const prefix = config.prefix ?? LOUISE_API_PREFIX;
  if (!underPrefix(new URL(request.url).pathname, prefix)) return null;
  const editor = await resolveEditorOnce(request, env, config.resolveEditor);
  const upgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  return requireEditor({ request, editor }, upgrade || !SAFE_METHODS.has(request.method));
}

// ─── Response headers ───────────────────────────────────────────────────────

/**
 * Give a route's response the baseline security headers the site's middleware
 * would have — `composeWorker` routes run before it and never pass through.
 * Only headers the route didn't set itself (the image proxy sets its own CSP),
 * plus `Cache-Control: no-store` on a gated response unless the route chose a
 * policy, so an editor's JSON can't land in a shared cache.
 *
 * A `101` goes back untouched: a WebSocket response can't be rewrapped. A
 * response with immutable headers (straight from `fetch`, `Response.redirect`)
 * is rewrapped once rather than thrown on.
 */
export function withRouteHeaders(response: Response, hostname: string, gated: boolean): Response {
  if (response.status === 101) return response;
  const baseline = [...louiseSecurityHeaders(new Response(null), { hostname }).headers];
  if (gated) baseline.push(["cache-control", "no-store"]);
  const missing = baseline.filter(([name]) => !response.headers.has(name));
  if (missing.length === 0) return response;
  let out = response;
  try {
    for (const [name, value] of missing) out.headers.set(name, value);
  } catch {
    out = new Response(response.body, response);
    for (const [name, value] of missing) out.headers.set(name, value);
  }
  return out;
}
