import { describe, expect, it, vi } from "vitest";
import {
  type AiRunner,
  contentVectorId,
  DEFAULT_EMBEDDING_MODEL,
  EMBED_MANY_BATCH,
  embed,
  embedMany,
  indexContent,
  indexContents,
  parseContentVectorId,
  removeContentVector,
  semanticSearch,
  type VectorIndex,
  type VectorRecord,
} from "../../src/core/ai/index.js";

/** A fake Workers AI runner returning a canned output and recording each call. */
function runner(output: unknown): {
  runner: AiRunner;
  calls: { model: string; inputs: Record<string, unknown>; options?: Record<string, unknown> }[];
} {
  const calls: {
    model: string;
    inputs: Record<string, unknown>;
    options?: Record<string, unknown>;
  }[] = [];
  return {
    calls,
    runner: {
      run: vi.fn(async (model: string, inputs, options) => {
        calls.push({ model, inputs, options });
        return output;
      }),
    },
  };
}

/** A fake Vectorize index recording upserts/queries/deletes; `matches` is what
 *  `query` returns. */
function fakeIndex(matches: { id: string; score: number }[] = []): {
  index: VectorIndex;
  upserts: VectorRecord[][];
  queries: { vector: number[]; options?: { topK?: number; namespace?: string } }[];
  deletes: string[][];
} {
  const upserts: VectorRecord[][] = [];
  const queries: { vector: number[]; options?: { topK?: number; namespace?: string } }[] = [];
  const deletes: string[][] = [];
  return {
    upserts,
    queries,
    deletes,
    index: {
      upsert: async (vectors) => {
        upserts.push(vectors);
      },
      query: async (vector, options) => {
        queries.push({ vector, options });
        return { matches };
      },
      deleteByIds: async (ids) => {
        deletes.push(ids);
      },
    },
  };
}

// Type-level: the real workers-types `VectorizeIndex` binding satisfies
// VectorIndex, so a site wires `index: (env) => env.VECTORIZE` with no cast.
// (Compile-time check; never called.)
() => {
  const idx = undefined as unknown as VectorizeIndex;
  const asIndex: VectorIndex = idx;
  void asIndex;
};

describe("embed", () => {
  it("returns null without a runner (binding not provisioned)", async () => {
    expect(await embed(undefined, "hello")).toBeNull();
  });

  it("returns null for blank input (nothing to embed)", async () => {
    const { runner: r, calls } = runner({ data: [[1, 2, 3]] });
    expect(await embed(r, "   ")).toBeNull();
    expect(calls).toHaveLength(0); // never calls the model
  });

  it("extracts the first vector from the batch { data: number[][] } shape", async () => {
    const { runner: r, calls } = runner({ shape: [1, 3], data: [[0.1, 0.2, 0.3]] });
    expect(await embed(r, "hello")).toEqual([0.1, 0.2, 0.3]);
    expect(calls[0]?.model).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(calls[0]?.inputs).toEqual({ text: "hello" });
  });

  it("tolerates a flat { data: number[] } and a bare number[]", async () => {
    const flat = runner({ data: [1, 2] });
    expect(await embed(flat.runner, "x")).toEqual([1, 2]);
    const bare = runner([3, 4]);
    expect(await embed(bare.runner, "x")).toEqual([3, 4]);
    const emb = runner({ embedding: [5, 6] });
    expect(await embed(emb.runner, "x")).toEqual([5, 6]);
  });

  it("returns null on an unexpected response shape", async () => {
    const { runner: r } = runner({ nope: true });
    expect(await embed(r, "x")).toBeNull();
  });

  it("honors a custom model + gateway (threaded to run options)", async () => {
    const { runner: r, calls } = runner({ data: [[1]] });
    await embed(r, "x", { model: "@cf/other", gateway: { id: "gw" } });
    expect(calls[0]?.model).toBe("@cf/other");
    expect(calls[0]?.options).toEqual({ gateway: { id: "gw" } });
  });

  it("asks for a pooling only when given one", async () => {
    const { runner: r, calls } = runner({ data: [[1]] });
    await embed(r, "x");
    await embed(r, "x", { pooling: "cls" });
    expect(calls.map((call) => call.inputs)).toEqual([
      { text: "x" },
      { text: "x", pooling: "cls" },
    ]);
  });

  it("swallows a thrown model error and returns null (never a gate)", async () => {
    const r: AiRunner = {
      run: async () => {
        throw new Error("model down");
      },
    };
    expect(await embed(r, "x")).toBeNull();
  });
});

/** A batch runner: one vector per input text, `[length, i]`, so a test can see
 *  which text each vector came from. */
function batchRunner(fail?: (texts: string[]) => boolean) {
  const calls: string[][] = [];
  const inputs: Record<string, unknown>[] = [];
  const run: AiRunner = {
    run: vi.fn(async (_model: string, input: Record<string, unknown>) => {
      const texts = input.text as string[];
      calls.push(texts);
      inputs.push(input);
      if (fail?.(texts)) throw new Error("model error");
      return { shape: [texts.length, 2], data: texts.map((text, i) => [text.length, i]) };
    }),
  };
  return { runner: run, calls, inputs };
}

describe("embedMany", () => {
  it("embeds every text in one call per batch with CLS pooling, in input order", async () => {
    const { runner: r, calls, inputs } = batchRunner();
    const vectors = await embedMany(r, ["a", "bb", "ccc"], { pooling: "cls" });
    expect(calls).toEqual([["a", "bb", "ccc"]]);
    expect(inputs[0]).toMatchObject({ pooling: "cls" });
    expect(vectors).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  it("splits into batches of batchSize, 100 by default", async () => {
    expect(EMBED_MANY_BATCH).toBe(100);
    const { runner: r, calls } = batchRunner();
    await embedMany(
      r,
      Array.from({ length: 250 }, (_, i) => `t${i}`),
      { pooling: "cls" },
    );
    expect(calls.map((batch) => batch.length)).toEqual([100, 100, 50]);
    const small = batchRunner();
    await embedMany(small.runner, ["a", "b", "c"], { batchSize: 2, pooling: "cls" });
    expect(small.calls.map((batch) => batch.length)).toEqual([2, 1]);
  });

  it("sends one text per call with mean pooling, because a batch would change each text's vector", async () => {
    for (const pooling of [undefined, "mean"] as const) {
      const { runner: r, calls, inputs } = batchRunner();
      const vectors = await embedMany(r, ["a", "bb", "ccc"], {
        batchSize: 50,
        ...(pooling ? { pooling } : {}),
      });
      expect(calls).toEqual([["a"], ["bb"], ["ccc"]]);
      expect(vectors).toEqual([
        [1, 0],
        [2, 0],
        [3, 0],
      ]);
      expect(inputs.every((input) => input.pooling === pooling)).toBe(true);
    }
  });

  it("skips blank texts, trims the rest, and keeps every entry's position", async () => {
    const { runner: r, calls } = batchRunner();
    const vectors = await embedMany(r, [" a ", "", "  ", "b"], { pooling: "cls" });
    expect(calls).toEqual([["a", "b"]]);
    expect(vectors).toEqual([[1, 0], null, null, [1, 1]]);
  });

  it("returns null for every text in a batch that fails, and keeps the other batches", async () => {
    const { runner: r } = batchRunner((texts) => texts.includes("bad"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const vectors = await embedMany(r, ["ok1", "bad", "ok2"], { batchSize: 2, pooling: "cls" });
    errors.mockRestore();
    expect(vectors).toEqual([null, null, [3, 0]]);
  });

  it("returns null for a batch whose response doesn't hold one vector per text", async () => {
    const { runner: r } = runner({ data: [[0.1, 0.2]] });
    expect(await embedMany(r, ["a", "b"], { pooling: "cls" })).toEqual([null, null]);
    const { runner: garbage } = runner("nope");
    expect(await embedMany(garbage, ["a", "b"])).toEqual([null, null]);
  });

  it("accepts embed's single-vector shapes for a one-text batch", async () => {
    const { runner: r } = runner({ embedding: [0.5, 0.5] });
    expect(await embedMany(r, ["a"])).toEqual([[0.5, 0.5]]);
  });

  it("returns all nulls without a runner, and nothing for no texts", async () => {
    expect(await embedMany(undefined, ["a", "b"])).toEqual([null, null]);
    const { runner: r, calls } = batchRunner();
    expect(await embedMany(r, [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("passes the model and the gateway through", async () => {
    const { runner: r, calls } = runner({ data: [[1]] });
    await embedMany(r, ["a"], { model: "@cf/baai/bge-small-en-v1.5", gateway: { id: "gw" } });
    expect(calls[0]).toMatchObject({
      model: "@cf/baai/bge-small-en-v1.5",
      options: { gateway: { id: "gw" } },
    });
  });

  it("refuses a batch size that isn't a positive integer", async () => {
    await expect(embedMany(undefined, ["a"], { batchSize: 0 })).rejects.toThrow(RangeError);
    await expect(embedMany(undefined, ["a"], { batchSize: 1.5 })).rejects.toThrow(RangeError);
  });
});

describe("indexContents", () => {
  it("embeds rows in one call with CLS pooling and upserts their vectors, with per-row metadata", async () => {
    const { runner: r, calls } = batchRunner();
    const idx = fakeIndex();
    const stored = await indexContents(
      idx.index,
      r,
      "pages",
      [
        { id: 1, text: "one" },
        { id: 2, text: "" },
        { id: 3, text: "three", metadata: { locale: "en" } },
      ],
      { metadata: { site: "x" }, pooling: "cls" },
    );
    expect(stored).toEqual([1, 3]);
    expect(calls).toHaveLength(1);
    expect(idx.upserts).toEqual([
      [
        {
          id: "pages:1",
          values: [3, 0],
          namespace: "pages",
          metadata: { collection: "pages", docId: 1, site: "x" },
        },
        {
          id: "pages:3",
          values: [5, 1],
          namespace: "pages",
          metadata: { collection: "pages", docId: 3, site: "x", locale: "en" },
        },
      ],
    ]);
  });

  it("returns nothing without an index or rows, and leaves out a failed upsert", async () => {
    const { runner: r } = batchRunner();
    expect(await indexContents(undefined, r, "pages", [{ id: 1, text: "a" }])).toEqual([]);
    const idx = fakeIndex();
    expect(await indexContents(idx.index, r, "pages", [])).toEqual([]);
    const failing: VectorIndex = {
      ...idx.index,
      upsert: async () => Promise.reject(new Error("down")),
    };
    expect(await indexContents(failing, r, "pages", [{ id: 1, text: "a" }])).toEqual([]);
  });

  it("upserts at most 1,000 vectors at a time", async () => {
    const { runner: r } = batchRunner();
    const idx = fakeIndex();
    const items = Array.from({ length: 1200 }, (_, i) => ({ id: i, text: `t${i}` }));
    expect(await indexContents(idx.index, r, "pages", items, { pooling: "cls" })).toHaveLength(
      1200,
    );
    expect(idx.upserts.map((batch) => batch.length)).toEqual([1000, 200]);
  });
});

describe("contentVectorId / parseContentVectorId", () => {
  it("composes a globally-unique id and parses the row id back", () => {
    expect(contentVectorId("pages", 5)).toBe("pages:5");
    expect(parseContentVectorId("pages:5")).toBe(5);
  });

  it("returns null for an id without a numeric suffix (a foreign record)", () => {
    expect(parseContentVectorId("some-external-doc")).toBeNull();
    expect(parseContentVectorId("pages:abc")).toBeNull();
    expect(parseContentVectorId("pages:")).toBeNull();
  });
});

describe("indexContent", () => {
  it("returns false without an index (Vectorize not provisioned)", async () => {
    const { runner: r } = runner({ data: [[1]] });
    expect(await indexContent(undefined, r, "pages", 1, "text")).toBe(false);
  });

  it("returns false when the embed yields nothing (no upsert attempted)", async () => {
    const { index, upserts } = fakeIndex();
    expect(await indexContent(index, undefined, "pages", 1, "text")).toBe(false);
    expect(upserts).toHaveLength(0);
  });

  it("upserts the composed id + namespace + default metadata and returns true", async () => {
    const { runner: r } = runner({ data: [[0.1, 0.2]] });
    const { index, upserts } = fakeIndex();
    expect(await indexContent(index, r, "pages", 7, "hello world")).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.[0]).toEqual({
      id: "pages:7",
      values: [0.1, 0.2],
      namespace: "pages",
      metadata: { collection: "pages", docId: 7 },
    });
  });

  it("merges caller metadata over the defaults", async () => {
    const { runner: r } = runner({ data: [[1]] });
    const { index, upserts } = fakeIndex();
    await indexContent(index, r, "pages", 1, "t", { metadata: { title: "Home" } });
    expect(upserts[0]?.[0]?.metadata).toEqual({ collection: "pages", docId: 1, title: "Home" });
  });

  it("returns false when the upsert throws (best-effort, never a gate)", async () => {
    const { runner: r } = runner({ data: [[1]] });
    const index: VectorIndex = {
      upsert: async () => {
        throw new Error("vectorize down");
      },
      query: async () => ({ matches: [] }),
      deleteByIds: async () => {},
    };
    expect(await indexContent(index, r, "pages", 1, "t")).toBe(false);
  });
});

describe("removeContentVector", () => {
  it("no-ops without an index (never throws)", async () => {
    await expect(removeContentVector(undefined, "pages", 1)).resolves.toBeUndefined();
  });

  it("deletes the composed id", async () => {
    const { index, deletes } = fakeIndex();
    await removeContentVector(index, "pages", 9);
    expect(deletes).toEqual([["pages:9"]]);
  });

  it("swallows a delete error", async () => {
    const index: VectorIndex = {
      upsert: async () => {},
      query: async () => ({ matches: [] }),
      deleteByIds: async () => {
        throw new Error("down");
      },
    };
    await expect(removeContentVector(index, "pages", 1)).resolves.toBeUndefined();
  });
});

describe("semanticSearch", () => {
  it("returns [] without an index or runner", async () => {
    const { runner: r } = runner({ data: [[1]] });
    expect(await semanticSearch(undefined, r, "pages", "q")).toEqual([]);
    const { index } = fakeIndex();
    expect(await semanticSearch(index, undefined, "pages", "q")).toEqual([]);
  });

  it("embeds the query, scopes to the namespace, and returns parsed hits", async () => {
    const { runner: r } = runner({ data: [[0.5, 0.5]] });
    const { index, queries } = fakeIndex([
      { id: "pages:3", score: 0.91 },
      { id: "pages:8", score: 0.72 },
    ]);
    const hits = await semanticSearch(index, r, "pages", "intent", { topK: 5 });
    expect(hits).toEqual([
      { id: 3, score: 0.91 },
      { id: 8, score: 0.72 },
    ]);
    expect(queries[0]?.vector).toEqual([0.5, 0.5]);
    expect(queries[0]?.options).toEqual({ topK: 5, namespace: "pages" });
  });

  it("embeds the query with the pooling it's given, to match the indexed vectors", async () => {
    const { runner: r, calls } = runner({ data: [[0.5, 0.5]] });
    await semanticSearch(fakeIndex().index, r, "pages", "intent", { pooling: "cls" });
    expect(calls[0]?.inputs).toEqual({ text: "intent", pooling: "cls" });
  });

  it("skips matches whose id doesn't parse to a numeric row id", async () => {
    const { runner: r } = runner({ data: [[1]] });
    const { index } = fakeIndex([
      { id: "foreign-doc", score: 0.9 },
      { id: "pages:2", score: 0.8 },
    ]);
    expect(await semanticSearch(index, r, "pages", "q")).toEqual([{ id: 2, score: 0.8 }]);
  });

  it("keeps every match when no minScore is set (no default floor)", async () => {
    const { runner: r } = runner({ data: [[1]] });
    const { index } = fakeIndex([
      { id: "pages:1", score: 0.9 },
      { id: "pages:2", score: 0.05 },
      { id: "pages:3", score: -0.4 },
    ]);
    expect(await semanticSearch(index, r, "pages", "q")).toEqual([
      { id: 1, score: 0.9 },
      { id: 2, score: 0.05 },
      { id: 3, score: -0.4 },
    ]);
  });

  it("drops matches scored below minScore and keeps one exactly at it", async () => {
    const { runner: r } = runner({ data: [[1]] });
    const { index, queries } = fakeIndex([
      { id: "pages:1", score: 0.9 },
      { id: "pages:2", score: 0.6 },
      { id: "pages:3", score: 0.59 },
    ]);
    const hits = await semanticSearch(index, r, "pages", "q", { minScore: 0.6 });
    expect(hits).toEqual([
      { id: 1, score: 0.9 },
      { id: 2, score: 0.6 },
    ]);
    // The floor filters results; it doesn't change what's asked of the index.
    expect(queries[0]?.options).toEqual({ topK: 20, namespace: "pages" });
  });

  it("returns [] when every match is below minScore", async () => {
    const { runner: r } = runner({ data: [[1]] });
    const { index } = fakeIndex([{ id: "pages:1", score: 0.2 }]);
    expect(await semanticSearch(index, r, "pages", "q", { minScore: 0.5 })).toEqual([]);
  });

  it("returns [] when the query throws (falls back to keyword search)", async () => {
    const { runner: r } = runner({ data: [[1]] });
    const index: VectorIndex = {
      upsert: async () => {},
      query: async () => {
        throw new Error("vectorize down");
      },
      deleteByIds: async () => {},
    };
    expect(await semanticSearch(index, r, "pages", "q")).toEqual([]);
  });
});
