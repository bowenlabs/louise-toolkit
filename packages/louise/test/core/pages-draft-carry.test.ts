import { getTableConfig, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { collectionVersionsTable, defineCollection } from "../../src/core/content/index.js";
import { onDegraded } from "../../src/core/degraded.js";
import {
  type DraftBufferKV,
  draftBufferKey,
  pagesRoute,
  readDraftBuffer,
  writeDraftBuffer,
} from "../../src/core/editor/index.js";
import { LouiseValidationError } from "../../src/core/errors.js";

// A Pages panel update writes the live row, and publish copies the whole draft
// snapshot onto that row. So an update made while a draft is pending has to
// land in the draft too, or the next publish undoes it (#530).

const docs = sqliteTable("docs", {
  id: integer("id").primaryKey(),
  title: text("title"),
  body: text("body"),
  status: text("status"),
});
const config = defineCollection({
  slug: "docs",
  fields: { title: { type: "text" }, body: { type: "text" } },
  versions: { drafts: true },
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (data.title === "Refused") {
          throw new LouiseValidationError("Bad title", [
            { path: "title", message: "Bad", severity: "error" },
          ]);
        }
        return data;
      },
    ],
  },
});
const versionsTable = collectionVersionsTable(config);
const editor: EditorSession = { userId: "u1", email: "e@example.com", name: "Alex", role: "admin" };

/** A D1 whose `docs` reads and writes answer `row`, and whose version table is empty. */
function fakeD1(row: unknown[]) {
  const answer = (sql: string) => (sql.includes("docs_versions") ? [] : [row]);
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        raw: async () => answer(sql),
        all: async () => ({ results: answer(sql) }),
        run: async () => ({ success: true }),
      }),
      raw: async () => answer(sql),
      all: async () => ({ results: answer(sql) }),
      run: async () => ({ success: true }),
    }),
  } as unknown as D1Database;
}

function memoryKv(): DraftBufferKV {
  const store = new Map<string, string>();
  return {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
  };
}

const route = (kv: DraftBufferKV) =>
  pagesRoute({
    table: docs,
    resolveEditor: () => editor,
    fields: ["title", "body", "status"],
    versionsTable,
    drafts: { config, bufferKv: () => kv },
  });

const patch = (body: Record<string, unknown>) =>
  new Request("https://site.example/api/louise/pages/1", {
    method: "PATCH",
    headers: { origin: "https://site.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const ctx = {} as ExecutionContext;
const key = draftBufferKey("docs", 1);

describe("pagesRoute—an update carried into the pending draft", () => {
  let stopListening: (() => void) | undefined;
  afterEach(() => {
    stopListening?.();
    vi.restoreAllMocks();
  });

  it("saves a rename into the pending draft, keeping the draft's other edits", async () => {
    const kv = memoryKv();
    const now = Date.now();
    await writeDraftBuffer(kv, key, {
      data: { title: "Old title", body: "<p>Draft body</p>" },
      updatedAt: now,
      flushedAt: now,
    });
    const res = await route(kv)(
      patch({ title: "Renamed" }),
      { DB: fakeD1([1, "Renamed", "<p>Live</p>", "published"]) },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect((await readDraftBuffer(kv, key))?.data).toEqual({
      title: "Renamed",
      body: "<p>Draft body</p>",
    });
  });

  it("doesn't start a draft for a page with no pending work", async () => {
    const kv = memoryKv();
    const res = await route(kv)(
      patch({ title: "Renamed" }),
      { DB: fakeD1([1, "Renamed", "<p>Live</p>", "published"]) },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect(await readDraftBuffer(kv, key)).toBeNull();
  });

  it("leaves the draft alone for a field its snapshot doesn't hold", async () => {
    const kv = memoryKv();
    const now = Date.now();
    const data = { title: "Old title", body: "<p>Draft body</p>" };
    await writeDraftBuffer(kv, key, { data, updatedAt: now, flushedAt: now });
    await route(kv)(
      patch({ status: "draft" }),
      { DB: fakeD1([1, "Old title", "<p>Live</p>", "draft"]) },
      ctx,
    );
    expect(await readDraftBuffer(kv, key)).toMatchObject({ data, updatedAt: now });
  });

  it("keeps the live write and reports it when the draft refuses the change", async () => {
    const events: string[] = [];
    stopListening = onDegraded((event) => events.push(event.name));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const kv = memoryKv();
    const now = Date.now();
    await writeDraftBuffer(kv, key, {
      data: { title: "Old title", body: "<p>Draft body</p>" },
      updatedAt: now,
      flushedAt: now,
    });
    const res = await route(kv)(
      patch({ title: "Refused" }),
      { DB: fakeD1([1, "Refused", "<p>Live</p>", "published"]) },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect(events).toContain("editor.pages.draftCarry");
  });

  it("saves a new draft version over a pending draft in D1, with no buffer", async () => {
    // A pending draft row, positional as drizzle reads it.
    const draftRow = getTableConfig(versionsTable).columns.map((c) =>
      c.name === "id"
        ? 7
        : c.name === "parent_id"
          ? 1
          : c.name === "version_data"
            ? JSON.stringify({ title: "Old title", body: "<p>Draft body</p>" })
            : c.name === "status"
              ? "draft"
              : null,
    );
    const inserts: unknown[][] = [];
    const answer = (sql: string, binds: unknown[]) => {
      if (sql.startsWith('insert into "docs_versions"')) {
        inserts.push(binds);
        return [draftRow];
      }
      return sql.includes("docs_versions") ? [draftRow] : [[1, "Renamed", "<p>Live</p>", "x"]];
    };
    const db = {
      prepare: (sql: string) => {
        const stmt = (binds: unknown[]) => ({
          raw: async () => answer(sql, binds),
          all: async () => ({ results: answer(sql, binds) }),
          run: async () => ({ success: true }),
        });
        return { bind: (...binds: unknown[]) => stmt(binds), ...stmt([]) };
      },
    } as unknown as D1Database;
    const res = await pagesRoute({
      table: docs,
      resolveEditor: () => editor,
      fields: ["title", "body", "status"],
      versionsTable,
      drafts: { config },
    })(patch({ title: "Renamed" }), { DB: db }, ctx);
    expect(res?.status).toBe(200);
    expect(inserts).toHaveLength(1);
    const snapshot = inserts[0]!.find((b) => typeof b === "string" && b.startsWith("{"));
    expect(JSON.parse(snapshot as string)).toEqual({ title: "Renamed", body: "<p>Draft body</p>" });
  });

  it("needs versionsTable", () => {
    expect(() =>
      pagesRoute({ table: docs, resolveEditor: () => editor, drafts: { config } }),
    ).toThrow("`drafts` needs `versionsTable`");
  });
});
