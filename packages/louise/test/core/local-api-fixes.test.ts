import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it } from "vitest";
import {
  collectionVersionsTable,
  createVersionedLocalApi,
  defineCollection,
} from "../../src/core/content/index.js";
import { toPageId, toVersionId } from "../../src/core/content/ids.js";

// #697: publish works on the sqlite-proxy driver without a batch callback, a
// draft accepts nested group data and a publish returns it nested, and
// diffVersions refuses versions of two different pages.

/** A Drizzle database over `node:sqlite`, through the proxy driver, with no
 *  batch callback: the case where `db.batch` exists but can't run. */
function proxyDb(ddl: string) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(ddl);
  const orm = drizzle(async (query, params, method) => {
    const statement = sqlite.prepare(query);
    const args = params as SQLInputValue[];
    if (method === "run") {
      statement.run(...args);
      return { rows: [] };
    }
    statement.setReturnArrays(true);
    if (method === "get") return { rows: (statement.get(...args) ?? []) as unknown[] };
    return { rows: statement.all(...args) as unknown[] };
  });
  return { sqlite, orm };
}

const VERSIONS_DDL = `CREATE TABLE pages_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL,
  version_data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER,
  scheduled_at INTEGER)`;

const config = defineCollection({
  slug: "pages",
  fields: {
    title: { type: "text" },
    seo: { type: "group", fields: { title: { type: "text" } } },
  },
  versions: { drafts: true },
});
const pages = sqliteTable("pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title"),
  seo_title: text("seo_title"),
  publishedVersionId: integer("published_version_id"),
});

function setup() {
  const { sqlite, orm } = proxyDb(`CREATE TABLE pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, seo_title TEXT,
      published_version_id INTEGER);
    ${VERSIONS_DDL};
    INSERT INTO pages (title) VALUES ('About'), ('Contact');`);
  const api = createVersionedLocalApi(orm, pages, collectionVersionsTable(config), config);
  return { sqlite, api };
}

describe("publishing on the sqlite-proxy driver", () => {
  it("falls back to sequential writes when there's no batch callback", async () => {
    const { sqlite, api } = setup();
    const draft = await api.saveDraft({}, toPageId(1), { title: "About us" });
    await api.publish({}, toVersionId(draft.id as number));
    expect(
      sqlite.prepare("SELECT title, published_version_id FROM pages WHERE id = 1").get(),
    ).toEqual({
      title: "About us",
      published_version_id: draft.id,
    });
  });
});

describe("group fields in drafts", () => {
  it("accepts nested group data, stores it flat, and publishes it nested", async () => {
    const { sqlite, api } = setup();
    const draft = await api.saveDraft({}, toPageId(1), {
      title: "About us",
      seo: { title: "About Example Organization" },
    } as never);
    const page = (await api.publish({}, toVersionId(draft.id as number))) as Record<
      string,
      unknown
    >;
    expect(page.seo).toEqual({ title: "About Example Organization" });
    expect(page).not.toHaveProperty("seo_title");
    expect(sqlite.prepare("SELECT seo_title FROM pages WHERE id = 1").get()).toEqual({
      seo_title: "About Example Organization",
    });
  });

  it("still takes a flat snapshot, and still refuses an unknown field", async () => {
    const { api } = setup();
    await expect(
      api.saveDraft({}, toPageId(1), { title: "x", seo_title: "y" } as never),
    ).resolves.toBeDefined();
    await expect(api.saveDraft({}, toPageId(1), { nope: 1 } as never)).rejects.toThrow("nope");
  });
});

describe("diffVersions", () => {
  it("refuses two versions of different pages", async () => {
    const { api } = setup();
    const a = await api.saveDraft({}, toPageId(1), { title: "A" });
    const b = await api.saveDraft({}, toPageId(2), { title: "B" });
    await expect(
      api.diffVersions({}, toVersionId(a.id as number), toVersionId(b.id as number)),
    ).rejects.toThrow("belong to different pages");
  });
});
