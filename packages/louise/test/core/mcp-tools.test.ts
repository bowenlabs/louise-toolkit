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
    // browse either—same hint the Structure Builder reads.
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

// An agent picks a tool from its description alone, so the descriptions are
// behavior: each says when to use the tool, names the better tool where two
// overlap, and says where a write lands (#234).
describe("tool descriptions", () => {
  const sections: SectionCatalog = { hero: { label: "Hero", fields: {} } };
  const describe_ = (config: CollectionConfig) =>
    Object.fromEntries(collectionTools(config, { sections }).map((t) => [t.name, t.description]));

  it("says when to use each tool on a versioned, searchable collection", () => {
    expect(describe_({ ...pages, admin: { label: "Pages" } })).toMatchInlineSnapshot(`
      {
        "add_pages_section": "Append a section to a Pages document, saved as a new draft version. The published document doesn't change until someone publishes the draft. Use it to add page content from the site's section catalog.",
        "count_pages": "Count Pages documents. Use it to size the collection before paging through it with \`list_pages\`.",
        "create_pages": "Create a Pages document, saved as a draft. Nothing goes live until someone publishes it. Use it to add a new document; to change one that exists, use \`update_pages_field\`.",
        "get_pages": "Fetch one Pages document by id. Unpublished draft edits aren't included. Use it when you already have the id, for example from \`list_pages\` or \`search_pages\`.",
        "list_pages": "List Pages documents, newest first. Unpublished draft edits aren't included. Use it to browse or page through the collection. To find documents about a topic, use \`search_pages\` instead.",
        "publish_pages": "Publish the current draft of a Pages document, making it live on the site. Call it only when the person has asked you to publish; otherwise leave your edits as drafts for them to review.",
        "search_pages": "Full-text search Pages across: title, body. Use it to find documents about a topic or containing given words; prefer it to \`list_pages\` whenever you're looking for something rather than browsing. Every word must match, and a word matches as a prefix.",
        "update_pages_field": "Set one field on a Pages document, saved as a new draft version. The published document doesn't change until someone publishes the draft. Use it for a targeted edit to a document that exists.",
      }
    `);
  });

  it("says a create goes live at once where there are no drafts, and points nowhere it can't", () => {
    const { search: _search, versions: _versions, ...plain } = pages;
    expect(describe_(plain)).toMatchInlineSnapshot(`
      {
        "count_pages": "Count pages documents. Use it to size the collection before paging through it with \`list_pages\`.",
        "create_pages": "Create a pages document. This collection keeps no drafts, so the document is live as soon as it's created. Use it only to add a new document.",
        "get_pages": "Fetch one pages document by id. Use it when you already have the id, for example from \`list_pages\`.",
        "list_pages": "List pages documents, newest first. Use it to browse or page through the collection.",
      }
    `);
  });

  it("marks reads read-only and writes non-destructive", () => {
    const tools = collectionTools(pages, { sections });
    for (const tool of tools) {
      const read = ["list", "get", "count", "search"].includes(tool.operation);
      expect(tool.annotations.readOnlyHint).toBe(read);
      if (!read) expect(tool.annotations.destructiveHint).toBe(false);
    }
  });
});
