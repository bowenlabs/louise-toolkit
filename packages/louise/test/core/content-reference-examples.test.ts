// The code samples on the docs site's `content` reference page, as real code. The
// type check compiles them with the rest of the tests, the tests below run them
// against an in-memory SQLite database, and the last test fails when a sample on
// the page drifts from its `#region` here. A sample that only lives in Markdown
// once called every Local API method with its arguments in the wrong order (#536).
//
// To change a sample, edit its region here, then paste the region into the page.
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { gte } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import {
  collectionVersionsTable,
  createLocalApi,
  createVersionedLocalApi,
  defineCollection,
  defineContentConfig,
  type JsonValue,
} from "../../src/core/content/index.js";
import { db } from "../../src/core/db/index.js";
import { LouiseAccessDeniedError } from "../../src/core/errors.js";

// #region define-collection
export interface Context {
  session: EditorSession | null;
}

export const artworks = defineCollection({
  slug: "artworks",
  fields: {
    title: { type: "text", required: true, validation: (r) => r.required().min(2) },
    slug: { type: "text", required: true, validation: (r) => r.slug().unique() },
    year: { type: "number", validation: (r) => r.integer().positive() },
    body: { type: "richText" },
  },
  // The Local API passes its `context` argument to these. No function means allowed.
  access: {
    create: ({ session }: Context) => session !== null,
    update: ({ session }: Context) => session !== null,
    publish: ({ session }: Context) => session?.role === "owner",
  },
  // Adds draft history, for createVersionedLocalApi.
  versions: { drafts: true },
});

export const content = defineContentConfig({ collections: [artworks] });
// #endregion

// The Drizzle tables a site keeps in its schema file for `artworks`.
const schema = {
  artworks: sqliteTable("artworks", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    year: real("year"),
    body: text("body", { mode: "json" }).$type<JsonValue>(),
    publishedVersionId: integer("published_version_id"),
  }),
  artworksVersions: collectionVersionsTable(artworks),
};

async function localApiExample(env: { DB: D1Database }, session: EditorSession | null) {
  // #region local-api
  const orm = db(env.DB);
  const context: Context = { session };

  // Every method takes the context first, then its own arguments.
  const api = createLocalApi<typeof schema.artworks, Context>(orm, schema.artworks, artworks);
  const artwork = await api.create(context, { title: "Untitled", slug: "untitled", year: 2026 });
  const recent = await api.find(context, { where: gte(schema.artworks.year, 2020), limit: 10 });
  await api.update(context, artwork.id, { title: "Still life" });

  // The same methods, plus drafts, for a collection with `versions: { drafts: true }`.
  // A draft holds the whole document, and publishing validates all of it.
  const versioned = createVersionedLocalApi<
    typeof schema.artworks,
    typeof schema.artworksVersions,
    Context
  >(orm, schema.artworks, schema.artworksVersions, artworks);
  const snapshot = { title: "Still life, revised", slug: "still-life", year: 2026 };
  const draft = await versioned.saveDraft(context, artwork.id, snapshot);
  const live = await versioned.publish(context, draft.id);
  // #endregion
  return { artwork, recent, draft, live };
}

/**
 * A D1 binding over `node:sqlite`, enough of one for drizzle's D1 driver: bound
 * statements with `all`, `raw`, `run`, and `first`, plus `batch`, which the
 * versioned Local API uses to publish atomically.
 */
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
  const d1 = {
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
  };
  return d1 as unknown as D1Database;
}

function freshDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE artworks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      year REAL,
      body TEXT,
      published_version_id INTEGER
    );
    CREATE TABLE artworks_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER NOT NULL,
      version_data TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER,
      scheduled_at INTEGER
    );
  `);
  return { sqlite, env: { DB: sqliteD1(sqlite) } };
}

const owner: EditorSession = {
  userId: "1",
  email: "alex@example.com",
  name: "Alex",
  role: "owner",
};

describe("the content reference page's samples", () => {
  it("defines a collection the content config accepts", () => {
    expect(content.collections.map((collection) => collection.slug)).toEqual(["artworks"]);
  });

  it("runs the Local API sample end to end", async () => {
    const { sqlite, env } = freshDatabase();
    const { artwork, recent, draft, live } = await localApiExample(env, owner);

    expect(artwork).toMatchObject({ title: "Untitled", slug: "untitled", year: 2026 });
    expect(recent.map((row) => row.id)).toEqual([artwork.id]);
    expect(draft).toMatchObject({ parentId: artwork.id, status: "draft" });
    expect(live).toMatchObject({
      title: "Still life, revised",
      slug: "still-life",
      publishedVersionId: draft.id,
    });
    expect(sqlite.prepare("SELECT status FROM artworks_versions").all()).toEqual([
      { status: "published" },
    ]);
  });

  it("passes the context to the collection's access functions", async () => {
    const { env } = freshDatabase();
    await expect(localApiExample(env, null)).rejects.toBeInstanceOf(LouiseAccessDeniedError);
  });

  it("matches the samples on the page, region for region", () => {
    const own = readFileSync(new URL(import.meta.url), "utf8");
    const page = readFileSync(
      new URL("../../../../workers/docs/src/content/docs/reference/content.md", import.meta.url),
      "utf8",
    );
    const blocks = [...page.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((match) => match[1]);
    for (const name of ["define-collection", "local-api"]) {
      const sample = region(own, name);
      const firstLine = sample.split("\n")[0];
      const block = blocks.find((candidate) => candidate.includes(firstLine));
      expect(block, `no code block on the page starts region "${name}"`).toBeDefined();
      expect(block).toContain(sample);
    }
  });
});

/** The lines between `#region name` and the next `#endregion`, dedented. */
function region(source: string, name: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `// #region ${name}`);
  const end = lines.findIndex((line, index) => index > start && line.trim() === "// #endregion");
  if (start === -1 || end === -1) throw new Error(`Region "${name}" isn't in this file`);
  const body = lines.slice(start + 1, end);
  const indent = Math.min(
    ...body.filter((line) => line.trim() !== "").map((line) => line.search(/\S/)),
  );
  return body.map((line) => line.slice(indent)).join("\n");
}
