// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/ai—rank fusion for hybrid search. Reciprocal Rank Fusion (RRF)
// merges ranked result lists by position alone, so a keyword list scored by FTS5
// `rank` and a semantic list scored by cosine similarity combine without their
// scores ever needing to be comparable. `searchRoute` (editor/search.ts) fuses
// FTS5 and Vectorize results with it; any other retriever can too, which is why
// it lives here rather than beside the route.

/** RRF's rank-damping constant. 60 is the canonical default (Cormack et al.);
 *  a larger value flattens the contribution of top ranks, a smaller one
 *  sharpens it. Override it per call with {@link FuseRankingsOptions.k}. */
export const RRF_K = 60;

/** One ranked input to {@link fuseRankings}. */
export interface RankedList<Id extends string | number> {
  /** IDs ordered best-first. A repeated ID counts only at its first position. */
  ids: readonly Id[];
  /** How much this list counts relative to the others: its contribution to
   *  every ID's score is multiplied by it. A finite, non-negative number;
   *  default 1. Use it to trust one retriever more than another, for example
   *  `2` on a curated list and `1` on a broad one. */
  weight?: number;
}

/** Options for {@link fuseRankings}. */
export interface FuseRankingsOptions<Id extends string | number> {
  /** The rank-damping constant. A finite, non-negative number; default
   *  {@link RRF_K}. */
  k?: number;
  /** Return at most this many IDs, applied after fusion and boosting. A
   *  non-negative integer; omit it to return every ID. */
  limit?: number;
  /**
   * A per-ID multiplier on the fused score, for a signal that belongs to the
   * document rather than to any one list, such as an authority or freshness
   * weight. Called once for each distinct ID; return a finite, non-negative
   * number, where 1 leaves the score unchanged. Omit it to leave every score
   * as fused.
   */
  boost?: (id: Id) => number;
}

/**
 * Fuse ranked ID lists with Reciprocal Rank Fusion and return the IDs
 * best-first.
 *
 * An ID's score is the sum, over every list it appears in, of
 * `weight / (k + rank)`, with a 1-indexed rank. An ID ranked high in _any_ list
 * surfaces, and one ranked in several is lifted above one ranked in a single
 * list, all without comparing the lists' native scores. `boost`, when given,
 * then multiplies each ID's fused score. IDs with equal scores order by ID
 * (numbers ascending, strings by UTF-16 code unit, numbers before strings), so
 * the result is deterministic whatever order the lists arrive in.
 *
 * **Why a list of lists.** Hybrid search is rarely exactly two retrievers:
 * keyword and vector today, a title-only or tag index tomorrow. One array of
 * `{ ids, weight }` takes any number of lists, keeps each weight next to the
 * list it applies to, and reads the same for two lists as for five. IDs are
 * generic, so numeric row IDs and string document keys both work unchanged.
 *
 * **Why `boost` is an option.** The result carries no scores, so a caller
 * can't reweight it afterward without guessing at the gaps between ranks. A
 * per-document signal has to meet the fused score before sorting and before
 * `limit` trims the tail, and that happens here.
 *
 * @example
 * ```ts
 * import { fuseRankings } from "louise-toolkit/ai";
 *
 * // Keyword hits from FTS5 and semantic hits from Vectorize, keyed by
 * // document slug and ordered best-first.
 * const keyword = ["pricing", "faq", "about"];
 * const semantic = ["faq", "plans", "pricing"];
 * const authority = new Map([["plans", 1.5]]);
 *
 * const top = fuseRankings([{ ids: keyword }, { ids: semantic, weight: 0.8 }], {
 *   boost: (slug) => authority.get(slug) ?? 1,
 *   limit: 10,
 * });
 * ```
 *
 * @throws {RangeError} When `k`, a `weight`, or a `boost` result isn't a
 *   finite, non-negative number, or `limit` isn't a non-negative integer.
 */
export function fuseRankings<Id extends string | number>(
  lists: readonly RankedList<Id>[],
  options: FuseRankingsOptions<Id> = {},
): Id[] {
  const k = options.k ?? RRF_K;
  assertNonNegative(k, "k");
  const { limit } = options;
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 0)) {
    throw new RangeError(`fuseRankings: limit must be a non-negative integer, got ${limit}`);
  }

  const scores = new Map<Id, number>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    assertNonNegative(weight, "weight");
    const seen = new Set<Id>();
    list.ids.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + i + 1));
    });
  }

  if (options.boost) {
    for (const [id, score] of scores) {
      const factor = options.boost(id);
      assertNonNegative(factor, "boost");
      scores.set(id, score * factor);
    }
  }

  const fused = [...scores.keys()].sort((a, b) => {
    const byScore = (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
    return byScore !== 0 ? byScore : compareIds(a, b);
  });
  return limit === undefined ? fused : fused.slice(0, limit);
}

/** Throw a RangeError unless `value` is a finite number at or above zero. */
function assertNonNegative(value: number, name: string): void {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(
      `fuseRankings: ${name} must be a finite, non-negative number, got ${value}`,
    );
  }
}

/** The tiebreak order for IDs with equal scores: numbers ascending, strings by
 *  UTF-16 code unit (locale-independent, so every runtime agrees), and numbers
 *  ahead of strings when a caller mixes the two. */
function compareIds(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a !== typeof b) return typeof a === "number" ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
