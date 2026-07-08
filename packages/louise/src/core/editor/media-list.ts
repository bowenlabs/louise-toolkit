// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/editor — the registry-less `media` route. The default `mediaRoute`
// (see ./media) tracks uploads in a `media` D1 table. This variant lists the R2
// bucket directly via `listMedia` — for sites with no media registry table —
// and accepts a per-request upload `scope` (allowlisted) instead of a fixed one:
//   GET    /api/louise/media          list the bucket newest-first (listMedia)
//   POST   /api/louise/media          upload a verified image (scope from form)
//   DELETE /api/louise/media?key=…     delete after a delete-safety reference scan
// Delete-safety still uses D1 (`findMediaReferences` scans content tables), so
// the env is the same `MediaRouteEnv` (DB + MEDIA + MEDIA_URL).

import {
  deleteMedia,
  findMediaReferences,
  listMedia,
  type MediaRefSource,
  mediaUrl,
  putMedia,
} from "../media/index.js";
import type { WorkerRoute } from "../worker/index.js";
import type { MediaRouteEnv } from "./media.js";
import { guardEditor, json, matchPath, type ResolveEditor } from "./shared.js";

export interface ListMediaRouteConfig<Env extends MediaRouteEnv = MediaRouteEnv> {
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Delete-safety sources: which `(table, columns)` to scan for a key before
   *  deleting it. Omit to skip the scan. */
  referenceSources?: MediaRefSource[];
  /** Allowed upload scopes (R2 key prefixes); the first is the default when the
   *  form omits `scope` or sends one not in the list. Default `["web"]`. */
  scopes?: string[];
  /** Max accepted upload size in bytes (passed to `putMedia`). */
  maxBytes?: number;
  /** Mount path. Default `/api/louise/media`. */
  path?: string;
}

/**
 * Build a registry-less `media` editor route. GET lists the R2 bucket
 * newest-first (each item carries its public `url`), POST uploads a verified
 * image under an allowlisted `scope`, DELETE removes an object after the
 * reference scan (`409 in_use` with `{ references }` unless `?force=1`). No D1
 * `media` table is read or written. Returns `undefined` for a non-matching path.
 */
export function listMediaRoute<Env extends MediaRouteEnv = MediaRouteEnv>(
  config: ListMediaRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/media";
  const scopes = config.scopes ?? ["web"];
  const defaultScope = scopes[0] ?? "web";
  const sources = config.referenceSources ?? [];

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;
    const method = request.method;

    if (method === "GET") {
      const g = await guardEditor(request, env, config.resolveEditor, false);
      if ("response" in g) return g.response;
      const media = await listMedia(env.MEDIA, env.MEDIA_URL);
      return json({ media });
    }

    if (method === "POST") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return json({ error: "No file" }, 400);
      const requested = String(form?.get("scope") ?? "");
      const scope = scopes.includes(requested) ? requested : defaultScope;
      const put = await putMedia(env.MEDIA, file, { scope, maxBytes: config.maxBytes });
      if (!put.ok) return json({ error: put.error }, put.status);
      return json({ ok: true, key: put.key, url: mediaUrl(env.MEDIA_URL, put.key) }, 201);
    }

    if (method === "DELETE") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const url = new URL(request.url);
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "No key" }, 400);
      if (url.searchParams.get("force") !== "1" && sources.length > 0) {
        const refs = await findMediaReferences(env.DB, key, sources);
        if (refs.length > 0) return json({ error: "in_use", references: refs }, 409);
      }
      await deleteMedia(env.MEDIA, key);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
