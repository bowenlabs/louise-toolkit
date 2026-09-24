// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/ai—semantic search primitives: Workers AI text embeddings +
// a Cloudflare Vectorize index (#86). A keyword layer (D1 FTS5, see
// editor/search.ts) finds tokens; embeddings find *intent*. These helpers sit
// ALONGSIDE that index, never replacing it, and DEGRADE GRACEFULLY the same way
// the rest of `core/ai` does: no `AI`/`VECTORIZE` binding (or any error) → the
// embed returns `null` / the search returns `[]`, so the FTS path carries the
// query unchanged. Nothing here is on a write's critical path.
//
// Like `AiRunner`, the index contract ({@link VectorIndex}) is hand-defined:
// a structural subset of workers-types' `VectorizeIndex`, satisfied by the real
// `env.VECTORIZE` binding with no cast—so the module stays decoupled from a
// specific `@cloudflare/workers-types` version and is trivially faked in tests.

import { type AiGatewayOptions, type AiRunner, runAi } from "./index.js";

/** Default Workers AI text-embedding model. `bge-base-en-v1.5` is a small,
 *  inexpensive 768-dimension English model—a good default for short CMS page
 *  text. A Vectorize index must be created with the SAME dimensions + a `cosine`
 *  metric (`wrangler vectorize create … --dimensions=768 --metric=cosine`).
 *  Overridable per call so a site can swap models (create a matching index). */
export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

export interface EmbedOptions {
  /** Embedding model id. Default {@link DEFAULT_EMBEDDING_MODEL}. */
  model?: string;
  /** Route through AI Gateway (#87)—caching, cost caps, fallbacks, logging. */
  gateway?: AiGatewayOptions;
}

/**
 * Embed a single text into a dense vector via Workers AI. Best-effort: returns
 * `null` when the runner is absent (binding not provisioned), the input is
 * blank, or the model errors / returns an unexpected shape—so a caller keeps
 * its non-semantic fallback (the FTS result set). Never throws.
 *
 * Text-embedding models return `{ shape, data }` where `data` is an array of
 * per-input vectors; single-input callers want `data[0]`. A bare `number[]` (or
 * `{ embedding }`) is tolerated too so a model swap doesn't need a code change.
 */
export async function embed(
  runner: AiRunner | undefined,
  text: string,
  opts: EmbedOptions = {},
): Promise<number[] | null> {
  const input = text.trim();
  if (!input) return null;
  const out = await runAi(
    runner,
    opts.model ?? DEFAULT_EMBEDDING_MODEL,
    { text: input },
    opts.gateway ? { gateway: opts.gateway } : undefined,
  );
  return extractVector(out);
}

/** Pull a single embedding vector out of a Workers AI response, tolerating the
 *  common shapes: `{ data: number[][] }` (batch), `{ data: number[] }`,
 *  `{ embedding: number[] }`, or a bare `number[]`. Returns `null` for anything
 *  else, so a malformed/empty response degrades rather than throwing. */
function extractVector(out: unknown): number[] | null {
  if (isNumberArray(out)) return out;
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  const data = o.data ?? o.embedding ?? o.result;
  if (isNumberArray(data)) return data;
  // Batch shape: data is an array of vectors—take the first.
  if (Array.isArray(data) && isNumberArray(data[0])) return data[0];
  return null;
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === "number");
}

// ── Vectorize index contract ─────────────────────────────────────────────────

/** A value Vectorize accepts in a vector's metadata—JSON primitives plus a
 *  string array (mirrors workers-types' `VectorizeVectorMetadata`, kept
 *  hand-defined so this module isn't pinned to a workers-types version). Typed
 *  precisely (not `unknown`) so the real `VectorizeIndex` binding is structurally
 *  assignable to {@link VectorIndex} under `strictFunctionTypes`. */
export type VectorMetadataValue = string | number | boolean | string[];

/** One record in a {@link VectorIndex}. `id` is unique across the whole index
 *  (Vectorize ids are global, not per-namespace); see {@link contentVectorId}. */
export interface VectorRecord {
  id: string;
  values: number[];
  /** Optional query-scoping partition (we set it to the collection slug). */
  namespace?: string;
  metadata?: Record<string, VectorMetadataValue>;
}

/** One hit from {@link VectorIndex.query}: the record id and its similarity score. */
export interface VectorMatch {
  id: string;
  score: number;
}

/** Options for a {@link VectorIndex.query}. A structural subset of workers-types'
 *  `VectorizeQueryOptions`: only the fields these helpers set. */
export interface VectorQueryOptions {
  topK?: number;
  namespace?: string;
}

/**
 * The capability the semantic helpers need from a Vectorize binding: `upsert`,
 * `query`, and `deleteByIds`. Hand-defined (method syntax, so the real
 * `env.VECTORIZE` binding satisfies it structurally without a cast—same
 * precedent as {@link AiRunner}); a test double is just an object with these
 * three methods. Mutation methods return `unknown` because the async-mutation
 * receipt Vectorize returns is never inspected here.
 */
export interface VectorIndex {
  upsert(vectors: VectorRecord[]): Promise<unknown>;
  query(vector: number[], options?: VectorQueryOptions): Promise<{ matches: VectorMatch[] }>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/** Compose the globally-unique Vectorize id for a content row—`${namespace}:${id}`,
 *  so multiple collections can share one index without id collisions. Paired
 *  with the record's `namespace` for query scoping. */
export function contentVectorId(namespace: string, id: number): string {
  return `${namespace}:${id}`;
}

/** Recover the numeric row id from a {@link contentVectorId}, or `null` if the
 *  id doesn't carry a numeric suffix (a foreign record sharing the index). */
export function parseContentVectorId(vectorId: string): number | null {
  const suffix = vectorId.slice(vectorId.lastIndexOf(":") + 1);
  if (!suffix) return null;
  const n = Number(suffix);
  return Number.isInteger(n) ? n : null;
}

// ── Index / query one collection's content ───────────────────────────────────

export interface IndexContentOptions extends EmbedOptions {
  /** Extra metadata stored on the vector (the collection slug + row id are
   *  always included so a match can be mapped back without re-embedding).
   *  Values must be Vectorize primitives—see {@link VectorMetadataValue}. */
  metadata?: Record<string, VectorMetadataValue>;
}

/**
 * Embed `text` and upsert it into `index` under the row's {@link contentVectorId}.
 * Best-effort → returns `true` on a successful upsert, `false` when the index is
 * absent, the embed yields nothing, or either call errors—so an embed-on-publish
 * caller never fails the publish over a missing/erroring binding. `namespace` is
 * the collection slug: it scopes queries and namespaces the stored vector.
 */
export async function indexContent(
  index: VectorIndex | undefined,
  runner: AiRunner | undefined,
  namespace: string,
  id: number,
  text: string,
  opts: IndexContentOptions = {},
): Promise<boolean> {
  if (!index) return false;
  const vector = await embed(runner, text, opts);
  if (!vector) return false;
  try {
    await index.upsert([
      {
        id: contentVectorId(namespace, id),
        values: vector,
        namespace,
        metadata: { collection: namespace, docId: id, ...opts.metadata },
      },
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a content row's vector from `index` (its counterpart to
 * {@link indexContent}—call it when a row is unpublished or deleted).
 * Best-effort: no-ops without an index and swallows a delete error.
 */
export async function removeContentVector(
  index: VectorIndex | undefined,
  namespace: string,
  id: number,
): Promise<void> {
  if (!index) return;
  try {
    await index.deleteByIds([contentVectorId(namespace, id)]);
  } catch {
    // best-effort—a stale vector is harmless (its row won't hydrate, so the
    // merge drops it), never worth failing the caller.
  }
}

export interface SemanticSearchOptions extends EmbedOptions {
  /** Max matches to return. Default 20. */
  topK?: number;
}

/**
 * Semantic search over one collection's vectors: embed `query`, ask `index` for
 * the nearest `namespace`-scoped records, and return each hit's numeric row id +
 * score, best-first. Best-effort → `[]` when the index/runner is absent, the
 * query embeds to nothing, or the query errors, so a caller falls back cleanly
 * to keyword results. Matches whose id doesn't parse to a numeric row id (a
 * foreign record) are skipped.
 *
 * PRIVACY—this is the one Louise path that sends *visitor*-supplied text off
 * the origin: the search query is embedded by Workers AI (a Cloudflare
 * first-party binding, not a third party) before the vector lookup. Editor
 * content going to the AI helpers is expected; a visitor's query may not be, so
 * disclose it if your privacy policy enumerates processors. Omit the `index`/
 * runner and search stays entirely local (keyword FTS).
 */
export async function semanticSearch(
  index: VectorIndex | undefined,
  runner: AiRunner | undefined,
  namespace: string,
  query: string,
  opts: SemanticSearchOptions = {},
): Promise<{ id: number; score: number }[]> {
  if (!index) return [];
  const vector = await embed(runner, query, opts);
  if (!vector) return [];
  try {
    const { matches } = await index.query(vector, {
      topK: opts.topK ?? 20,
      namespace,
    });
    const results: { id: number; score: number }[] = [];
    for (const match of matches) {
      const id = parseContentVectorId(match.id);
      if (id !== null) results.push({ id, score: match.score });
    }
    return results;
  } catch {
    return [];
  }
}
