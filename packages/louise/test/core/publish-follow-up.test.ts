import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectionVersionsTable,
  createVersionedLocalApi,
  defineCollection,
  type DeferReindex,
} from "../../src/core/content/index.js";
import { toPageId, toVersionId } from "../../src/core/content/ids.js";
import { DEGRADED_LOG_PREFIX } from "../../src/core/degraded.js";

// #531: a publish's follow-up work (a deferred reindex, which a site may use to
// start a Workflow) runs after the publish batch commits. It learns which
// version went live, so it can key the follow-up per publish, and a failure
// there is reported as a degrade rather than as a failed publish.

/** A D1 binding over `node:sqlite`, enough of one for drizzle's D1 driver. */
function sqliteD1(sqlite: DatabaseSync): D1Database {
  const bind = (sql: string, params: SQLInputValue[]) => ({
    all: async () => ({ results: sqlite.prepare(sql).all(...params), success: true, meta: {} }),
    raw: async () => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      return statement.all(...params);
    },
    run: async () => {
      const { changes } = sqlite.prepare(sql).run(...params);
      return { results: [], success: true, meta: { changes: Number(changes) } };
    },
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
  });
  return {
    prepare: (sql: string) => ({
      ...bind(sql, []),
      bind: (...params: SQLInputValue[]) => bind(sql, params),
    }),
    batch: async (statements: ReturnType<typeof bind>[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

const docs = sqliteTable("docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  publishedVersionId: integer("published_version_id"),
});
const config = defineCollection({
  slug: "docs",
  fields: { title: { type: "text" } },
  versions: { drafts: true },
  search: { fields: ["title"] },
});
const versionsTable = collectionVersionsTable(config);

function fresh(deferReindex: DeferReindex) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', published_version_id INTEGER);
    CREATE TABLE docs_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL,
      version_data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER,
      scheduled_at INTEGER);
    INSERT INTO docs (title) VALUES ('About');
  `);
  const api = createVersionedLocalApi(
    drizzle(sqliteD1(sqlite)),
    docs,
    versionsTable,
    config,
    undefined,
    { deferReindex },
  );
  const row = () => sqlite.prepare("SELECT * FROM docs WHERE id = 1").get() as Record<string, unknown>;
  return { api, row };
}

afterEach(() => vi.restoreAllMocks());

describe("a publish's follow-up work", () => {
  it("hands the deferred reindex the version that went live", async () => {
    const deferReindex = vi.fn<DeferReindex>();
    const { api } = fresh(deferReindex);
    const first = await api.saveDraft({}, toPageId(1), { title: "About us" });
    await api.publish({}, toVersionId(first.id as number));
    const second = await api.saveDraft({}, toPageId(1), { title: "About Example Organization" });
    await api.publish({}, toVersionId(second.id as number));

    const publishes = deferReindex.mock.calls.filter(([, info]) => info?.versionId !== undefined);
    expect(publishes).toEqual([
      [1, { versionId: first.id }],
      [1, { versionId: second.id }],
    ]);
  });

  it("reports a follow-up failure after the commit instead of failing the publish", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deferReindex = vi.fn<DeferReindex>(async (_id, info) => {
      if (info?.versionId !== undefined) throw new Error("Workflow instance already exists");
    });
    const { api, row } = fresh(deferReindex);
    const draft = await api.saveDraft({}, toPageId(1), { title: "About us" });

    const page = await api.publish({}, toVersionId(draft.id as number));

    expect(page).toMatchObject({ title: "About us", status: "published" });
    expect(row()).toMatchObject({ status: "published", published_version_id: draft.id });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(`${DEGRADED_LOG_PREFIX} content.publish.reindex`),
    );
  });
});
