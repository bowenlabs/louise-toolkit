import { describe, expect, it } from "vitest";
import {
  type BufferedDraft,
  clearDraftBuffer,
  DEFAULT_FLUSH_MS,
  type DraftBufferKV,
  draftBufferKey,
  readDraftBuffer,
  shouldFlushBuffer,
  writeDraftBuffer,
} from "../../src/core/editor/draft-buffer.js";

/** In-memory KV that records put options, for asserting the TTL. */
function makeKV(): {
  kv: DraftBufferKV;
  store: Map<string, string>;
  puts: { key: string; ttl?: number }[];
} {
  const store = new Map<string, string>();
  const puts: { key: string; ttl?: number }[] = [];
  const kv: DraftBufferKV = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value, options) {
      store.set(key, value);
      puts.push({ key, ttl: options?.expirationTtl });
    },
    async delete(key) {
      store.delete(key);
    },
  };
  return { kv, store, puts };
}

describe("draftBufferKey", () => {
  it("namespaces by collection + id", () => {
    expect(draftBufferKey("pages", 42)).toBe("draft:pages:42");
    expect(draftBufferKey("posts", "abc")).toBe("draft:posts:abc");
  });
});

describe("shouldFlushBuffer", () => {
  it("flushes when there is no buffer yet (establish the D1 draft)", () => {
    expect(shouldFlushBuffer(null, 1000, DEFAULT_FLUSH_MS)).toBe(true);
  });

  it("absorbs writes within the flush window, flushes once past it", () => {
    const buffer: BufferedDraft = { data: {}, updatedAt: 5000, flushedAt: 5000 };
    expect(shouldFlushBuffer(buffer, 5000 + 9_999, 10_000)).toBe(false); // still buffering
    expect(shouldFlushBuffer(buffer, 5000 + 10_000, 10_000)).toBe(true); // interval elapsed
  });
});

describe("draft buffer read/write/clear", () => {
  it("round-trips a buffered draft and stores a self-expiry TTL", async () => {
    const { kv, puts } = makeKV();
    const key = draftBufferKey("pages", 1);
    const draft: BufferedDraft = {
      data: { title: "Hi", body: "<p>x</p>" },
      updatedAt: 10,
      flushedAt: 10,
    };
    await writeDraftBuffer(kv, key, draft);
    expect(puts[0]).toEqual({ key, ttl: 7 * 24 * 60 * 60 });
    expect(await readDraftBuffer(kv, key)).toEqual(draft);
  });

  it("honors a custom TTL", async () => {
    const { kv, puts } = makeKV();
    await writeDraftBuffer(kv, "k", { data: { a: 1 }, updatedAt: 1, flushedAt: 1 }, 60);
    expect(puts[0].ttl).toBe(60);
  });

  it("returns null for a missing key and for corrupt JSON", async () => {
    const { kv, store } = makeKV();
    expect(await readDraftBuffer(kv, "absent")).toBeNull();
    store.set("bad", "{ not json");
    expect(await readDraftBuffer(kv, "bad")).toBeNull();
    store.set("empty", "null");
    expect(await readDraftBuffer(kv, "empty")).toBeNull(); // parses, but no `.data`
  });

  it("clears a buffer", async () => {
    const { kv, store } = makeKV();
    const key = draftBufferKey("pages", 2);
    await writeDraftBuffer(kv, key, { data: { a: 1 }, updatedAt: 1, flushedAt: 1 });
    expect(store.has(key)).toBe(true);
    await clearDraftBuffer(kv, key);
    expect(store.has(key)).toBe(false);
  });
});
