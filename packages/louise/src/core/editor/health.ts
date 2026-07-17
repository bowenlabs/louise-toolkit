// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — the site-health route (#106). Exposes the persisted
// HealthSummary (louise-toolkit/health) over HTTP so the owner's Health panel can
// read the full snapshot — including the broken-link details the dashboard card's
// count doesn't carry:
//   GET /api/louise/health   (editor-only) → { summary: HealthSummary | null }
//
// Config-driven like overviewRoute: the site supplies `read` (typically
// `(env) => readHealthSummary(env.RL)`), so the toolkit makes no assumption about
// where the summary is stored. `null` (no scan yet) is a 200, not a 404 — the
// panel renders a "not checked yet" state rather than treating it as an error.

import type { HealthSummary } from "../health/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, matchPath, type ResolveEditor } from "./shared.js";

export interface HealthRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** Resolve the editor session (the health panel is editor-only). */
  resolveEditor: ResolveEditor<Env>;
  /** Read the persisted summary — `null` when no scan has run yet. */
  read: (env: Env) => Promise<HealthSummary | null> | HealthSummary | null;
  /** Mount path. Default `/api/louise/health`. */
  path?: string;
}

/**
 * Build the health route. Returns `undefined` for a non-matching path so
 * `composeWorker` falls through. Only GET is served; the body is
 * `{ summary }` with `summary: null` until the first scan persists one.
 */
export function healthRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: HealthRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/health";

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const g = await guardEditor(request, env, config.resolveEditor, false);
    if ("response" in g) return g.response;

    const summary = (await config.read(env)) ?? null;
    return json({ summary });
  };
}
