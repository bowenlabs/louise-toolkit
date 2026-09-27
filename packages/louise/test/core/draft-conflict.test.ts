import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import {
  collectionVersionsTable,
  defineCollection,
  toPageId,
} from "../../src/core/content/index.js";
import {
  applySaveDraft,
  DRAFT_BASE_KEY,
  type DraftBufferKV,
  draftBufferKey,
  fieldRev,
  parseDraftBase,
  readDraftBuffer,
  versionsRoute,
  writeDraftBuffer,
} from "../../src/core/editor/index.js";
import { sanitizeRichHtml } from "../../src/core/security/sanitize.js";

// The optimistic check on a draft save (#572), driven through the buffered path
// every client site takes: a KV buffer flushed a moment ago absorbs the save, and
// the only D1 read is the live-row lookup, which the fake below answers.

const docs = sqliteTable("docs", {
  id: integer("id").primaryKey(),
  title: text("title"),
  body: text("body"),
});

const config = defineCollection({
  slug: "docs",
  fields: { title: { type: "text" }, body: { type: "richText" } },
  versions: { drafts: true },
  hooks: {
    beforeChange: [
      ({ data }) =>
        typeof data.body === "string" ? { ...data, body: sanitizeRichHtml(data.body) } : data,
    ],
  },
});
const versionsTable = collectionVersionsTable(config);
const editor: EditorSession = { userId: "u1", email: "e@example.com", name: "Ed", role: "admin" };
const LIVE_ROW = [1, "Live title", "<p>Live</p>"];
const fakeD1 = {
  prepare: () => ({
    bind: () => ({
      raw: async () => [LIVE_ROW],
      all: async () => ({ results: [LIVE_ROW] }),
    }),
    raw: async () => [LIVE_ROW],
    all: async () => ({ results: [LIVE_ROW] }),
  }),
} as unknown as D1Database;

function memoryKv(): DraftBufferKV {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/** A buffer flushed a moment ago holding `data`, so the next save stays in KV. */
async function bufferWith(data: Record<string, unknown>): Promise<DraftBufferKV> {
  const kv = memoryKv();
  const now = Date.now();
  await writeDraftBuffer(kv, draftBufferKey("docs", 1), { data, updatedAt: now, flushedAt: now });
  return kv;
}

const save = (kv: DraftBufferKV, input: Record<string, unknown>, base?: Record<string, string>) =>
  applySaveDraft(
    { DB: fakeD1 },
    { table: docs, versionsTable, config, bufferKv: () => kv },
    editor,
    toPageId(1),
    input,
    { base },
  );

describe("fieldRev", () => {
  it("is stable for equal values and differs for different ones", async () => {
    expect(await fieldRev("<p>A</p>")).toBe(await fieldRev("<p>A</p>"));
    expect(await fieldRev("<p>A</p>")).not.toBe(await fieldRev("<p>B</p>"));
    expect(await fieldRev({ a: 1, b: [2] })).toBe(await fieldRev(JSON.parse('{"a":1,"b":[2]}')));
  });

  it("treats undefined as null", async () => {
    expect(await fieldRev(undefined)).toBe(await fieldRev(null));
  });

  it("is 16 hex characters", async () => {
    expect(await fieldRev("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("parseDraftBase", () => {
  it("keeps string revisions and drops everything else", () => {
    expect(parseDraftBase({ title: "abc", body: 5, x: null })).toEqual({ title: "abc" });
    expect(parseDraftBase(["abc"])).toBeUndefined();
    expect(parseDraftBase("abc")).toBeUndefined();
    expect(parseDraftBase(undefined)).toBeUndefined();
  });
});

describe("applySaveDraft—the base check", () => {
  it("returns the revisions of the stored values of the fields it saved", async () => {
    const kv = await bufferWith({ title: "Live title", body: "<p>Live</p>" });
    const hostile = "<p>Hi<script>alert(1)</script></p>";
    const result = await save(kv, { body: hostile });
    if (!result.ok) throw new Error(result.error);
    // The revision is of what was stored after the hooks, not of the raw input.
    expect(result.body.revs).toEqual({ body: await fieldRev(sanitizeRichHtml(hostile)) });
  });

  it("saves when the base matches the stored value", async () => {
    const kv = await bufferWith({ title: "Live title", body: "<p>Live</p>" });
    const result = await save(kv, { title: "New" }, { title: await fieldRev("Live title") });
    expect(result).toMatchObject({ ok: true, body: { buffered: true } });
  });

  it("answers 409 with the current value when someone else changed the field", async () => {
    const kv = await bufferWith({ title: "Their title", body: "<p>Live</p>" });
    const result = await save(kv, { title: "My title" }, { title: await fieldRev("Live title") });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      conflicts: [{ field: "title", value: "Their title", rev: await fieldRev("Their title") }],
    });
    // Nothing was written: their value is still there.
    const buffered = await readDraftBuffer(kv, draftBufferKey("docs", 1));
    expect(buffered?.data.title).toBe("Their title");
  });

  it("isn't a conflict when both ended up at the same value", async () => {
    const kv = await bufferWith({ title: "Same", body: "<p>Live</p>" });
    const result = await save(kv, { title: "Same" }, { title: await fieldRev("Live title") });
    expect(result.ok).toBe(true);
  });

  it("doesn't check a field the save doesn't set, so a partial save still layers on", async () => {
    const kv = await bufferWith({ title: "Their title", body: "<p>Live</p>" });
    const result = await save(
      kv,
      { body: "<p>Mine</p>" },
      { title: await fieldRev("Live title"), body: await fieldRev("<p>Live</p>") },
    );
    expect(result.ok).toBe(true);
    const buffered = await readDraftBuffer(kv, draftBufferKey("docs", 1));
    expect(buffered?.data).toMatchObject({ title: "Their title", body: "<p>Mine</p>" });
  });

  it("doesn't check a field the base has no revision for", async () => {
    const kv = await bufferWith({ title: "Their title", body: "<p>Live</p>" });
    expect((await save(kv, { title: "Mine" }, {})).ok).toBe(true);
    expect((await save(kv, { title: "Mine again" })).ok).toBe(true);
  });

  it("keeps the owner's edit when they resend against the conflict's revision", async () => {
    const kv = await bufferWith({ title: "Their title", body: "<p>Live</p>" });
    const first = await save(kv, { title: "Mine" }, { title: await fieldRev("Live title") });
    const conflict = (first as { conflicts: { rev: string }[] }).conflicts[0]!;
    const second = await save(kv, { title: "Mine" }, { title: conflict.rev });
    expect(second.ok).toBe(true);
    const buffered = await readDraftBuffer(kv, draftBufferKey("docs", 1));
    expect(buffered?.data.title).toBe("Mine");
  });
});

describe("versionsRoute—a draft save with $base", () => {
  const route = (kv: DraftBufferKV) =>
    versionsRoute({
      table: docs,
      versionsTable,
      config,
      resolveEditor: () => editor,
      bufferKv: () => kv,
    });
  const post = (body: unknown) =>
    new Request("https://site.example/api/louise/pages/1/versions", {
      method: "POST",
      headers: { origin: "https://site.example", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const ctx = {} as ExecutionContext;

  it("answers 409 with the conflicts", async () => {
    const kv = await bufferWith({ title: "Their title", body: "<p>Live</p>" });
    const res = await route(kv)(
      post({ title: "Mine", [DRAFT_BASE_KEY]: { title: await fieldRev("Live title") } }),
      { DB: fakeD1 },
      ctx,
    );
    expect(res?.status).toBe(409);
    expect(await res?.json()).toMatchObject({
      conflicts: [{ field: "title", value: "Their title" }],
    });
  });

  it("never stores $base as a field", async () => {
    const kv = await bufferWith({ title: "Live title", body: "<p>Live</p>" });
    const res = await route(kv)(
      post({ title: "Mine", [DRAFT_BASE_KEY]: { title: await fieldRev("Live title") } }),
      { DB: fakeD1 },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({ revs: { title: await fieldRev("Mine") } });
    const buffered = await readDraftBuffer(kv, draftBufferKey("docs", 1));
    expect(buffered?.data).not.toHaveProperty(DRAFT_BASE_KEY);
  });
});
