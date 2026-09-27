import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";
import {
  collectionSearchTableSQL,
  collectionToTable,
  collectionVersionsTable,
  type CollectionConfig,
  type ContentRegistry,
  createLocalApi,
  createVersionedLocalApi,
  defineCollection,
  type DeferReindex,
  getRegisteredApi,
  type RelationshipDepth,
} from "../../src/core/content/index.js";
import { toPageId, toVersionId } from "../../src/core/content/ids.js";
import { LouiseAccessDeniedError, LouiseContentError } from "../../src/core/errors.js";

// The Local API's less-traveled paths (#508): access denial on every method,
// the errors a write wraps, `depth: 1` relationship resolution, lifecycle
// hooks, the search index kept inline or deferred, drivers without `batch`,
// and the draft and publish errors. Against real SQLite through drizzle's D1
// driver, so constraint errors and batches behave as they do on D1.

/** A D1 binding over `node:sqlite`, enough of one for drizzle's D1 driver. It
 *  logs each statement and counts batches, so a test can tell how a write ran. */
function sqliteD1(sqlite: DatabaseSync) {
  const log = { statements: [] as string[], batches: 0 };
  const bind = (sql: string, params: SQLInputValue[]) => ({
    all: async () => {
      log.statements.push(sql);
      return { results: sqlite.prepare(sql).all(...params), success: true, meta: {} };
    },
    raw: async () => {
      log.statements.push(sql);
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      return statement.all(...params);
    },
    run: async () => {
      log.statements.push(sql);
      const { changes } = sqlite.prepare(sql).run(...params);
      return { results: [], success: true, meta: { changes: Number(changes) } };
    },
    first: async () => {
      log.statements.push(sql);
      return sqlite.prepare(sql).get(...params) ?? null;
    },
  });
  const binding = {
    prepare: (sql: string) => ({
      ...bind(sql, []),
      bind: (...params: SQLInputValue[]) => bind(sql, params),
    }),
    batch: async (statements: ReturnType<typeof bind>[]) => {
      log.batches++;
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
  return { binding, log };
}

/** The same database with `batch` hidden, as on a driver that lacks it. */
function withoutBatch<T extends object>(db: T): T {
  return new Proxy(db, {
    get: (target, key, receiver) =>
      key === "batch" ? undefined : Reflect.get(target, key, receiver),
  });
}

function open(ddl: string, options: { batch?: boolean } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(ddl);
  const { binding, log } = sqliteD1(sqlite);
  const orm = drizzle(binding);
  const db = options.batch === false ? withoutBatch(orm) : orm;
  const rows = (query: string) => sqlite.prepare(query).all() as Record<string, unknown>[];
  return { sqlite, db, log, rows };
}

/** Awaits `promise` and returns what it rejected with, failing if it resolved. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the promise to reject");
}

type Ctx = { role: "admin" | "guest" };
const admin: Ctx = { role: "admin" };
const guest: Ctx = { role: "guest" };
const adminsOnly = (context: Ctx) => context.role === "admin";

// ---------------------------------------------------------------------------
// A plain, searchable collection

const notes = defineCollection({
  slug: "notes",
  fields: {
    id: { type: "number", autoIncrement: true },
    title: { type: "text", required: true },
    slug: { type: "text" },
    body: { type: "text" },
  },
  search: { fields: ["title", "body"] },
});
const notesTable = collectionToTable(notes);

// `slug` is unique and `body` has a check only in the DDL, so the database
// rather than the validation pass rejects a bad value.
const notesDDL = `
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT UNIQUE,
    body TEXT CHECK (body IS NULL OR body <> 'forbidden'));
  ${collectionSearchTableSQL(notes)}
`;

function notesApi(
  config: CollectionConfig = notes,
  options: { deferReindex?: DeferReindex; batch?: boolean } = {},
) {
  const h = open(notesDDL, { batch: options.batch });
  const api = createLocalApi<typeof notesTable, Ctx>(h.db, notesTable, config, undefined, {
    deferReindex: options.deferReindex,
  });
  const fts = () => h.rows("SELECT rowid, title, body FROM notes_fts ORDER BY rowid");
  return { ...h, api, fts };
}

describe("access denial", () => {
  const locked: CollectionConfig = {
    ...notes,
    versions: { drafts: true },
    access: {
      read: adminsOnly,
      create: adminsOnly,
      update: adminsOnly,
      delete: adminsOnly,
      publish: adminsOnly,
    },
  };
  const lockedTable = collectionToTable(locked);
  const versions = collectionVersionsTable(locked);

  function lockedApi() {
    const h = open(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT, body TEXT,
        published_version_id INTEGER);
      CREATE TABLE notes_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL,
        version_data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER,
        scheduled_at INTEGER);
      ${collectionSearchTableSQL(locked)}
      INSERT INTO notes (title) VALUES ('Welcome');
      INSERT INTO notes_versions (parent_id, version_data, status)
        VALUES (1, '{"title":"Welcome back"}', 'draft');
    `);
    const api = createVersionedLocalApi<typeof lockedTable, typeof versions, Ctx>(
      h.db,
      lockedTable,
      versions,
      locked,
    );
    return { ...h, api };
  }

  const page = toPageId(1);
  const version = toVersionId(1);
  const calls: Array<
    [string, string, (api: ReturnType<typeof lockedApi>["api"], ctx: Ctx) => Promise<unknown>]
  > = [
    ["find", "read", (api, ctx) => api.find(ctx)],
    ["findByID", "read", (api, ctx) => api.findByID(ctx, 1)],
    ["count", "read", (api, ctx) => api.count(ctx)],
    ["search", "read", (api, ctx) => api.search(ctx, "welcome")],
    ["reindexSearch", "read", (api, ctx) => api.reindexSearch(ctx)],
    ["create", "create", (api, ctx) => api.create(ctx, { title: "Hello" })],
    ["update", "update", (api, ctx) => api.update(ctx, 1, { title: "Hello" })],
    ["deleteByID", "delete", (api, ctx) => api.deleteByID(ctx, 1)],
    ["findVersions", "read", (api, ctx) => api.findVersions(ctx, page)],
    ["prepareDraft", "update", (api, ctx) => api.prepareDraft(ctx, { title: "Hello" })],
    ["saveDraft", "update", (api, ctx) => api.saveDraft(ctx, page, { title: "Hello" })],
    [
      "scheduleDraft",
      "update",
      (api, ctx) => api.scheduleDraft(ctx, page, { title: "Hello" }, new Date()),
    ],
    ["publish", "publish", (api, ctx) => api.publish(ctx, version)],
    ["publishScheduled", "publish", (api, ctx) => api.publishScheduled(ctx)],
    ["unpublish", "publish", (api, ctx) => api.unpublish(ctx, page)],
    ["republish", "publish", (api, ctx) => api.republish(ctx, page)],
    ["discardVersion", "update", (api, ctx) => api.discardVersion(ctx, version)],
    ["diffVersions", "read", (api, ctx) => api.diffVersions(ctx, version, version)],
  ];

  it.each(calls)("refuses %s before it touches the database", async (_name, operation, call) => {
    const { api, log, rows } = lockedApi();
    const error = await rejection(call(api, guest));
    expect(error).toBeInstanceOf(LouiseAccessDeniedError);
    expect(error.message).toBe(`Access denied for "${operation}" on collection "notes"`);
    expect(log.statements).toEqual([]);
    expect(rows("SELECT title FROM notes")).toEqual([{ title: "Welcome" }]);
    expect(rows("SELECT status FROM notes_versions")).toEqual([{ status: "draft" }]);
  });

  it("lets the same calls through for a context the access functions allow", async () => {
    const { api } = lockedApi();
    expect(await api.count(admin)).toBe(1);
    expect(await api.findVersions(admin, page)).toHaveLength(1);
    expect(await api.publish(admin, version)).toMatchObject({ title: "Welcome back" });
  });
});

describe("createLocalApi reads", () => {
  it("rejects a relationship depth other than 0 or 1", async () => {
    const { api } = notesApi();
    await api.create(admin, { title: "Hello" });
    const depth = 2 as RelationshipDepth;
    await expect(api.find(admin, { depth })).rejects.toThrow(
      'Relationship resolution depth 2 is not supported for collection "notes" (only 0 and 1 are)',
    );
    await expect(api.findByID(admin, 1, { depth })).rejects.toThrow(
      /depth 2 is not supported for collection "notes"/,
    );
  });

  it("runs beforeRead then afterRead on every row find and findByID return", async () => {
    const hooked: CollectionConfig = {
      ...notes,
      hooks: {
        beforeRead: [({ doc }) => ({ ...doc, title: String(doc.title).toUpperCase() })],
        // Run in the other order, the suffix would come out uppercase.
        afterRead: [async ({ doc }) => ({ ...doc, title: `${String(doc.title)} (read)` })],
      },
    };
    const { api, rows } = notesApi(hooked);
    await api.create(admin, { title: "Hello" });
    await api.create(admin, { title: "Goodbye" });

    expect((await api.find(admin)).map((doc) => doc.title)).toEqual([
      "HELLO (read)",
      "GOODBYE (read)",
    ]);
    expect(await api.findByID(admin, 2)).toMatchObject({ title: "GOODBYE (read)" });
    // Read hooks shape what a caller sees, never what's stored.
    expect(rows("SELECT title FROM notes")).toEqual([{ title: "Hello" }, { title: "Goodbye" }]);
  });

  it("counts only the rows that match where", async () => {
    const { api } = notesApi();
    await api.create(admin, { title: "Hello", slug: "hello" });
    await api.create(admin, { title: "Goodbye", slug: "goodbye" });
    expect(await api.count(admin)).toBe(2);
    expect(await api.count(admin, { where: eq(notesTable.slug, "hello") })).toBe(1);
  });
});

describe("createLocalApi writes", () => {
  it("rejects a create missing a required field, before it writes", async () => {
    const { api, rows } = notesApi();
    const error = await rejection(api.create(admin, { body: "No title" } as never));
    expect(error).toBeInstanceOf(LouiseContentError);
    expect(error.message).toBe('Missing required field "title" for collection "notes"');
    expect(rows("SELECT * FROM notes")).toEqual([]);
  });

  it("rejects a field the collection doesn't declare", async () => {
    const { api, rows } = notesApi();
    await expect(api.create(admin, { title: "Hello", color: "blue" } as never)).rejects.toThrow(
      'Unknown field "color" for collection "notes"',
    );
    const { id } = await api.create(admin, { title: "Hello" });
    await expect(api.update(admin, id as number, { color: "blue" } as never)).rejects.toThrow(
      'Unknown field "color" for collection "notes"',
    );
    expect(rows("SELECT title FROM notes")).toEqual([{ title: "Hello" }]);
  });

  it("names a unique violation the driver buried in the error's cause", async () => {
    const { api } = notesApi();
    await api.create(admin, { title: "Hello", slug: "hello" });
    const error = await rejection(api.create(admin, { title: "Hi", slug: "hello" }));
    expect(error).toBeInstanceOf(LouiseContentError);
    expect(error.message).toBe('Unique constraint violated for collection "notes"');
    // Drizzle's own error says "Failed query"; SQLite's text sits on its cause.
    const cause = (error as { cause?: Error }).cause;
    expect(cause?.message).toMatch(/^Failed query/);
    expect(cause?.message).not.toMatch(/UNIQUE constraint failed/);
    expect((cause as { cause?: Error }).cause?.message).toMatch(/UNIQUE constraint failed/);
  });

  it("names a unique violation on update the same way", async () => {
    const { api, rows } = notesApi();
    await api.create(admin, { title: "Hello", slug: "hello" });
    const { id } = await api.create(admin, { title: "Goodbye", slug: "goodbye" });
    await expect(api.update(admin, id as number, { slug: "hello" })).rejects.toThrow(
      'Unique constraint violated for collection "notes"',
    );
    expect(rows("SELECT slug FROM notes ORDER BY id")).toEqual([
      { slug: "hello" },
      { slug: "goodbye" },
    ]);
  });

  it("reports any other database failure as a failed write", async () => {
    const { api } = notesApi();
    const error = await rejection(api.create(admin, { title: "Hello", body: "forbidden" }));
    expect(error).toBeInstanceOf(LouiseContentError);
    expect(error.message).toBe('Write failed for collection "notes"');
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(Error);
  });

  it("reports an update or delete of a missing row as not found, not as a failed write", async () => {
    const { api } = notesApi();
    const update = await rejection(api.update(admin, 99, { title: "Hello" }));
    expect(update).toBeInstanceOf(LouiseContentError);
    expect(update.message).toBe('No "notes" document found with id 99');
    await expect(api.deleteByID(admin, 99)).rejects.toThrow('No "notes" document found with id 99');
  });

  it("runs afterChange after each write and the delete hooks around a delete", async () => {
    const events: unknown[] = [];
    let h: ReturnType<typeof notesApi> | undefined;
    const hooked: CollectionConfig = {
      ...notes,
      hooks: {
        afterChange: [
          ({ doc, operation }) => {
            events.push([operation, doc.title]);
          },
        ],
        beforeDelete: [
          ({ id }) => {
            // The row is still there when beforeDelete runs.
            events.push(["beforeDelete", id, h?.rows("SELECT id FROM notes").length]);
          },
        ],
        afterDelete: [
          async ({ id }) => {
            events.push(["afterDelete", id, h?.rows("SELECT id FROM notes").length]);
          },
        ],
      },
    };
    h = notesApi(hooked);
    const { id } = await h.api.create(admin, { title: "Hello" });
    await h.api.update(admin, id as number, { title: "Hello again" });
    const deleted = await h.api.deleteByID(admin, id as number);

    expect(deleted).toMatchObject({ id, title: "Hello again" });
    expect(events).toEqual([
      ["create", "Hello"],
      ["update", "Hello again"],
      ["beforeDelete", id, 1],
      ["afterDelete", id, 0],
    ]);
  });
});

describe("the search index", () => {
  it("follows each create, update, and delete inline", async () => {
    const { api, fts } = notesApi();
    const { id } = await api.create(admin, { title: "Hello", body: "Morning" });
    expect(fts()).toEqual([{ rowid: id, title: "Hello", body: "Morning" }]);
    expect((await api.search(admin, "morning")).map((doc) => doc.id)).toEqual([id]);

    await api.update(admin, id as number, { body: "Evening" });
    expect(fts()).toEqual([{ rowid: id, title: "Hello", body: "Evening" }]);
    expect(await api.search(admin, "morning")).toEqual([]);

    await api.deleteByID(admin, id as number);
    expect(fts()).toEqual([]);
  });

  it("hands each write's row id to deferReindex instead of touching the index", async () => {
    const deferReindex = vi.fn<DeferReindex>();
    const { api, fts } = notesApi(notes, { deferReindex });
    const { id } = await api.create(admin, { title: "Hello" });
    await api.update(admin, id as number, { title: "Hello again" });
    await api.deleteByID(admin, id as number);

    expect(deferReindex.mock.calls).toEqual([[id, undefined], [id, undefined], [id]]);
    expect(fts()).toEqual([]);
  });

  it("writes the index entry statement by statement on a driver without batch", async () => {
    const { api, fts, log } = notesApi(notes, { batch: false });
    const { id } = await api.create(admin, { title: "Hello" });
    expect(fts()).toEqual([{ rowid: id, title: "Hello", body: "" }]);
    expect(log.batches).toBe(0);
    expect(log.statements.filter((sql) => /notes_fts/.test(sql))).toEqual([
      expect.stringMatching(/^delete from "notes_fts"/),
      expect.stringMatching(/^insert into "notes_fts"/),
    ]);
  });

  it("skips a row without a numeric id, which can't be an index entry", async () => {
    const loose = defineCollection({
      slug: "loose",
      fields: { title: { type: "text" } },
      search: { fields: ["title"] },
    });
    // A hand-written table whose `id` isn't the primary key, so a row can lack one.
    const looseTable = sqliteTable("loose", { id: integer("id"), title: text("title") });
    const h = open(`
      CREATE TABLE loose (id INTEGER, title TEXT);
      ${collectionSearchTableSQL(loose)}
    `);
    const deferReindex = vi.fn<DeferReindex>();
    const api = createLocalApi(h.db, looseTable, loose, undefined, { deferReindex });

    const created = await api.create({}, { title: "Hello" });
    expect(created.id).toBeNull();
    expect(deferReindex).not.toHaveBeenCalled();
    // The rebuild reads the row but has nothing to write for it.
    expect(await api.reindexSearch({})).toBe(1);
    expect(h.rows("SELECT rowid FROM loose_fts")).toEqual([]);
    expect(h.log.batches).toBe(0);
  });

  it("refuses search, and makes reindexSearch a no-op, on a collection without search", async () => {
    const plain = defineCollection({
      slug: "plain",
      fields: { id: { type: "number", autoIncrement: true }, title: { type: "text" } },
    });
    const h = open("CREATE TABLE plain (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT)");
    const deferReindex = vi.fn<DeferReindex>();
    const api = createLocalApi(h.db, collectionToTable(plain), plain, undefined, {
      deferReindex,
    });
    const { id } = await api.create({}, { title: "Hello" });
    await api.deleteByID({}, id as number);

    await expect(api.search({}, "hello")).rejects.toThrow(
      'Collection "plain" has no "search" config, so search() can\'t run',
    );
    expect(await api.reindexSearch({})).toBe(0);
    expect(deferReindex).not.toHaveBeenCalled();
  });
});

describe("getRegisteredApi", () => {
  it("names the collection when the registry has no API for it", () => {
    const expected = /No LocalApi registered for collection "contacts"/;
    expect(() => getRegisteredApi(undefined, "contacts")).toThrow(expected);
    expect(() => getRegisteredApi({ tables: {}, configs: {} }, "contacts")).toThrow(expected);
    expect(() => getRegisteredApi({ tables: {}, configs: {}, apis: {} }, "contacts")).toThrow(
      LouiseContentError,
    );
  });

  it("lets a hook reach another collection's API once the registry is filled in", async () => {
    const contacts = defineCollection({
      slug: "contacts",
      fields: { id: { type: "number", autoIncrement: true }, email: { type: "text" } },
    });
    const inquiries = defineCollection({
      slug: "inquiries",
      fields: { id: { type: "number", autoIncrement: true }, email: { type: "text" } },
      hooks: {
        afterChange: [
          // Reads the registry lazily, inside the hook, as the late-binding
          // build order requires.
          async ({ doc }) => {
            await getRegisteredApi(registry, "contacts").create({}, { email: doc.email });
          },
        ],
      },
    });
    const h = open(`
      CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
      CREATE TABLE inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    `);
    const tables = {
      contacts: collectionToTable(contacts),
      inquiries: collectionToTable(inquiries),
    };
    const registry: ContentRegistry = { tables, configs: { contacts, inquiries }, apis: {} };
    const contactsApi = createLocalApi(h.db, tables.contacts, contacts, registry);
    const inquiriesApi = createLocalApi(h.db, tables.inquiries, inquiries, registry);
    Object.assign(registry.apis!, { contacts: contactsApi, inquiries: inquiriesApi });

    expect(getRegisteredApi(registry, "contacts")).toBe(contactsApi);
    await inquiriesApi.create({}, { email: "alex@example.com" });
    expect(await contactsApi.find({})).toEqual([{ id: 1, email: "alex@example.com" }]);
  });
});

describe("depth: 1 relationships", () => {
  const authors = defineCollection({
    slug: "authors",
    fields: { id: { type: "number", autoIncrement: true }, name: { type: "text" } },
    access: { read: adminsOnly },
  });
  const posts = defineCollection({
    slug: "posts",
    fields: {
      id: { type: "number", autoIncrement: true },
      title: { type: "text" },
      author: { type: "relationship", relationTo: "authors" },
      tags: { type: "relationship", relationTo: "tags", hasMany: true },
    },
  });
  const tables = { authors: collectionToTable(authors), posts: collectionToTable(posts) };
  const registry: ContentRegistry = { tables, configs: { authors, posts } };

  function postsApi(reg: ContentRegistry | null = registry) {
    const h = open(`
      CREATE TABLE authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, author INTEGER);
      INSERT INTO authors (name) VALUES ('Alex'), ('Kai');
      INSERT INTO posts (title, author) VALUES
        ('First', 1), ('Second', 2), ('Third', 1), ('Untitled', NULL), ('Orphan', 99);
    `);
    const api = createLocalApi<typeof tables.posts, Ctx>(
      h.db,
      tables.posts,
      posts,
      reg ?? undefined,
    );
    return { ...h, api };
  }

  it("resolves each related row with one query for the whole page", async () => {
    const { api, log } = postsApi();
    const found = await api.find(admin, { depth: 1 });
    expect(found.map((post) => [post.title, post.author])).toEqual([
      ["First", { id: 1, name: "Alex" }],
      ["Second", { id: 2, name: "Kai" }],
      ["Third", { id: 1, name: "Alex" }],
      // No id to resolve, and an id with no row behind it, stay as they are.
      ["Untitled", null],
      ["Orphan", 99],
    ]);
    expect(log.statements.filter((sql) => /from "authors"/.test(sql))).toHaveLength(1);
  });

  it("resolves the related row for findByID too", async () => {
    const { api } = postsApi();
    expect(await api.findByID(admin, 2, { depth: 1 })).toEqual({
      id: 2,
      title: "Second",
      author: { id: 2, name: "Kai" },
    });
  });

  it("leaves bare ids when the context can't read the related collection", async () => {
    const { api, log } = postsApi();
    const found = await api.find(guest, { depth: 1 });
    expect(found.map((post) => post.author)).toEqual([1, 2, 1, null, 99]);
    expect(log.statements.some((sql) => /from "authors"/.test(sql))).toBe(false);
  });

  it("skips the related query when no row on the page has an id", async () => {
    const { api, log } = postsApi();
    const found = await api.find(admin, { depth: 1, where: eq(tables.posts.title, "Untitled") });
    expect(found).toEqual([{ id: 4, title: "Untitled", author: null }]);
    expect(log.statements.some((sql) => /from "authors"/.test(sql))).toBe(false);
  });

  it("returns ids at depth 0, the default", async () => {
    const { api } = postsApi();
    expect(await api.findByID(admin, 1)).toEqual({ id: 1, title: "First", author: 1 });
    expect(await api.findByID(admin, 1, { depth: 0 })).toEqual({
      id: 1,
      title: "First",
      author: 1,
    });
  });

  it("fails without a registry to resolve against", async () => {
    const { api } = postsApi(null);
    await expect(api.find(admin, { depth: 1 })).rejects.toThrow(
      'Collection "posts" requested depth: 1 but createLocalApi was not given a registry to resolve relationship fields against',
    );
  });

  it("fails when the related collection isn't in the registry", async () => {
    const { api } = postsApi({ tables: { posts: tables.posts }, configs: { posts } });
    await expect(api.find(admin, { depth: 1 })).rejects.toThrow(
      'Collection "posts" field "author" relates to unknown collection "authors", which isn\'t in the registry',
    );
  });

  it("needs no registry for a collection without relationship fields", async () => {
    const { api } = notesApi();
    await api.create(admin, { title: "Hello" });
    expect(await api.find(admin, { depth: 1 })).toEqual([
      { id: 1, title: "Hello", slug: null, body: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// A versioned collection

const docs = sqliteTable("docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  publishedVersionId: integer("published_version_id"),
});
const docsWithoutStatus = sqliteTable("docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  publishedVersionId: integer("published_version_id"),
});
const docsConfig = defineCollection({
  slug: "docs",
  fields: { slug: { type: "text", required: true }, title: { type: "text", required: true } },
  versions: { drafts: true },
});
const docsVersions = collectionVersionsTable(docsConfig);

function docsApi(options: { status?: boolean; batch?: boolean; config?: CollectionConfig } = {}) {
  const withStatus = options.status ?? true;
  const h = open(
    `
    CREATE TABLE docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      ${withStatus ? "status TEXT NOT NULL DEFAULT 'draft'," : ""}
      published_version_id INTEGER);
    CREATE TABLE docs_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL,
      version_data TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER,
      scheduled_at INTEGER);
    INSERT INTO docs (slug, title) VALUES ('about', 'About'), ('contact', 'Contact');
  `,
    { batch: options.batch },
  );
  const api = createVersionedLocalApi(
    h.db,
    withStatus ? docs : docsWithoutStatus,
    docsVersions,
    options.config ?? docsConfig,
  );
  const doc = (id: number) =>
    h.sqlite.prepare("SELECT * FROM docs WHERE id = ?").get(id) as Record<string, unknown>;
  const versionStatuses = () => h.rows("SELECT id, status FROM docs_versions ORDER BY id");
  return { ...h, api, doc, versionStatuses };
}

const about = toPageId(1);
const contact = toPageId(2);
const vid = (row: { id: unknown }) => toVersionId(row.id as number);

describe("drafts", () => {
  it("lists a page's versions newest first, and no other page's", async () => {
    const { api } = docsApi();
    const first = await api.saveDraft({}, about, { title: "About us" });
    await api.saveDraft({}, contact, { title: "Contact us" });
    const second = await api.saveDraft({}, about, { title: "About Example Organization" });
    expect((await api.findVersions({}, about)).map((v) => v.id)).toEqual([second.id, first.id]);
  });

  it("prepares a draft through beforeChange and the field check, without writing it", async () => {
    const config: CollectionConfig = {
      ...docsConfig,
      hooks: { beforeChange: [({ data }) => ({ ...data, title: String(data.title).trim() })] },
    };
    const { api, rows } = docsApi({ config });
    expect(await api.prepareDraft({}, { title: "  About us  " })).toEqual({ title: "About us" });
    await expect(api.prepareDraft({}, { color: "blue" } as never)).rejects.toThrow(
      'Unknown field "color" for collection "docs"',
    );
    expect(rows("SELECT * FROM docs_versions")).toEqual([]);
  });

  it("refuses to save or schedule a draft for a page that doesn't exist", async () => {
    const { api, rows } = docsApi();
    const missing = toPageId(42);
    await expect(api.saveDraft({}, missing, { title: "Lost" })).rejects.toThrow(
      'No "docs" document found with id 42',
    );
    await expect(api.scheduleDraft({}, missing, { title: "Lost" }, new Date())).rejects.toThrow(
      'No "docs" document found with id 42',
    );
    expect(rows("SELECT * FROM docs_versions")).toEqual([]);
  });

  it("discards a draft, and names a version that doesn't exist", async () => {
    const { api, versionStatuses } = docsApi();
    const keep = await api.saveDraft({}, about, { title: "Keep" });
    const drop = await api.saveDraft({}, about, { title: "Drop" });
    await api.discardVersion({}, vid(drop));
    expect(versionStatuses()).toEqual([{ id: keep.id, status: "draft" }]);

    const error = await rejection(api.discardVersion({}, vid(drop)));
    expect(error).toBeInstanceOf(LouiseContentError);
    expect(error.message).toBe(`No "docs" version found with id ${drop.id}`);
  });
});

describe("publishing", () => {
  it("names a version that doesn't exist", async () => {
    const { api } = docsApi();
    await expect(api.publish({}, toVersionId(99))).rejects.toThrow(
      'No "docs" version found with id 99',
    );
  });

  it("runs the full required-field check a draft skips", async () => {
    const { api, doc, versionStatuses } = docsApi();
    // The draft carries only a title, so the snapshot has no slug to publish.
    const draft = await api.saveDraft({}, about, { title: "About us" });
    await expect(api.publish({}, vid(draft))).rejects.toThrow(
      'Missing required field "slug" for collection "docs"',
    );
    expect(doc(1)).toMatchObject({ title: "About", status: "draft", published_version_id: null });
    expect(versionStatuses()).toEqual([{ id: draft.id, status: "draft" }]);
  });

  it("refuses a version whose page was deleted, and leaves the version a draft", async () => {
    const { api, sqlite, versionStatuses } = docsApi();
    const draft = await api.saveDraft({}, about, { slug: "about", title: "About us" });
    sqlite.exec("DELETE FROM docs WHERE id = 1");
    await expect(api.publish({}, vid(draft))).rejects.toThrow('No "docs" document found with id 1');
    expect(versionStatuses()).toEqual([{ id: draft.id, status: "draft" }]);
  });

  it("rolls the whole publish back when the database rejects the row", async () => {
    const { api, doc, versionStatuses, log } = docsApi();
    // The contact page takes the about page's slug, which the table keeps unique.
    const draft = await api.saveDraft({}, contact, { slug: "about", title: "Contact us" });
    const error = await rejection(api.publish({}, vid(draft)));
    expect(error).toBeInstanceOf(LouiseContentError);
    expect(error.message).toBe('Unique constraint violated for collection "docs"');
    expect(log.batches).toBe(1);
    expect(doc(2)).toMatchObject({ slug: "contact", title: "Contact", status: "draft" });
    expect(versionStatuses()).toEqual([{ id: draft.id, status: "draft" }]);
  });

  it("publishes statement by statement on a driver without batch", async () => {
    const { api, doc, versionStatuses, log } = docsApi({ batch: false });
    const draft = await api.saveDraft({}, about, { slug: "about", title: "About us" });
    const published = await api.publish({}, vid(draft));
    expect(published).toMatchObject({ id: 1, title: "About us", status: "published" });
    expect(doc(1)).toMatchObject({ status: "published", published_version_id: draft.id });
    expect(versionStatuses()).toEqual([{ id: draft.id, status: "published" }]);
    expect(log.batches).toBe(0);
  });

  it("names a missing page on unpublish", async () => {
    const { api } = docsApi();
    await expect(api.unpublish({}, toPageId(42))).rejects.toThrow(
      'No "docs" document found with id 42',
    );
  });
});

describe("republish", () => {
  it("makes a hidden page live again with the edits made while it was hidden", async () => {
    const { api, doc } = docsApi();
    const draft = await api.saveDraft({}, about, { slug: "about", title: "About us" });
    await api.publish({}, vid(draft));
    await api.unpublish({}, about);
    await api.update({}, 1, { title: "About us, edited" });

    const row = await api.republish({}, about);
    expect(row).toMatchObject({ title: "About us, edited", status: "published" });
    expect(doc(1)).toMatchObject({ status: "published", published_version_id: draft.id });
  });

  it("refuses a page that was never published", async () => {
    const { api, doc } = docsApi();
    await expect(api.republish({}, about)).rejects.toThrow(
      '"docs" 1 has never been published; publish a version instead',
    );
    expect(doc(1)).toMatchObject({ status: "draft" });
  });

  it("names a page that doesn't exist", async () => {
    const { api } = docsApi();
    await expect(api.republish({}, toPageId(42))).rejects.toThrow(
      'No "docs" document found with id 42',
    );
  });

  it("refuses a table without a status column, which is always live", async () => {
    const { api } = docsApi({ status: false });
    await expect(api.republish({}, about)).rejects.toThrow(
      '"docs" has no status column, so it\'s always live once published',
    );
  });
});

describe("diffVersions", () => {
  function seeded() {
    const h = docsApi();
    // Snapshots written directly, so they can carry the bookkeeping keys a
    // draft save would reject.
    h.sqlite.exec(`
      INSERT INTO docs_versions (parent_id, version_data, status) VALUES
        (1, '{"id":1,"status":"draft","slug":"about","title":"About","summary":"Old"}', 'published'),
        (1, '{"id":1,"status":"published","slug":"about","title":"About us","createdAt":5}', 'draft');
    `);
    return h;
  }

  it("lists the content fields that changed, ignoring bookkeeping keys", async () => {
    const { api } = seeded();
    expect(await api.diffVersions({}, toVersionId(1), toVersionId(2))).toEqual([
      { path: ["title"], kind: "changed", before: "About", after: "About us" },
      { path: ["summary"], kind: "removed", before: "Old" },
    ]);
  });

  it("returns no changes for a version against itself", async () => {
    const { api } = seeded();
    expect(await api.diffVersions({}, toVersionId(1), toVersionId(1))).toEqual([]);
  });

  it("names whichever version doesn't exist", async () => {
    const { api } = seeded();
    await expect(api.diffVersions({}, toVersionId(9), toVersionId(2))).rejects.toThrow(
      'No "docs" version found with id 9',
    );
    await expect(api.diffVersions({}, toVersionId(1), toVersionId(8))).rejects.toThrow(
      'No "docs" version found with id 8',
    );
  });
});
