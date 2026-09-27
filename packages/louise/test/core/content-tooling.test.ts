import { describe, expect, it } from "vitest";
import {
  defineCollection,
  defineMigration,
  generateSchemaSource,
  runMigration,
} from "../../src/core/content/index.js";

// #699: schema-gen emits a checkbox, runMigration takes a typed migration and
// counts only the writes that land, and the search-field error names json.

describe("generateSchemaSource and checkbox fields", () => {
  it("emits the integer-as-boolean column codegen builds", () => {
    const notes = defineCollection({
      slug: "notes",
      fields: {
        pinned: { type: "checkbox", required: true, defaultValue: false },
        archived: { type: "checkbox" },
      },
    });
    const source = generateSchemaSource({ collections: [notes] });
    expect(source).toContain(
      `pinned: integer("pinned", { mode: "boolean" }).notNull().default(false)`,
    );
    expect(source).toContain(`archived: integer("archived", { mode: "boolean" })`);
  });
});

describe("runMigration", () => {
  interface Note extends Record<string, string | number> {
    id: number;
    title: string;
  }
  const rows: Note[] = [
    { id: 1, title: "one" },
    { id: 2, title: "two" },
    { id: 3, title: "three" },
  ];
  const upper = defineMigration<Note>({
    name: "upper-titles",
    document: (doc) => ({ ...doc, title: doc.title.toUpperCase() }),
  });

  it("takes a typed migration, and counts a failed write only as an error", async () => {
    const written: number[] = [];
    const api = {
      find: async () => rows,
      update: async (_context: unknown, id: number) => {
        if (id === 2) throw new Error("locked");
        written.push(id);
      },
    };
    const result = await runMigration(upper, { api: api as never, context: {} });
    expect(written).toEqual([1, 3]);
    expect(result.changed).toBe(2);
    expect(result.changes.map((c) => c.id)).toEqual([1, 3]);
    expect(result.errors).toEqual(["document 2: Error: locked"]);
  });

  it("counts every would-be change in a dry run", async () => {
    const api = { find: async () => rows, update: async () => {} };
    const result = await runMigration(upper, { api: api as never, context: {}, dryRun: true });
    expect(result.changed).toBe(3);
  });
});

describe("defineCollection's search-field error", () => {
  it("names every indexable type, json included", () => {
    expect(() =>
      defineCollection({
        slug: "notes",
        fields: { count: { type: "number" } },
        search: { fields: ["count"] },
      }),
    ).toThrow('only "text", "richText", "upload", and "json" fields can be indexed');
  });
});
