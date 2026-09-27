import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  createLocalApi,
  defineCollection,
  defineMigration,
  type JsonValue,
  runMigration,
} from "../../src/core/content/index.js";

// The content-migration runner in core/content/migrate.ts (#695): a dry run
// reports without writing, a real run writes each document's patch through the
// Local API, a second run changes nothing, and a failing document is reported
// without stopping the rest. Against real SQLite through drizzle's D1 driver.

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
  } as unknown as D1Database;
}

const recipes = sqliteTable("recipes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body", { mode: "json" }).$type<JsonValue>(),
  legacy: text("legacy"),
});

type Context = { editor: string; canUpdate?: boolean };

function open() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE recipes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, legacy TEXT)",
  );
  const insert = sqlite.prepare("INSERT INTO recipes (title, body, legacy) VALUES (?, ?, ?)");
  insert.run("Soup", JSON.stringify([{ type: "para", text: "Simmer." }]), "old-soup");
  insert.run("Bread", JSON.stringify([{ type: "paragraph", text: "Knead." }]), null);
  insert.run("Salad", JSON.stringify([{ type: "para", text: "Toss." }]), "old-salad");
  const updates: Context[] = [];
  const config = defineCollection({
    slug: "recipes",
    fields: {
      title: { type: "text", required: true },
      body: { type: "json" },
      legacy: { type: "text" },
    },
    access: {
      update: (context: Context) => {
        updates.push(context);
        return context.canUpdate !== false;
      },
    },
  });
  const api = createLocalApi<typeof recipes, Context>(drizzle(sqliteD1(sqlite)), recipes, config);
  const rows = () =>
    sqlite.prepare("SELECT id, title, body, legacy FROM recipes ORDER BY id").all() as {
      id: number;
      title: string;
      body: string;
      legacy: string | null;
    }[];
  return { api, rows, updates };
}

// Renames the `para` block type and drops the legacy column's value. Leaves a
// document that needs neither change alone by returning undefined.
const renameParagraphs = defineMigration({
  name: "2026-09-rename-para",
  document: (doc) => {
    const blocks = (doc.body ?? []) as { type: string; text: string }[];
    const needsRename = blocks.some((block) => block.type === "para");
    if (!needsRename && doc.legacy === null) return undefined;
    const { legacy: _legacy, ...rest } = doc;
    return {
      ...rest,
      body: blocks.map((block) =>
        block.type === "para" ? { ...block, type: "paragraph" } : block,
      ),
    };
  },
});

describe("defineMigration", () => {
  it("returns the migration it's given", () => {
    const migration = { name: "noop", document: () => undefined };
    expect(defineMigration(migration)).toBe(migration);
  });
});

describe("runMigration", () => {
  it("reports each document's patch on a dry run and writes nothing", async () => {
    const { api, rows, updates } = open();
    const before = rows();
    const result = await runMigration(renameParagraphs, {
      api,
      context: { editor: "Alex" },
      dryRun: true,
    });
    expect(result).toEqual({
      migration: "2026-09-rename-para",
      dryRun: true,
      scanned: 3,
      changed: 2,
      changes: [
        {
          id: 1,
          patch: [
            { op: "set", path: "body", value: [{ type: "paragraph", text: "Simmer." }] },
            { op: "unset", path: "legacy" },
          ],
        },
        {
          id: 3,
          patch: [
            { op: "set", path: "body", value: [{ type: "paragraph", text: "Toss." }] },
            { op: "unset", path: "legacy" },
          ],
        },
      ],
      errors: [],
    });
    expect(rows()).toEqual(before);
    expect(updates).toEqual([]);
  });

  it("writes each patch through the Local API, with the caller's context", async () => {
    const { api, rows, updates } = open();
    const context = { editor: "Kai" };
    const result = await runMigration(renameParagraphs, { api, context });
    expect(result.dryRun).toBe(false);
    expect(result.changed).toBe(2);
    expect(rows()).toEqual([
      { id: 1, title: "Soup", body: '[{"type":"paragraph","text":"Simmer."}]', legacy: null },
      { id: 2, title: "Bread", body: '[{"type":"paragraph","text":"Knead."}]', legacy: null },
      { id: 3, title: "Salad", body: '[{"type":"paragraph","text":"Toss."}]', legacy: null },
    ]);
    // Only the two changed documents were written.
    expect(updates).toEqual([context, context]);
  });

  it("changes nothing on a second run", async () => {
    const { api, updates } = open();
    await runMigration(renameParagraphs, { api, context: { editor: "Quinn" } });
    updates.length = 0;
    const again = await runMigration(renameParagraphs, { api, context: { editor: "Quinn" } });
    expect(again).toMatchObject({ scanned: 3, changed: 0, changes: [], errors: [] });
    expect(updates).toEqual([]);
  });

  it("treats a returned unchanged document the same as undefined", async () => {
    const { api } = open();
    const result = await runMigration(
      defineMigration({ name: "identity", document: async (doc) => doc }),
      { api, context: { editor: "Alex" } },
    );
    expect(result).toMatchObject({ scanned: 3, changed: 0, changes: [] });
  });

  it("records a document whose transform throws and carries on with the rest", async () => {
    const { api, rows } = open();
    const result = await runMigration(
      defineMigration({
        name: "shout",
        document: (doc) => {
          if (doc.id === 2) throw new Error("bad bread");
          return { ...doc, title: String(doc.title).toUpperCase() };
        },
      }),
      { api, context: { editor: "Alex" } },
    );
    expect(result.errors).toEqual(["document 2: Error: bad bread"]);
    expect(result.changed).toBe(2);
    expect(rows().map((row) => row.title)).toEqual(["SOUP", "Bread", "SALAD"]);
  });

  it("records a write the Local API refuses instead of throwing", async () => {
    const { api, rows } = open();
    const result = await runMigration(renameParagraphs, {
      api,
      context: { editor: "Kai", canUpdate: false },
    });
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^document 1: LouiseAccessDeniedError: /);
    expect(result.errors[1]).toMatch(/^document 3: LouiseAccessDeniedError: /);
    expect(rows()[0].legacy).toBe("old-soup");
  });

  it("scans nothing in an empty collection", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(
      "CREATE TABLE recipes (id INTEGER PRIMARY KEY, title TEXT, body TEXT, legacy TEXT)",
    );
    const api = createLocalApi(
      drizzle(sqliteD1(sqlite)),
      recipes,
      defineCollection({ slug: "recipes", fields: { title: { type: "text" } } }),
    );
    expect(await runMigration(renameParagraphs, { api, context: undefined })).toEqual({
      migration: "2026-09-rename-para",
      dryRun: false,
      scanned: 0,
      changed: 0,
      changes: [],
      errors: [],
    });
  });
});
