// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the site's incidents, for its editors (ADR 0022 § 4,
// as amended). The Health panel and the needs-attention list read it:
//   GET  /api/louise/incidents?status=open|resolved|all   → { incidents }
//   GET  /api/louise/incidents/<fingerprint>              → { incident }
//   POST /api/louise/incidents/<fingerprint>/resolve      → { incident }
//
// Editors only. Watchtower reads the table through Cloudflare's D1 API with
// its own read-only token, so no bearer token reaches this route.

import {
  getIncident,
  type IncidentStatus,
  type IncidentTable,
  incidents,
  listIncidents,
  resolveIncident,
} from "../incidents/store.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

export interface IncidentsRouteConfig<Env extends EditorRouteEnv> {
  /** Resolve the editor session. */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path. Default `/api/louise/incidents`. */
  path?: string;
  /** Most rows a list returns. Default 100. */
  limit?: number;
  /** The table, when you've extended `incidentsColumns`. */
  table?: IncidentTable;
}

const NO_STORE = { "cache-control": "no-store" };
const FINGERPRINT = /^[0-9a-f]{16}$/;
const STATUSES: readonly IncidentStatus[] = ["open", "resolved", "all"];

/**
 * The route over the site's `incidents` table: list them, read one, and
 * resolve one. Reads need an editor session; resolving is a write, so it also
 * passes the same-origin check.
 */
export function incidentsRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: IncidentsRouteConfig<Env>,
): WorkerRoute<Env> {
  const base = (config.path ?? "/api/louise/incidents").replace(/\/$/, "");
  const limit = config.limit ?? 100;
  const table = config.table ?? incidents;

  return async (request, env) => {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
    const rest = pathname
      .slice(base.length + 1)
      .split("/")
      .filter(Boolean);

    if (rest.length === 0) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const g = await guardEditor(request, env, config.resolveEditor, false);
      if ("response" in g) return g.response;
      const status = searchParams.get("status") ?? "open";
      if (!STATUSES.includes(status as IncidentStatus)) {
        return json({ error: "Status must be open, resolved, or all" }, 400);
      }
      const rows = await listIncidents(env.DB, { status: status as IncidentStatus, limit }, table);
      return json({ incidents: rows }, 200, NO_STORE);
    }

    const [fingerprint, action, ...extra] = rest;
    if (!fingerprint || !FINGERPRINT.test(fingerprint) || extra.length > 0) {
      return json({ error: "Not found" }, 404);
    }

    if (action === undefined) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const g = await guardEditor(request, env, config.resolveEditor, false);
      if ("response" in g) return g.response;
      const incident = await getIncident(env.DB, fingerprint, table);
      if (!incident) return json({ error: "Not found" }, 404);
      return json({ incident }, 200, NO_STORE);
    }

    if (action === "resolve") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const incident = await resolveIncident(env.DB, fingerprint, new Date(), table);
      if (!incident) return json({ error: "No open incident with that fingerprint" }, 404);
      return json({ incident }, 200, NO_STORE);
    }

    return json({ error: "Not found" }, 404);
  };
}
