// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—search for a collection with a `search` config.
// Exposes the Local API's FTS5-backed `search()` (and a one-shot `reindex`) over
// HTTP, and—when a Vectorize index + Workers AI runner are wired (#86)—blends
// in a semantic layer so a query matches intent, not just tokens:
//   GET  /api/louise/pages/search?q=…&limit=…   ranked matches (published rows)
//   POST /api/louise/pages/reindex               rebuild the FTS index from the table
//
// The semantic layer is OPTIONAL and DEGRADES GRACEFULLY: absent the `vector`
// deps (or on any embed/query error) the route is exactly the FTS-only behavior
// it always was. When present, keyword and semantic result lists are fused with
// Reciprocal Rank Fusion (RRF)—a rank-only merge that needs no comparable
// scores between FTS `rank` and cosine similarity.
//
// Like versionsRoute, MOUNT THIS BEFORE pagesRoute: `search`/`reindex` are
// non-integer path segments that pagesRoute's `/:id` matcher would else 400 on.

import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  type AiGatewayOptions,
  type AiRunner,
  fuseRankings,
  semanticSearch,
  type VectorIndex,
} from "../ai/index.js";
import { createLocalApi } from "../content/localApi.js";
import type { CollectionConfig } from "../content/types.js";
import { db } from "../db/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "./shared.js";

/** Optional semantic-search deps for {@link SearchRouteConfig}. Supply both a
 *  Vectorize index and a Workers AI runner (typically `(env) => env.VECTORIZE`
 *  and `(env) => env.AI`); return `undefined` from either—the binding isn't
 *  provisioned—and the route runs FTS-only, no error surfaced. */
export interface SearchVectorConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The Vectorize index holding this collection's embedded content. */
  index: (env: Env) => VectorIndex | undefined;
  /** The Workers AI runner used to embed the query. */
  ai: (env: Env) => AiRunner | undefined;
  /** Embedding model id—MUST match the model the index was built with. */
  model?: string;
  /** Route the query embedding through AI Gateway (#87)—caching, cost caps. */
  gateway?: (env: Env) => AiGatewayOptions | undefined;
  /** How many nearest neighbours to pull before fusing. Default 20. */
  topK?: number;
  /** Drop semantic matches scored below this floor before fusing, so a query
   *  that matches nothing adds nothing. No default: omit it to keep every
   *  match. See `SemanticSearchOptions.minScore` in `louise-toolkit/ai`. */
  minScore?: number;
}

export interface SearchRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The searchable collection's main table. */
  table: SQLiteTable;
  /** The collection config—must declare `search.fields`. */
  config: CollectionConfig;
  /** Resolve the editor session (search is editor-only). */
  resolveEditor: ResolveEditor<Env>;
  /** Mount path (the collection base). Default `/api/louise/pages`. */
  path?: string;
  /** Optional semantic layer (#86). Omit for FTS-only search. */
  vector?: SearchVectorConfig<Env>;
}

/**
 * Turn free user input into a safe FTS5 MATCH expression: split on whitespace,
 * quote each term (escaping embedded quotes) and prefix-match it, joined by
 * space (implicit AND). Quoting neutralizes FTS5 operator characters, so odd
 * input can't become a query-syntax error. The MCP search tool uses it too.
 */
export function toFtsQuery(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" ");
}

/** Default and hard ceiling for a search request's `?limit=`. */
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 100;

/**
 * Parse `?limit=` into a positive integer clamped to {@link SEARCH_LIMIT_MAX},
 * falling back to {@link SEARCH_LIMIT_DEFAULT} for a missing / non-numeric /
 * non-positive value—so a client can't request an unbounded result set.
 */
export function parseSearchLimit(raw: string | null): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, SEARCH_LIMIT_MAX) : SEARCH_LIMIT_DEFAULT;
}

/** A row's numeric id, or `null` when a result row lacks one (never expected for
 *  a searchable collection, since the FTS rowid IS the id, but typed defensively). */
function rowId(row: unknown): number | null {
  const id = (row as { id?: unknown }).id;
  return typeof id === "number" ? id : null;
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
      const limit = parseSearchLimit(url.searchParams.get("limit"));
      try {
        const results = await runSearch(api, context, cfg, env, q, limit);
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

/**
 * Run the search: always FTS; when a semantic layer is configured and its
 * bindings resolve, also embed+query Vectorize and RRF-fuse the two lists,
 * hydrating any semantic-only hit into a full row. Semantic failures collapse to
 * `[]` inside {@link semanticSearch}, so this reduces to the FTS result set
 * unchanged—nothing here can make configured search worse than FTS-only.
 */
async function runSearch<Env extends EditorRouteEnv>(
  api: ReturnType<typeof createLocalApi>,
  context: { session: unknown },
  cfg: SearchRouteConfig<Env>,
  env: Env,
  q: string,
  limit: number,
): Promise<unknown[]> {
  // FTS pulls `limit` rows; semantic pulls topK—fusing can reorder within the
  // combined pool, so query the keyword side at full `limit`.
  const ftsRows = await api.search(context, toFtsQuery(q), { limit });

  const index = cfg.vector?.index(env);
  const runner = cfg.vector?.ai(env);
  if (!cfg.vector || !index || !runner) return ftsRows; // FTS-only

  const semantic = await semanticSearch(index, runner, cfg.config.slug, q, {
    topK: cfg.vector.topK ?? SEARCH_LIMIT_DEFAULT,
    model: cfg.vector.model,
    gateway: cfg.vector.gateway?.(env),
    minScore: cfg.vector.minScore,
  });
  if (semantic.length === 0) return ftsRows; // no semantic signal → keyword order

  // Index the keyword rows by id; hydrate semantic-only ids in one batch of
  // reads (a vector may point at a since-unpublished/deleted row → drop it).
  const byId = new Map<number, unknown>();
  const ftsIds: number[] = [];
  for (const row of ftsRows) {
    const id = rowId(row);
    if (id !== null) {
      byId.set(id, row);
      ftsIds.push(id);
    }
  }
  const missing = semantic.map((m) => m.id).filter((id) => !byId.has(id));
  const hydrated = await Promise.all(
    missing.map((id) => api.findByID(context, id).catch(() => null)),
  );
  for (const row of hydrated) {
    if (!row) continue;
    const id = rowId(row);
    if (id !== null) byId.set(id, row);
  }

  const semanticIds = semantic.map((m) => m.id).filter((id) => byId.has(id));
  const fused = fuseRankings([{ ids: ftsIds }, { ids: semanticIds }]);
  return fused
    .map((id) => byId.get(id))
    .filter((row) => row !== undefined)
    .slice(0, limit);
}
