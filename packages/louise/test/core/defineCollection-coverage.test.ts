import { describe, expect, it } from "vitest";
import {
  type CollectionConfig,
  type ContentConfig,
  defineCollection,
  defineContentConfig,
  type LouisePlugin,
} from "../../src/core/content/index.js";
import { LouiseContentError } from "../../src/core/errors.js";

// Config validation in core/content/defineCollection.ts (#695): what
// `defineCollection` rejects, and how `defineContentConfig` runs plugins before
// holding their output to the same rules.

const valid: CollectionConfig = { slug: "pages", fields: { title: { type: "text" } } };

/** Asserts `config` is rejected with a LouiseContentError carrying `message`. */
function rejects(config: unknown, message: string) {
  const attempt = () => defineCollection(config as CollectionConfig);
  expect(attempt).toThrow(LouiseContentError);
  expect(attempt).toThrow(message);
}

describe("defineCollection", () => {
  it("returns a valid config unchanged", () => {
    expect(defineCollection(valid)).toBe(valid);
  });

  it("accepts every known field type", () => {
    const config = defineCollection({
      slug: "everything",
      fields: {
        a: { type: "text" },
        b: { type: "select", options: ["x"] },
        c: { type: "number" },
        d: { type: "date" },
        e: { type: "richText" },
        f: { type: "checkbox" },
        g: { type: "relationship", relationTo: "people" },
        h: { type: "array", fields: { label: { type: "text" } } },
        i: { type: "upload" },
        j: { type: "json" },
        k: { type: "group", fields: { city: { type: "text" } } },
      },
      search: { fields: ["a", "e", "i", "j"] },
      versions: { drafts: true },
      realtime: true,
    });
    expect(Object.keys(config.fields)).toHaveLength(11);
  });

  it("requires a non-empty slug", () => {
    rejects({ ...valid, slug: "" }, "Collection config requires a non-empty slug");
    rejects({ ...valid, slug: "   " }, "Collection config requires a non-empty slug");
  });

  it("requires at least one field", () => {
    rejects({ slug: "pages", fields: {} }, 'Collection "pages" must define at least one field');
    rejects({ slug: "pages" }, 'Collection "pages" must define at least one field');
  });

  it("rejects an unrecognized field type", () => {
    rejects(
      { slug: "pages", fields: { body: { type: "markdown" } } },
      'Collection "pages" field "body" has unrecognized type "markdown"',
    );
  });

  it("requires relationTo on a relationship field", () => {
    rejects(
      { slug: "pages", fields: { author: { type: "relationship" } } },
      'Collection "pages" field "author" is a relationship field and requires "relationTo"',
    );
  });

  it("requires an array field to define nested fields", () => {
    const message =
      'Collection "pages" field "blocks" is an array field and must define at least one nested field';
    rejects({ slug: "pages", fields: { blocks: { type: "array", fields: {} } } }, message);
    rejects({ slug: "pages", fields: { blocks: { type: "array" } } }, message);
  });

  it("requires a group field to define nested fields", () => {
    const message =
      'Collection "pages" field "address" is a group field and must define at least one nested field';
    rejects({ slug: "pages", fields: { address: { type: "group", fields: {} } } }, message);
    rejects({ slug: "pages", fields: { address: { type: "group" } } }, message);
  });

  it("validates a group's nested fields and names them by their dotted path", () => {
    rejects(
      {
        slug: "pages",
        fields: {
          address: {
            type: "group",
            fields: { geo: { type: "group", fields: { owner: { type: "relationship" } } } },
          },
        },
      },
      'Collection "pages" field "address.geo.owner" is a relationship field and requires "relationTo"',
    );
    rejects(
      { slug: "pages", fields: { address: { type: "group", fields: { zip: { type: "zip" } } } } },
      'Collection "pages" field "address.zip" has unrecognized type "zip"',
    );
  });

  it("rejects a search field that doesn't exist", () => {
    rejects(
      { ...valid, search: { fields: ["body"] } },
      'Collection "pages" search.fields references unknown field "body"',
    );
  });

  it("rejects a search field of a type that can't be indexed", () => {
    rejects(
      { slug: "pages", fields: { views: { type: "number" } }, search: { fields: ["views"] } },
      'Collection "pages" search.fields field "views" has type "number"',
    );
  });

  it("rejects realtime without draft versioning", () => {
    const message =
      'Collection "pages" sets realtime: true but not versions.drafts. Realtime persists as drafts, so it requires draft versioning';
    rejects({ ...valid, realtime: true }, message);
    rejects({ ...valid, realtime: true, versions: { drafts: false } }, message);
  });

  it("rejects provenance without draft versioning", () => {
    rejects(
      { ...valid, versions: { provenance: true } },
      'Collection "pages" sets versions.provenance but not versions.drafts. Provenance is recorded on draft versions, so it requires draft versioning',
    );
  });
});

describe("defineContentConfig", () => {
  it("returns a plugin-free config as given", () => {
    const config: ContentConfig = { collections: [valid] };
    expect(defineContentConfig(config)).toBe(config);
  });

  it("runs plugins in order, each on the previous one's output", () => {
    const calls: string[] = [];
    const addPosts: LouisePlugin = (config) => {
      calls.push(`first saw ${config.collections.map((c) => c.slug).join(",")}`);
      return {
        ...config,
        collections: [
          ...config.collections,
          { slug: "posts", fields: { title: { type: "text" } } },
        ],
      };
    };
    const labelAll: LouisePlugin = (config) => {
      calls.push(`second saw ${config.collections.map((c) => c.slug).join(",")}`);
      return {
        ...config,
        collections: config.collections.map((c) => ({ ...c, admin: { group: "Site" } })),
      };
    };
    const input: ContentConfig = { collections: [valid], plugins: [addPosts, labelAll] };
    const resolved = defineContentConfig(input);
    expect(calls).toEqual(["first saw pages", "second saw pages,posts"]);
    expect(resolved.collections.map((c) => [c.slug, c.admin?.group])).toEqual([
      ["pages", "Site"],
      ["posts", "Site"],
    ]);
    // The input stays as written.
    expect(input.collections).toEqual([valid]);
  });

  it("holds a plugin's output to the same rules as hand-written config", () => {
    const broken: LouisePlugin = (config) => ({
      ...config,
      collections: [...config.collections, { slug: "bad", fields: {} }],
    });
    expect(() => defineContentConfig({ collections: [valid], plugins: [broken] })).toThrow(
      'Collection "bad" must define at least one field',
    );
  });

  it("rejects duplicate slugs, including one a plugin adds", () => {
    expect(() => defineContentConfig({ collections: [valid, { ...valid }] })).toThrow(
      'Duplicate collection slug "pages": collection slugs must be unique',
    );
    const again: LouisePlugin = (config) => ({
      ...config,
      collections: [...config.collections, valid],
    });
    expect(() => defineContentConfig({ collections: [valid], plugins: [again] })).toThrow(
      LouiseContentError,
    );
  });

  it("accepts an empty collection list", () => {
    expect(defineContentConfig({ collections: [] }).collections).toEqual([]);
  });
});
