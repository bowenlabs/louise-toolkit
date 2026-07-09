// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/editor — full-text search for a collection with a `search` config.
// Exposes the Local API's FTS5-backed `search()` (and a one-shot `reindex`) over
// HTTP:
//   GET  /api/louise/pages/search?q=…&limit=…   ranked matches (published rows)
//   POST /api/louise/pages/reindex               rebuild the index from the table
//
// Like versionsRoute, MOUNT THIS BEFORE pagesRoute — `search`/`reindex` are
// non-integer path segments that pagesRoute's `/:id` matcher would else 400 on.

import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createLocalApi } from "../cms/localApi.js";
import type { CollectionConfig } from "../cms/types.js";
import { db } from "../db/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

export interface SearchRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The searchable collection's main table. */
  table: SQLiteTable;
  /** The collection config — must declare `search.fields`. */
  config: CollectionConfig;
  /** Resolve the editor session (search is editor-only). */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path (the collection base). Default `/api/louise/pages`. */
  path?: string;
}

/**
 * Turn free user input into a safe FTS5 MATCH expression: split on whitespace,
 * quote each term (escaping embedded quotes) and prefix-match it, joined by
 * space (implicit AND). Quoting neutralizes FTS5 operator characters, so odd
 * input can't become a query-syntax error.
 */
function toFtsQuery(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" ");
}

/**
 * Build the search route for a collection with a `search` config. Returns
 * `undefined` for any path it doesn't own so `composeWorker` falls through.
 */
export function searchRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  cfg: SearchRouteConfig<Env>,
): WorkerRoute<Env> {
  const base = cfg.path ?? "/api/louise/pages";

  return async (request, env) => {
    const url = new URL(request.url);
    const isSearch = url.pathname === `${base}/search`;
    const isReindex = url.pathname === `${base}/reindex`;
    if (!isSearch && !isReindex) return undefined;

    const g = await guardEditor(request, env, cfg.resolveEditor, isReindex);
    if ("response" in g) return g.response;
    const context = { session: g.editor };
    const api = createLocalApi(db(env.DB), cfg.table, cfg.config);

    if (isSearch && request.method === "GET") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      if (!q) return json({ results: [] });
      const limit = Number(url.searchParams.get("limit")) || 20;
      try {
        const results = await api.search(context, toFtsQuery(q), { limit });
        return json({ results });
      } catch (err) {
        // A malformed FTS query (or a missing index) shouldn't 500 a search box.
        console.error("[louise] search failed", err);
        return json({ results: [] });
      }
    }

    if (isReindex && request.method === "POST") {
      const reindexed = await api.reindexSearch(context);
      return json({ reindexed });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
