import { describe, expect, it } from "vitest";
import { collectionTools, contentTools, type McpTool } from "../../src/core/mcp/index.js";
import type { SectionCatalog } from "../../src/core/content/sections.js";
import type { CollectionConfig, ContentConfig } from "../../src/core/content/types.js";

const pages: CollectionConfig = {
  slug: "pages",
  fields: {
    title: { type: "text", required: true },
    slug: { type: "text", required: true },
    status: { type: "select", options: ["draft", "published"] },
    views: { type: "number" },
    featured: { type: "checkbox" },
    publishedAt: { type: "date" },
    body: { type: "richText" },
    author: { type: "relationship", relationTo: "users" },
    tags: { type: "relationship", relationTo: "tags", hasMany: true },
    hero: { type: "upload" },
    meta: { type: "json" },
    seo: { type: "group", fields: { description: { type: "text" } } },
  },
  versions: { drafts: true },
  search: { fields: ["title", "body"] },
};

const names = (tools: McpTool[]) => tools.map((t) => t.name);
const byName = (tools: McpTool[], name: string) => tools.find((t) => t.name === name);
const props = (t: McpTool) => t.inputSchema.properties as Record<string, Record<string, unknown>>;

describe("collectionTools", () => {
  it("generates the read + write surface for a versioned, searchable collection", () => {
    expect(names(collectionTools(pages))).toEqual([
      "list_pages",
      "get_pages",
      "count_pages",
      "search_pages",
      "create_pages",
      "update_pages_field",
      "publish_pages",
    ]);
  });

  it("omits a hidden collection entirely", () => {
    // A system/log table a human never browses is not one an agent should
    // browse either — same hint the Structure Builder reads.
    expect(collectionTools({ ...pages, admin: { hidden: true } })).toEqual([]);
  });

  it("gives a read-only collection read tools and nothing else", () => {
    const tools = collectionTools({ ...pages, admin: { readOnly: true } });
    expect(names(tools)).toEqual(["list_pages", "get_pages", "count_pages", "search_pages"]);
    expect(tools.every((t) => ["list", "get", "count", "search"].includes(t.operation))).toBe(true);
  });

  it("omits search when the collection has no FTS index", () => {
    // Advertising it would promise something createLocalApi cannot serve.
    const { search: _search, ...noSearch } = pages;
    expect(names(collectionTools(noSearch))).not.toContain("search_pages");
  });

  it("withholds edit + publish from a collection with no draft history", () => {
    // Every agent edit lands as a draft (ADR 0009 §4); with no version history
    // there is nowhere safe for one to land. `create` is still fine.
    const tools = names(collectionTools({ ...pages, versions: undefined }));
    expect(tools).toContain("create_pages");
    expect(tools).not.toContain("update_pages_field");
    expect(tools).not.toContain("publish_pages");
  });

  it("keeps publish a separate tool from the write tools", () => {
    // So a token can be scoped to draft-only.
    const publish = byName(collectionTools(pages), "publish_pages");
    expect(publish?.operation).toBe("publish");
    expect(publish?.inputSchema.required).toEqual(["id"]);
  });
});

describe("argument schemas derived from fields", () => {
  const create = () => byName(collectionTools(pages), "create_pages") as McpTool;

  it("maps each field type to its JSON Schema equivalent", () => {
    const p = props(create());
    expect(p.title).toEqual({ type: "string" });
    expect(p.status).toEqual({ type: "string", enum: ["draft", "published"] });
    expect(p.views).toEqual({ type: "number" });
    expect(p.featured).toEqual({ type: "boolean" });
    expect(p.publishedAt).toEqual({ type: "string", format: "date-time" });
    expect(p.author).toEqual({ type: ["string", "number"] });
    expect(p.tags).toEqual({ type: "array", items: { type: ["string", "number"] } });
    expect(p.body?.type).toBe("object");
  });

  it("leaves a json field unconstrained rather than forcing an object", () => {
    // `{type:"object"}` would wrongly reject an array, which a json column takes.
    expect(props(create()).meta).toEqual({});
  });

  it("carries `required` through from the field config", () => {
    expect(create().inputSchema.required).toEqual(["title", "slug"]);
  });

  it("rejects unknown properties, so a guessed field errors instead of no-oping", () => {
    expect(create().inputSchema.additionalProperties).toBe(false);
  });

  it("flattens groups the way every other layer does", () => {
    // codegen, schema-gen and the Local API all canonicalize through
    // flattenFields; the tool surface has to agree or an agent would send a
    // shape the write path rejects.
    const p = props(create());
    expect(p.seo_description).toEqual({ type: "string" });
    expect(p.seo).toBeUndefined();
  });

  it("constrains update_field's `field` to an enum of real field names", () => {
    const field = props(byName(collectionTools(pages), "update_pages_field") as McpTool).field;
    expect(field.enum).toContain("title");
    expect(field.enum).toContain("seo_description");
    expect(field.enum).not.toContain("seo");
  });
});

describe("section catalog wiring", () => {
  const sections: SectionCatalog = {
    hero: { label: "Hero", fields: { heading: { type: "text" }, image: { type: "upload" } } },
    columns: { label: "Columns", fields: { count: { type: "number" } } },
  };

  it("adds no section tool without a catalog", () => {
    expect(names(collectionTools(pages))).not.toContain("add_pages_section");
  });

  it("constrains `section` to the catalog, so an unrenderable section cannot be inserted", () => {
    const tool = byName(collectionTools(pages, { sections }), "add_pages_section") as McpTool;
    expect(tool.operation).toBe("add_section");
    expect(props(tool).section.enum).toEqual(["hero", "columns"]);
  });

  it("describes each section's own props", () => {
    const tool = byName(collectionTools(pages, { sections }), "add_pages_section") as McpTool;
    const variants = props(tool).values.oneOf as { title: string; properties: object }[];
    expect(variants.map((v) => v.title)).toEqual(["hero", "columns"]);
    expect(variants[0]?.properties).toHaveProperty("heading");
    expect(variants[1]?.properties).toHaveProperty("count");
  });

  it("adds no section tool to a read-only collection", () => {
    const tools = collectionTools({ ...pages, admin: { readOnly: true } }, { sections });
    expect(names(tools)).not.toContain("add_pages_section");
  });
});

describe("contentTools", () => {
  it("spans every collection and keeps names unique", () => {
    const config = {
      collections: [pages, { slug: "posts", fields: { title: { type: "text" } } }],
    } as unknown as ContentConfig;
    const tools = contentTools(config);
    expect(names(tools)).toContain("list_pages");
    expect(names(tools)).toContain("list_posts");
    expect(new Set(names(tools)).size).toBe(tools.length);
  });

  it("drops hidden collections from the combined surface", () => {
    const config = {
      collections: [pages, { slug: "logs", fields: {}, admin: { hidden: true } }],
    } as unknown as ContentConfig;
    expect(names(contentTools(config)).some((n) => n.endsWith("_logs"))).toBe(false);
  });
});
