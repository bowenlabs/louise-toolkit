import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import {
  collectionVersionsTable,
  createVersionedLocalApi,
  defineCollection,
  pageState,
  promotedHighWater,
  versionState,
} from "../../src/core/content/index.js";
import { toPageId, toVersionId } from "../../src/core/content/ids.js";
import { db } from "../../src/core/db/index.js";
import { pagesRoute, versionsRoute } from "../../src/core/editor/index.js";

// The page lifecycle (ADR 0021, #534): `status` is visibility and only publish
// and unpublish write it; the pointer is provenance and unpublish keeps it; a
// draft is superseded against the highest version ever promoted. Against real
// SQLite, because the batches and the high-water query are what's under test.

describe("the lifecycle rules", () => {
  const draft = (id: number, scheduledAt?: number) => ({ id, status: "draft", scheduledAt });
  const promoted = (id: number) => ({ id, status: "published" });

  it("reads a page as new, live, or hidden from its row", () => {
    expect(pageState({ status: "draft", publishedVersionId: null })).toBe("new");
    expect(pageState({ status: "published", publishedVersionId: 4 })).toBe("live");
    expect(pageState({ status: "draft", publishedVersionId: 4 })).toBe("hidden");
    // A table without a status column can't hide a row.
    expect(pageState({ publishedVersionId: 4 })).toBe("live");
    expect(pageState({ publishedVersionId: null })).toBe("new");
  });

  it("names each version's state against the high-water mark", () => {
    const versions = [draft(7, 1_900_000_000), draft(6), promoted(5), draft(4), promoted(2)];
    const high = promotedHighWater(versions);
    expect(high).toBe(5);
    // An explicit republish of 2 moved the pointer back; 4 stays superseded.
    const page = { status: "published", publishedVersionId: 2 };
    expect(versions.map((v) => versionState(v, page, high))).toEqual([
      "scheduled",
      "pending",
      "earlier",
      "superseded",
      "current",
    ]);
  });

  it("calls every draft pending when nothing has been promoted", () => {
    expect(promotedHighWater([draft(2), draft(1)])).toBeNull();
    expect(versionState(draft(1), { status: "draft", publishedVersionId: null }, null)).toBe(
      "pending",
    );
  });
});

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

const editor: EditorSession = { userId: "u1", email: "e@example.com", name: "Alex", role: "admin" };
const ctx = {} as ExecutionContext;

const docs = sqliteTable("docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  publishedVersionId: integer("published_version_id"),
});
const config = defineCollection({
  slug: "docs",
  fields: { slug: { type: "text" }, title: { type: "text" } },
  versions: { drafts: true },
});
const versionsTable = collectionVersionsTable(config);

function fresh(opts: { status?: boolean } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  const withStatus = opts.status ?? true;
  sqlite.exec(`
    CREATE TABLE docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, title TEXT NOT NULL,
      ${withStatus ? "status TEXT NOT NULL DEFAULT 'draft'," : ""}
      published_version_id INTEGER);
    CREATE TABLE docs_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL,
      version_data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER,
      scheduled_at INTEGER);
    INSERT INTO docs (slug, title) VALUES ('about', 'About');
  `);
  const DB = sqliteD1(sqlite);
  const table = withStatus
    ? docs
    : sqliteTable("docs", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        slug: text("slug").notNull(),
        title: text("title").notNull(),
        publishedVersionId: integer("published_version_id"),
      });
  const route = versionsRoute({ table, versionsTable, config, resolveEditor: () => editor });
  const call = async (path: string, method = "POST", body?: unknown) => {
    const res = await route(
      new Request(`https://site.example/api/louise/pages/1/${path}`, {
        method,
        headers: { origin: "https://site.example", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { DB },
      ctx,
    );
    if (!res) throw new Error(`no response for ${path}`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const row = () =>
    sqlite.prepare("SELECT * FROM docs WHERE id = 1").get() as Record<string, unknown>;
  const versionRows = () =>
    sqlite.prepare("SELECT id, status FROM docs_versions ORDER BY id").all() as {
      id: number;
      status: string;
    }[];
  const api = createVersionedLocalApi(db(DB), table, versionsTable, config);
  return { sqlite, call, row, versionRows, api };
}

const session = { session: editor };

describe("publish and unpublish own visibility", () => {
  it("makes a page live on publish, and hides it on unpublish keeping the pointer", async () => {
    const { call, row } = fresh();
    expect((await call("versions", "POST", { title: "About us" })).status).toBe(201);
    expect((await call("publish", "POST", {})).status).toBe(200);
    expect(row()).toMatchObject({
      status: "published",
      published_version_id: 1,
      title: "About us",
    });

    expect((await call("unpublish")).status).toBe(200);
    expect(row()).toMatchObject({ status: "draft", published_version_id: 1, title: "About us" });

    const history = await call("versions", "GET");
    expect(history.body.pageState).toBe("hidden");
    expect((history.body.versions as { id: number; state: string }[])[0]).toMatchObject({
      id: 1,
      state: "current",
    });
  });

  it("shows a hidden page again as it stands, keeping an edit made while hidden", async () => {
    const { call, row, sqlite } = fresh();
    await call("versions", "POST", { title: "About us" });
    await call("publish", "POST", {});
    await call("unpublish");
    // A Pages-panel rename while hidden writes the row, not a draft.
    sqlite.exec("UPDATE docs SET title = 'Renamed while hidden' WHERE id = 1");

    const again = await call("publish", "POST", {});
    expect(again.status).toBe(200);
    expect(row()).toMatchObject({ status: "published", title: "Renamed while hidden" });
  });

  it("publishes a never-published page with no draft as it stands", async () => {
    const { call, row, versionRows } = fresh();
    const res = await call("publish", "POST", {});
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ status: "published", title: "About", published_version_id: 1 });
    expect(versionRows()).toEqual([{ id: 1, status: "published" }]);
  });

  it("still says there's nothing to publish on a live page with no pending draft", async () => {
    const { call } = fresh();
    await call("publish", "POST", {});
    const res = await call("publish", "POST", {});
    expect(res).toEqual({ status: 400, body: { error: "No draft to publish" } });
  });

  it("refuses to unpublish a table with no status column", async () => {
    const { call } = fresh({ status: false });
    await call("publish", "POST", {});
    const res = await call("unpublish");
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toContain("no status column");
  });
});

describe("superseded drafts stay superseded", () => {
  it("doesn't bring a superseded draft back after an unpublish", async () => {
    const { call, row, versionRows } = fresh();
    await call("versions", "POST", { title: "Older draft" }); // 1
    await call("publish", "POST", { versionId: 1 });
    await call("versions", "POST", { title: "Abandoned" }); // 2
    await call("versions", "POST", { title: "Newer" }); // 3
    await call("publish", "POST", { versionId: 3 }); // 2 is now superseded
    await call("unpublish");

    // Before ADR 0021 the cleared pointer made draft 2 pending, and this
    // published it.
    expect((await call("publish", "POST", {})).status).toBe(200);
    expect(row()).toMatchObject({ status: "published", published_version_id: 3, title: "Newer" });
    expect(versionRows().find((v) => v.id === 2)?.status).toBe("draft");
    const states = (await call("versions", "GET")).body.versions as { id: number; state: string }[];
    expect(states.find((v) => v.id === 2)?.state).toBe("superseded");
  });

  it("builds the next save on the current work after a republish of an older version", async () => {
    const { call } = fresh();
    await call("versions", "POST", { title: "One" }); // 1
    await call("publish", "POST", { versionId: 1 });
    await call("versions", "POST", { title: "Stale" }); // 2
    await call("versions", "POST", { title: "Three" }); // 3
    await call("publish", "POST", { versionId: 3 });
    await call("publish", "POST", { versionId: 1 }); // the pointer moves back to 1

    const history = await call("versions", "GET");
    const states = history.body.versions as { id: number; state: string }[];
    expect(states.map((v) => [v.id, v.state])).toEqual([
      [3, "earlier"],
      [2, "superseded"],
      [1, "current"],
    ]);
  });

  it("skips a scheduled draft that a later publish superseded", async () => {
    const { api, row } = fresh();
    const page = toPageId(1);
    await api.scheduleDraft(session, page, { title: "Scheduled" }, new Date(1_000)); // 1
    const manual = (await api.saveDraft(session, page, { title: "Manual" })) as { id: number };
    await api.publish(session, toVersionId(manual.id)); // 2 supersedes 1

    expect(await api.publishScheduled(session, new Date(2_000))).toEqual([]);
    expect(row()).toMatchObject({ title: "Manual", published_version_id: 2 });
  });

  it("still promotes a due scheduled draft newer than anything published", async () => {
    const { api, row } = fresh();
    const page = toPageId(1);
    await api.scheduleDraft(session, page, { title: "Scheduled" }, new Date(1_000));
    const published = await api.publishScheduled(session, new Date(2_000));
    expect(published).toHaveLength(1);
    expect(row()).toMatchObject({ title: "Scheduled", status: "published" });
  });

  it("won't discard the current version, even while the page is hidden", async () => {
    const { api, call } = fresh();
    await call("publish", "POST", {});
    await call("unpublish");
    await expect(api.discardVersion(session, toVersionId(1))).rejects.toThrow(
      "publish another version first",
    );
  });
});

describe("pagesRoute leaves visibility to publish on a versioned page", () => {
  const pagesTable = docs;
  const route = (versioned: boolean) =>
    pagesRoute({
      table: pagesTable,
      resolveEditor: () => editor,
      fields: ["slug", "title", "status"],
      ...(versioned ? { versionsTable } : {}),
    });
  const patch = async (versioned: boolean, body: unknown) => {
    const { sqlite } = fresh();
    const DB = sqliteD1(sqlite);
    const res = await route(versioned)(
      new Request("https://site.example/api/louise/pages/1", {
        method: "PATCH",
        headers: { origin: "https://site.example", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { DB },
      ctx,
    );
    return { res, row: sqlite.prepare("SELECT status FROM docs WHERE id = 1").get() };
  };

  it("refuses status with a 422 when the page has drafts", async () => {
    const { res, row } = await patch(true, { status: "published" });
    expect(res?.status).toBe(422);
    expect(row).toEqual({ status: "draft" });
  });

  it("still writes status on a collection without drafts", async () => {
    const { res, row } = await patch(false, { status: "published" });
    expect(res?.status).toBe(200);
    expect(row).toEqual({ status: "published" });
  });
});
