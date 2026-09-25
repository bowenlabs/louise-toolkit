import { describe, expect, it } from "vitest";
import { fuseRankings, RRF_K } from "../../src/core/ai/index.js";

// The two-list keyword + semantic cases searchRoute relies on are in
// search.test.ts; these cover the generic surface: string IDs, weights, boosts,
// `k`, `limit`, and input validation.

describe("fuseRankings—order", () => {
  it("returns an empty array for no lists or only empty lists", () => {
    expect(fuseRankings([])).toEqual([]);
    expect(fuseRankings([{ ids: [] }, { ids: [] }])).toEqual([]);
  });

  it("returns a single list in its own order", () => {
    expect(fuseRankings([{ ids: ["c", "a", "b"] }])).toEqual(["c", "a", "b"]);
  });

  it("fuses string IDs, lifting one ranked in both lists to the top", () => {
    const fused = fuseRankings([{ ids: ["pricing", "faq", "about"] }, { ids: ["faq", "plans"] }]);
    expect(fused).toEqual(["faq", "pricing", "plans", "about"]);
  });

  it("fuses any number of lists", () => {
    const fused = fuseRankings([{ ids: [1, 2] }, { ids: [3, 2] }, { ids: [2, 4] }]);
    expect(fused[0]).toBe(2);
    expect(fused).toHaveLength(4);
  });

  it("counts a repeated ID only at its first position in a list", () => {
    // Without de-duplication, `b` would score twice from one list and pass `a`.
    expect(fuseRankings([{ ids: ["a", "b", "b"] }, { ids: ["a", "b"] }])).toEqual(["a", "b"]);
  });

  it("scores each position as weight / (k + rank)", () => {
    // `p` is rank 1 at weight 1: 1/61. `q` is rank 2 at weight w: w/62. So `q`
    // passes `p` exactly when w > 62/61 (about 1.0164).
    const rank = (w: number) => fuseRankings([{ ids: ["p"] }, { ids: ["x", "q"], weight: w }]);
    expect(RRF_K).toBe(60);
    expect(rank(1.01).indexOf("p")).toBeLessThan(rank(1.01).indexOf("q"));
    expect(rank(1.02).indexOf("q")).toBeLessThan(rank(1.02).indexOf("p"));
  });
});

describe("fuseRankings—ties", () => {
  it("orders tied numbers ascending", () => {
    expect(fuseRankings([{ ids: [10] }, { ids: [4] }, { ids: [7] }])).toEqual([4, 7, 10]);
  });

  it("orders tied strings by code unit, independent of list order", () => {
    expect(fuseRankings([{ ids: ["b"] }, { ids: ["B"] }, { ids: ["a"] }])).toEqual(["B", "a", "b"]);
    expect(fuseRankings([{ ids: ["a"] }, { ids: ["b"] }, { ids: ["B"] }])).toEqual(["B", "a", "b"]);
  });

  it("orders tied numbers ahead of tied strings when IDs are mixed", () => {
    const lists: { ids: (string | number)[] }[] = [{ ids: ["2"] }, { ids: [10] }, { ids: [1] }];
    expect(fuseRankings(lists)).toEqual([1, 10, "2"]);
  });
});

describe("fuseRankings—weights", () => {
  it("lets a heavier list win a head-to-head", () => {
    const keyword = { ids: ["kw", "shared"] };
    const semantic = { ids: ["sem", "shared"] };
    // Unweighted, the rank-1 hits tie and `kw` wins the ID tiebreak.
    expect(fuseRankings([keyword, semantic])[1]).toBe("kw");
    // Weight the semantic list and its rank-1 hit passes the keyword one.
    const weighted = fuseRankings([keyword, { ...semantic, weight: 2 }]);
    expect(weighted.indexOf("sem")).toBeLessThan(weighted.indexOf("kw"));
  });

  it("treats an omitted weight as 1", () => {
    const lists = [{ ids: [1, 2, 3] }, { ids: [3, 2, 1] }];
    expect(fuseRankings(lists)).toEqual(
      fuseRankings(lists.map((list) => ({ ...list, weight: 1 }))),
    );
  });

  it("keeps a zero-weight list's IDs, ranked after every scored ID", () => {
    expect(fuseRankings([{ ids: ["a"] }, { ids: ["z", "b"], weight: 0 }])).toEqual(["a", "b", "z"]);
  });
});

describe("fuseRankings—boost", () => {
  it("multiplies each fused score, lifting a boosted ID past a better-ranked one", () => {
    const lists = [{ ids: ["first", "second", "third"] }];
    expect(fuseRankings(lists)[0]).toBe("first");
    const boosted = fuseRankings(lists, { boost: (id) => (id === "third" ? 1.5 : 1) });
    expect(boosted[0]).toBe("third");
  });

  it("calls the boost once for each distinct ID", () => {
    const seen: string[] = [];
    fuseRankings([{ ids: ["a", "b"] }, { ids: ["b", "c"] }], {
      boost: (id) => {
        seen.push(id);
        return 1;
      },
    });
    expect(seen.sort()).toEqual(["a", "b", "c"]);
  });

  it("applies the boost before `limit` trims the tail", () => {
    const top = fuseRankings([{ ids: [1, 2, 3, 4] }], {
      boost: (id) => (id === 4 ? 10 : 1),
      limit: 1,
    });
    expect(top).toEqual([4]);
  });
});

describe("fuseRankings—options", () => {
  it("caps the result at `limit`", () => {
    const lists = [{ ids: [5, 4, 3] }, { ids: [2, 1] }];
    expect(fuseRankings(lists, { limit: 2 })).toEqual(fuseRankings(lists).slice(0, 2));
    expect(fuseRankings(lists, { limit: 0 })).toEqual([]);
    expect(fuseRankings(lists, { limit: 99 })).toHaveLength(5);
  });

  it("uses `k` to sharpen or flatten top ranks", () => {
    // `a` is rank 1 in one list; `b` is rank 3 in both. With the default k, two
    // rank-3 hits (2/63) outscore one rank-1 hit (1/61). With k = 0, rank 1
    // (1/1) beats two rank-3 hits (2/3).
    const lists = [{ ids: ["a", "x", "b"] }, { ids: ["c", "y", "b"] }];
    expect(fuseRankings(lists)[0]).toBe("b");
    expect(fuseRankings(lists, { k: 0 })[0]).toBe("a");
  });

  it.each([
    ["a negative k", { k: -1 }],
    ["a non-finite k", { k: Number.POSITIVE_INFINITY }],
    ["a negative limit", { limit: -1 }],
    ["a fractional limit", { limit: 1.5 }],
    ["a NaN boost", { boost: () => Number.NaN }],
    ["a negative boost", { boost: () => -1 }],
  ])("throws a RangeError for %s", (_label, options) => {
    expect(() => fuseRankings([{ ids: [1] }], options)).toThrow(RangeError);
  });

  it("throws a RangeError for a negative or non-finite weight", () => {
    expect(() => fuseRankings([{ ids: [1], weight: -1 }])).toThrow(RangeError);
    expect(() => fuseRankings([{ ids: [1], weight: Number.NaN }])).toThrow(RangeError);
  });
});
