import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  type CollectionConfig,
  collectionSearchTableName,
  collectionSearchTableSQL,
  collectionToTable,
  collectionVersionsTable,
  contentConfigToSchema,
  extractSearchText,
  relationshipJoinTables,
} from "../../src/core/content/index.js";
import { LouiseContentError } from "../../src/core/errors.js";

// The runtime half of content codegen, core/content/codegen.ts (#695): the
// Drizzle tables a ContentConfig becomes, the FTS5 table SQL, and the text a
// document contributes to search. The tables are created in real SQLite and
// written through drizzle's D1 driver, so defaults, JSON mode, boolean mode,
// and timestamps are checked end to end rather than by column metadata alone.

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

/** CREATE TABLE text for a drizzle table: the column types and constraints
 *  codegen chose. Literal defaults are left to drizzle, which inlines them. */
function createTableSQL(table: SQLiteTable): string {
  const { name, columns } = getTableConfig(table);
  const definitions = columns.map((column) => {
    let definition = `"${column.name}" ${column.getSQLType()}`;
    if (column.primary) {
      definition += " PRIMARY KEY";
      if ((column as { autoIncrement?: boolean }).autoIncrement) definition += " AUTOINCREMENT";
    }
    if (column.notNull && !column.primary) definition += " NOT NULL";
    if (column.isUnique) definition += " UNIQUE";
    return definition;
  });
  return `CREATE TABLE "${name}" (${definitions.join(", ")})`;
}

const moment = new Date("2026-03-04T05:06:07.890Z");

const events: CollectionConfig = {
  slug: "events",
  fields: {
    id: { type: "number", autoIncrement: true },
    title: { type: "text", required: true, unique: true },
    subtitle: { type: "text", defaultValue: "Untitled" },
    poster: { type: "upload" },
    body: { type: "richText" },
    agenda: { type: "array", required: true, fields: { time: { type: "text" } } },
    extra: { type: "json", defaultValue: { rsvp: true } },
    venue: { type: "relationship", relationTo: "venues", required: true },
    speakers: { type: "relationship", relationTo: "people", hasMany: true },
    kind: { type: "select", options: ["talk", "workshop"], required: true, defaultValue: "talk" },
    capacity: { type: "number", required: true, defaultValue: 40 },
    price: { type: "number" },
    featured: { type: "checkbox", required: true, defaultValue: false },
    archived: { type: "checkbox" },
    startsAt: { type: "date", required: true, defaultValue: "now" },
    doorsAt: { type: "date", mode: "timestamp_ms", defaultValue: moment },
    updatedAt: { type: "date", onUpdate: "now" },
    contact: {
      type: "group",
      fields: { email: { type: "text", name: "contact_mail" }, phone: { type: "text" } },
    },
  },
  versions: { drafts: true },
};

describe("collectionToTable", () => {
  const table = collectionToTable(events);
  const { name, columns } = getTableConfig(table);
  const column = (columnName: string) => {
    const found = columns.find((c) => c.name === columnName);
    if (!found) throw new Error(`no column ${columnName}`);
    return found;
  };

  it("names the table after the slug and snake-cases the column names", () => {
    expect(name).toBe("events");
    expect(columns.map((c) => c.name)).toEqual([
      "id",
      "title",
      "subtitle",
      "poster",
      "body",
      "agenda",
      "extra",
      "venue",
      "kind",
      "capacity",
      "price",
      "featured",
      "archived",
      "starts_at",
      "doors_at",
      "updated_at",
      "contact_mail",
      "contact_phone",
      "published_version_id",
    ]);
  });

  it("maps each field type to its SQLite column type", () => {
    expect(column("id").getSQLType()).toBe("integer");
    expect(column("id").primary).toBe(true);
    expect(column("title").getSQLType()).toBe("text");
    expect(column("poster").getSQLType()).toBe("text");
    expect(column("body").getSQLType()).toBe("text");
    expect(column("venue").getSQLType()).toBe("integer");
    expect(column("kind").enumValues).toEqual(["talk", "workshop"]);
    expect(column("capacity").getSQLType()).toBe("real");
    expect(column("featured").getSQLType()).toBe("integer");
    expect(column("featured").columnType).toBe("SQLiteBoolean");
    expect(column("starts_at").columnType).toBe("SQLiteTimestamp");
    expect(column("doors_at").columnType).toBe("SQLiteTimestamp");
    expect(column("body").columnType).toBe("SQLiteTextJson");
  });

  it("carries required, unique, defaults, and update stamps onto the columns", () => {
    expect(column("title").notNull).toBe(true);
    expect(column("title").isUnique).toBe(true);
    expect(column("subtitle").default).toBe("Untitled");
    expect(column("agenda").notNull).toBe(true);
    expect(column("extra").default).toEqual({ rsvp: true });
    expect(column("venue").notNull).toBe(true);
    expect(column("kind").default).toBe("talk");
    expect(column("capacity").default).toBe(40);
    expect(column("featured").default).toBe(false);
    expect(column("featured").notNull).toBe(true);
    expect(column("archived").hasDefault).toBe(false);
    expect(column("starts_at").notNull).toBe(true);
    expect(column("doors_at").defaultFn?.()).toBe(moment);
    expect(column("updated_at").onUpdateFn).toBeTypeOf("function");
    expect(column("price").hasDefault).toBe(false);
    expect(column("published_version_id").notNull).toBe(false);
  });

  it("leaves no column for a hasMany relationship", () => {
    expect(columns.some((c) => c.name === "speakers")).toBe(false);
  });

  it("adds no version pointer to a collection without drafts", () => {
    const plain = collectionToTable({ slug: "notes", fields: { body: { type: "text" } } });
    expect(getTableConfig(plain).columns.map((c) => c.name)).toEqual(["body"]);
  });

  it("rejects a field type it has no column for", () => {
    const bogus = {
      slug: "things",
      fields: { x: { type: "bogus" } },
    } as unknown as CollectionConfig;
    expect(() => collectionToTable(bogus)).toThrow(LouiseContentError);
    expect(() => collectionToTable(bogus)).toThrow(
      'Field type "bogus" is not yet supported by louise-toolkit/content codegen',
    );
  });
});

describe("the generated tables in SQLite", () => {
  function open() {
    const sqlite = new DatabaseSync(":memory:");
    const schema = contentConfigToSchema({ collections: [events] });
    for (const table of Object.values(schema)) sqlite.exec(createTableSQL(table));
    return {
      sqlite,
      main: collectionToTable(events),
      versions: collectionVersionsTable(events),
      orm: drizzle(sqliteD1(sqlite)),
    };
  }

  // A config-built table's columns are only known at run time, so its insert
  // type is a plain record; this names that for the values below.
  type Insert = ReturnType<typeof collectionToTable>["$inferInsert"];

  it("fills defaults on insert and reads JSON, booleans, and dates back typed", async () => {
    const { main, orm } = open();
    const before = Date.now();
    const values: Insert = { title: "Launch night", agenda: [{ time: "18:00" }], venue: 7 };
    const [row] = await orm.insert(main).values(values).returning();

    expect(row.subtitle).toBe("Untitled");
    expect(row.agenda).toEqual([{ time: "18:00" }]);
    expect(row.extra).toEqual({ rsvp: true });
    expect(row.kind).toBe("talk");
    expect(row.capacity).toBe(40);
    expect(row.featured).toBe(false);
    expect(row.archived).toBeNull();
    expect(row.startsAt).toBeInstanceOf(Date);
    // Seconds precision: `timestamp` mode stores whole seconds.
    expect((row.startsAt as Date).getTime()).toBeGreaterThanOrEqual(
      Math.floor(before / 1000) * 1000,
    );
    // Milliseconds survive in `timestamp_ms` mode.
    expect((row.doorsAt as Date).getTime()).toBe(moment.getTime());
    expect(row.publishedVersionId).toBeNull();
  });

  it("stores a boolean as 0 or 1 and rich text as JSON text", async () => {
    const { sqlite, main, orm } = open();
    const values: Insert = {
      title: "Workshop",
      agenda: [],
      venue: 1,
      featured: true,
      body: { type: "doc", content: [] },
    };
    await orm.insert(main).values(values);
    const raw = sqlite.prepare("SELECT featured, body FROM events").get() as Record<
      string,
      unknown
    >;
    expect(raw.featured).toBe(1);
    expect(raw.body).toBe('{"type":"doc","content":[]}');
  });

  it("enforces a unique field", async () => {
    const { main, orm } = open();
    const values: Insert = { title: "Same", agenda: [], venue: 1 };
    await orm.insert(main).values(values);
    await expect(orm.insert(main).values(values)).rejects.toThrow();
  });

  it("creates the join and versions tables alongside the main one", () => {
    const { sqlite } = open();
    const tables = (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    expect(tables).toEqual(
      expect.arrayContaining(["events", "events_speakers", "events_versions"]),
    );
  });

  it("stamps a version's creation time and round-trips its snapshot", async () => {
    const { versions, orm } = open();
    const snapshot = { title: "Draft title", agenda: [] };
    const [version] = await orm
      .insert(versions)
      .values({ parentId: 1, versionData: snapshot, status: "draft" })
      .returning();
    expect(version.versionData).toEqual(snapshot);
    expect(version.createdAt).toBeInstanceOf(Date);
    expect(version.scheduledAt).toBeNull();
  });
});

describe("relationshipJoinTables", () => {
  it("builds one two-column join table per hasMany relationship", () => {
    const joins = relationshipJoinTables(events);
    expect(Object.keys(joins)).toEqual(["events_speakers"]);
    const { name, columns } = getTableConfig(joins.events_speakers);
    expect(name).toBe("events_speakers");
    expect(columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual([
      ["events_id", "integer", true],
      ["people_id", "integer", true],
    ]);
  });

  it("returns nothing for a collection without hasMany relationships", () => {
    const single = {
      slug: "posts",
      fields: { author: { type: "relationship", relationTo: "people" } },
    } satisfies CollectionConfig;
    expect(relationshipJoinTables(single)).toEqual({});
  });
});

describe("collectionVersionsTable", () => {
  it("builds the snapshot table a drafts collection writes versions to", () => {
    const { name, columns } = getTableConfig(collectionVersionsTable(events));
    expect(name).toBe("events_versions");
    expect(columns.map((c) => [c.name, c.notNull])).toEqual([
      ["id", true],
      ["parent_id", true],
      ["version_data", true],
      ["status", true],
      ["created_at", false],
      ["scheduled_at", false],
    ]);
    expect(columns.find((c) => c.name === "status")?.enumValues).toEqual(["draft", "published"]);
  });
});

describe("contentConfigToSchema", () => {
  it("keys every table by name across collections", () => {
    const venues: CollectionConfig = { slug: "venues", fields: { name: { type: "text" } } };
    const schema = contentConfigToSchema({ collections: [events, venues] });
    expect(Object.keys(schema)).toEqual(["events", "events_speakers", "events_versions", "venues"]);
  });

  it("returns an empty schema for no collections", () => {
    expect(contentConfigToSchema({ collections: [] })).toEqual({});
  });
});

const searchable: CollectionConfig = {
  slug: "posts",
  fields: {
    title: { type: "text" },
    cover: { type: "upload" },
    body: { type: "richText" },
    sections: { type: "json" },
  },
  search: { fields: ["title", "cover", "body", "sections"] },
};

describe("collectionSearchTableSQL", () => {
  it("names the FTS table after the slug", () => {
    expect(collectionSearchTableName(searchable)).toBe("posts_fts");
  });

  it("returns an empty string when the collection has no search fields", () => {
    expect(collectionSearchTableSQL(events)).toBe("");
    expect(collectionSearchTableSQL({ ...searchable, search: { fields: [] } })).toBe("");
  });

  it("emits FTS5 DDL that SQLite runs and searches", () => {
    const sql = collectionSearchTableSQL(searchable);
    expect(sql).toBe(
      'CREATE VIRTUAL TABLE IF NOT EXISTS "posts_fts" USING fts5("title", "cover", "body", "sections");',
    );
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(sql);
    // IF NOT EXISTS makes it safe to run twice.
    sqlite.exec(sql);
    const values = extractSearchText(searchable, {
      title: "Spring menu",
      cover: "menu.jpg",
      body: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Fresh asparagus" }] }],
      },
      sections: [{ heading: "Hours", note: "Open late" }],
    });
    sqlite.prepare("INSERT INTO posts_fts VALUES (?, ?, ?, ?)").run(...values);
    const hit = sqlite
      .prepare("SELECT title FROM posts_fts WHERE posts_fts MATCH ?")
      .all("asparagus") as { title: string }[];
    expect(hit).toEqual([{ title: "Spring menu" }]);
  });
});

describe("extractSearchText", () => {
  const run = (doc: Record<string, unknown>) => extractSearchText(searchable, doc);

  it("indexes text and upload fields as-is, and anything else in them as empty", () => {
    expect(run({ title: "Hello", cover: "a.png" }).slice(0, 2)).toEqual(["Hello", "a.png"]);
    expect(run({ title: 42, cover: null }).slice(0, 2)).toEqual(["", ""]);
  });

  it("joins a rich-text document's text leaves in order, ignoring marks", () => {
    const [, , body] = run({
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello", marks: [{ type: "bold" }] },
              { type: "text", text: "world" },
            ],
          },
          { type: "horizontalRule" },
          { type: "paragraph", content: [{ type: "text", text: "again" }] },
        ],
      },
    });
    expect(body).toBe("Hello world again");
  });

  it("coerces rich text that isn't TipTap JSON instead of throwing", () => {
    expect(run({ body: "plain words" })[2]).toBe("plain words");
    expect(run({ body: 12 })[2]).toBe("12");
    expect(run({ body: null })[2]).toBe("");
    expect(run({})[2]).toBe("");
    expect(run({ body: [{ text: "one" }, {}, { text: "two" }] })[2]).toBe("one two");
  });

  it("collects every string, number, and boolean leaf of a json field", () => {
    const [, , , sections] = run({
      sections: {
        hero: { heading: "Welcome", count: 3, live: true, none: null },
        tags: ["a", "b"],
      },
    });
    expect(sections).toBe("Welcome 3 true a b");
    expect(run({ sections: "flat" })[3]).toBe("flat");
    expect(run({ sections: 5 })[3]).toBe("5");
    expect(run({ sections: undefined })[3]).toBe("");
  });

  it("indexes a search key with no field config as a plain string", () => {
    const loose = { slug: "loose", fields: {}, search: { fields: ["ghost"] } } as CollectionConfig;
    expect(extractSearchText(loose, { ghost: "boo" })).toEqual(["boo"]);
  });

  it("returns no columns for a collection without search", () => {
    expect(extractSearchText(events, { title: "x" })).toEqual([]);
  });
});
