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
  versionsRoute,
  writeDraftBuffer,
} from "../../src/core/editor/index.js";
import { LouiseAccessDeniedError, LouiseValidationError } from "../../src/core/errors.js";
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

// A write the collection rejects answers 422 whether or not a buffer is open.
// Before #529, a save that merged into an open buffer skipped `beforeChange`,
// answered `200 { buffered: true }`, and only failed at publish. These drive the
// route itself, with the body from that report.

const SECTION_TYPES = new Set(["hero", "text"]);

const pagesTable = sqliteTable("pages", {
  id: integer("id").primaryKey(),
  title: text("title"),
  sections: text("sections", { mode: "json" }),
});

const pagesConfig = defineCollection({
  slug: "pages",
  fields: { title: { type: "text" }, sections: { type: "json" } },
  versions: { drafts: true },
  hooks: {
    beforeChange: [
      ({ data }) => {
        const sections = Array.isArray(data.sections) ? data.sections : [];
        const bad = sections.findIndex(
          (section) => !SECTION_TYPES.has((section as { _type?: string })._type ?? ""),
        );
        if (bad >= 0) {
          throw new LouiseValidationError("Invalid sections", [
            { path: `sections.${bad}._type`, message: "Unknown section type", severity: "error" },
          ]);
        }
        return data;
      },
    ],
  },
});

const LIVE_PAGE = [1, "Live title", JSON.stringify([{ _type: "hero" }])];
const SEEDED = { title: "Live title", sections: [{ _type: "hero" }, { _type: "text" }] };

/** A D1 stand-in: the live row for the pages table, no versions yet. */
const pagesD1 = {
  prepare: (sql: string) => {
    const rows = sql.includes("pages_versions") ? [] : [LIVE_PAGE];
    const stmt = { raw: async () => rows, all: async () => ({ results: rows }) };
    return { ...stmt, bind: () => stmt };
  },
} as unknown as D1Database;

const postDraft = (body: unknown) =>
  new Request("https://site.example/api/louise/pages/1/versions", {
    method: "POST",
    headers: { origin: "https://site.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("versionsRoute—an invalid draft save", () => {
  it.each([
    { path: "merges into an open buffer", seeded: true },
    { path: "opens a new buffer", seeded: false },
  ])("answers 422 when the save $path", async ({ seeded }) => {
    const kv = memoryKv();
    const key = draftBufferKey("pages", 1);
    if (seeded) {
      const now = Date.now();
      await writeDraftBuffer(kv, key, { data: SEEDED, updatedAt: now, flushedAt: now });
    }
    const route = versionsRoute({
      table: pagesTable,
      versionsTable: collectionVersionsTable(pagesConfig),
      config: pagesConfig,
      resolveEditor: () => editor,
      bufferKv: () => kv,
    });

    const res = await route(
      postDraft({ sections: [{ _type: "notASection" }] }),
      { DB: pagesD1 },
      {} as ExecutionContext,
    );

    expect(res?.status).toBe(422);
    expect(await res?.json()).toMatchObject({
      violations: [{ path: "sections.0._type", message: "Unknown section type" }],
    });
    // The rejected write never reached the buffer.
    expect((await readDraftBuffer(kv, key))?.data ?? null).toEqual(seeded ? SEEDED : null);
  });

  it("answers 422 when the site's validate rejects a save that merges into an open buffer", async () => {
    const kv = memoryKv();
    const key = draftBufferKey("pages", 1);
    const now = Date.now();
    await writeDraftBuffer(kv, key, { data: SEEDED, updatedAt: now, flushedAt: now });

    const result = await applySaveDraft(
      { DB: pagesD1 },
      {
        table: pagesTable,
        versionsTable: collectionVersionsTable(pagesConfig),
        config: pagesConfig,
        bufferKv: () => kv,
        validate: (data) => {
          if (data.title === "") throw new Error("A page needs a title");
        },
      },
      editor,
      1,
      { title: "" },
    );

    expect(result).toMatchObject({ ok: false, status: 422, error: "A page needs a title" });
    expect((await readDraftBuffer(kv, key))?.data).toEqual(SEEDED);
  });
});
