import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { collectionVersionsTable, defineCollection } from "../../src/core/content/index.js";
import {
  applySaveDraft,
  type DraftBufferKV,
  draftBufferKey,
  readDraftBuffer,
  resumeDraft,
  writeDraftBuffer,
} from "../../src/core/editor/index.js";
import { LouiseAccessDeniedError } from "../../src/core/errors.js";
import { sanitizeRichHtml } from "../../src/core/security/sanitize.js";

// A buffered auto-save (a KV buffer exists and the flush interval hasn't
// passed) never reaches `api.saveDraft`, so it has to run the same access
// check and `beforeChange` hooks itself. These tests drive that path: the only
// D1 read it makes is the live-row lookup, which the fake below answers.

const docs = sqliteTable("docs", {
  id: integer("id").primaryKey(),
  title: text("title"),
  body: text("body"),
});

const makeConfig = (update?: () => boolean) =>
  defineCollection({
    slug: "docs",
    fields: { title: { type: "text" }, body: { type: "richText" } },
    versions: { drafts: true },
    hooks: {
      beforeChange: [
        ({ data }) =>
          typeof data.body === "string" ? { ...data, body: sanitizeRichHtml(data.body) } : data,
      ],
    },
    ...(update ? { access: { update } } : {}),
  });

const editor: EditorSession = { userId: "u1", email: "e@example.com", name: "Ed", role: "admin" };
const LIVE_ROW = [1, "Live title", "<p>Live</p>"];

/** A D1 stand-in that answers every query with the live row. */
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

function memoryKv(): DraftBufferKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
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

/** A buffer flushed a moment ago, so the next save is absorbed by KV alone. */
async function seedFreshBuffer(kv: DraftBufferKV): Promise<void> {
  const now = Date.now();
  await writeDraftBuffer(kv, draftBufferKey("docs", 1), {
    data: { title: "Live title", body: "<p>Live</p>" },
    updatedAt: now,
    flushedAt: now,
  });
}

const HOSTILE = '<p>Hi<img src="x" onerror="alert(1)"><script>alert(2)</script></p>';

describe("applySaveDraft—a buffered save", () => {
  it("runs the collection's beforeChange hooks before writing KV", async () => {
    const kv = memoryKv();
    await seedFreshBuffer(kv);
    const config = makeConfig();

    const result = await applySaveDraft(
      { DB: fakeD1 },
      { table: docs, versionsTable: collectionVersionsTable(config), config, bufferKv: () => kv },
      editor,
      1,
      { body: HOSTILE },
    );

    expect(result).toMatchObject({ ok: true, status: 200, body: { buffered: true } });
    const buffered = await readDraftBuffer(kv, draftBufferKey("docs", 1));
    expect(buffered?.data.body).toBe(sanitizeRichHtml(HOSTILE));
    expect(buffered?.data.body).not.toMatch(/onerror|<script/i);
  });

  it("hands resumeDraft the sanitized snapshot, not the raw input", async () => {
    const kv = memoryKv();
    await seedFreshBuffer(kv);
    const config = makeConfig();
    const versionsTable = collectionVersionsTable(config);

    await applySaveDraft(
      { DB: fakeD1 },
      { table: docs, versionsTable, config, bufferKv: () => kv },
      editor,
      1,
      { body: HOSTILE },
    );
    const resumed = await resumeDraft(
      fakeD1,
      { collection: "docs", versionsTable, bufferKv: kv },
      { id: 1, publishedVersionId: null },
    );

    expect(resumed?.body).not.toMatch(/onerror|<script/i);
  });

  it("enforces the collection's update access", async () => {
    const kv = memoryKv();
    await seedFreshBuffer(kv);
    const config = makeConfig(() => false);

    await expect(
      applySaveDraft(
        { DB: fakeD1 },
        { table: docs, versionsTable: collectionVersionsTable(config), config, bufferKv: () => kv },
        editor,
        1,
        { title: "Changed" },
      ),
    ).rejects.toBeInstanceOf(LouiseAccessDeniedError);
    const buffered = await readDraftBuffer(kv, draftBufferKey("docs", 1));
    expect(buffered?.data.title).toBe("Live title");
  });

  it("never reads a buffer written under the old, unversioned key", async () => {
    const kv = memoryKv();
    kv.store.set(
      "draft:docs:1",
      JSON.stringify({ data: { body: HOSTILE }, updatedAt: 1, flushedAt: 1 }),
    );
    const config = makeConfig();

    const resumed = await resumeDraft(
      fakeD1,
      { collection: "docs", versionsTable: collectionVersionsTable(config), bufferKv: kv },
      { id: 1, publishedVersionId: null },
    );

    expect(JSON.stringify(resumed ?? {})).not.toMatch(/onerror|<script/i);
  });
});
