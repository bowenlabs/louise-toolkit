// The Local API finds, updates, and deletes rows by an `id` column, and a table
// from `collectionToTable` has one only when the collection declares it. These
// cover the error that says so where the API is built, instead of a SQL error
// on the first by-ID call.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  collectionToTable,
  collectionVersionsTable,
  createLocalApi,
  createVersionedLocalApi,
  defineCollection,
  reindexDoc,
} from "../../src/core/content/index.js";
import { LouiseContentError } from "../../src/core/errors.js";

/** A Drizzle database over an in-memory `node:sqlite`, through the proxy driver. */
function memoryDb(ddl: string) {
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

const withoutId = defineCollection({
  slug: "notes",
  fields: { title: { type: "text", required: true } },
});

const withId = defineCollection({
  slug: "notes",
  fields: {
    id: { type: "number", autoIncrement: true },
    title: { type: "text", required: true },
  },
});

function expectMissingId(build: () => unknown, pattern: RegExp): void {
  let thrown: unknown;
  try {
    build();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LouiseContentError);
  expect((thrown as Error).message).toMatch(pattern);
}

describe("a Local API table without an id column", () => {
  const { orm } = memoryDb("CREATE TABLE notes (title TEXT NOT NULL)");

  it("fails createLocalApi and says which field to add", () => {
    expectMissingId(
      () => createLocalApi(orm, collectionToTable(withoutId), withoutId),
      /Collection "notes" .*no "id" column.*id: \{ type: "number", autoIncrement: true \}/,
    );
  });

  it("fails createVersionedLocalApi the same way", () => {
    const drafts = { ...withoutId, versions: { drafts: true } };
    expectMissingId(
      () =>
        createVersionedLocalApi(
          orm,
          collectionToTable(drafts),
          collectionVersionsTable(drafts),
          drafts,
        ),
      /Collection "notes" .*no "id" column/,
    );
  });

  it("names an autoIncrement field that has another key", () => {
    const misnamed = defineCollection({
      slug: "notes",
      fields: {
        noteId: { type: "number", autoIncrement: true },
        title: { type: "text", required: true },
      },
    });
    expectMissingId(
      () => createLocalApi(orm, collectionToTable(misnamed), misnamed),
      /Rename its autoIncrement field "noteId" to "id"/,
    );
  });

  it("fails reindexDoc before it queries", async () => {
    const searchable = { ...withoutId, search: { fields: ["title"] } };
    const reindex = reindexDoc(orm, collectionToTable(searchable), searchable, 1);
    await expect(reindex).rejects.toBeInstanceOf(LouiseContentError);
    await expect(reindex).rejects.toThrow(/no "id" column/);
  });

  it("fails a depth: 1 read whose related collection's table has none", async () => {
    const authors = defineCollection({ slug: "authors", fields: { name: { type: "text" } } });
    const posts = defineCollection({
      slug: "posts",
      fields: {
        id: { type: "number", autoIncrement: true },
        author: { type: "relationship", relationTo: "authors" },
      },
    });
    const db = memoryDb(`
      CREATE TABLE authors (name TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author INTEGER);
      INSERT INTO posts (author) VALUES (1);
    `);
    const tables = { authors: collectionToTable(authors), posts: collectionToTable(posts) };
    const api = createLocalApi(db.orm, tables.posts, posts, {
      tables,
      configs: { authors, posts },
    });
    await expect(api.find({}, { depth: 1 })).rejects.toThrow(
      /Collection "authors" .*no "id" column/,
    );
  });
});

describe("a Local API table with an id column", () => {
  it("works when the collection declares the field the error asks for", async () => {
    const { orm } = memoryDb(
      "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL)",
    );
    const api = createLocalApi(orm, collectionToTable(withId), withId);
    // A table built at runtime types its columns loosely, so `id` comes back `unknown`.
    const id = (await api.create({}, { title: "First" })).id as number;
    expect(await api.findByID({}, id)).toMatchObject({ title: "First" });
    expect(await api.update({}, id, { title: "Second" })).toMatchObject({ title: "Second" });
    await api.deleteByID({}, id);
    expect(await api.count({})).toBe(0);
  });

  it("works with a hand-written table that has one, whatever the fields say", () => {
    const table = sqliteTable("notes", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      title: text("title").notNull(),
    });
    const { orm } = memoryDb("CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT)");
    expect(() => createLocalApi(orm, table, withoutId)).not.toThrow();
  });
});
