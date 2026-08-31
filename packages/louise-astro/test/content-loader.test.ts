import type { LoaderContext } from "astro/loaders";
import { describe, expect, it, vi } from "vitest";
import { collectionToAstroSchema, louiseLoader } from "../src/content-loader.js";
import { defineCollection } from "louise-toolkit/content";

const collection = defineCollection({
  slug: "pages",
  fields: {
    slug: { type: "text", required: true },
    title: { type: "text", required: true },
    body: { type: "text" },
    noindex: { type: "checkbox" },
    sortOrder: { type: "number" },
    kind: { type: "select", options: ["article", "landing"] },
    publishedAt: { type: "date" },
    sections: { type: "json" },
    author: { type: "relationship", relationTo: "users" },
    tags: { type: "relationship", relationTo: "tags", hasMany: true },
    seo: {
      type: "group",
      fields: { title: { type: "text" }, index: { type: "checkbox" } },
    },
  },
});

describe("collectionToAstroSchema", () => {
  const schema = collectionToAstroSchema(collection);

  it("coerces D1 value shapes to the field's type", () => {
    const out = schema.parse({
      slug: "home",
      title: "Home",
      body: "<p>hi</p>",
      noindex: 1, // D1 stores booleans as 0/1
      sortOrder: 3,
      kind: "landing",
      publishedAt: 1_700_000_000_000, // epoch ms
      sections: [{ _type: "hero" }],
      author: 42, // hasMany:false relationship → related id
      seo: { title: "Home | SEO", index: 0 },
    }) as Record<string, unknown>;

    expect(out.noindex).toBe(true);
    expect(out.kind).toBe("landing");
    expect(out.publishedAt).toBeInstanceOf(Date);
    expect(out.author).toBe(42);
    expect(out.sections).toEqual([{ _type: "hero" }]);
    expect(out.seo).toEqual({ title: "Home | SEO", index: false });
  });

  it("drops hasMany relationships (join table, no column) and unknown columns", () => {
    const out = schema.parse({
      slug: "home",
      title: "Home",
      tags: [1, 2, 3], // hasMany → not in schema
      id: 7, // bookkeeping column
      status: "published",
      updated_at: 123,
    }) as Record<string, unknown>;

    expect("tags" in out).toBe(false);
    expect("id" in out).toBe(false);
    expect("status" in out).toBe(false);
  });

  it("makes non-required fields nullable + optional", () => {
    // body/sortOrder/etc. absent, and an explicit null both pass.
    expect(() => schema.parse({ slug: "a", title: "A" })).not.toThrow();
    expect(() => schema.parse({ slug: "a", title: "A", body: null })).not.toThrow();
  });

  it("rejects a row missing a required field", () => {
    expect(() => schema.parse({ title: "no slug" })).toThrow();
  });
});

/**
 * A stand-in for the LoaderContext, recording the store + logger calls
 * `louiseLoader.load` makes. Identity `parseData` — the schema is covered above.
 */
function makeContext() {
  const set = vi.fn(() => true);
  const clear = vi.fn();
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const context = {
    store: { set, clear },
    parseData: async ({ data }: { data: Record<string, unknown> }) => data,
    generateDigest: (data: Record<string, unknown> | string) => `digest:${JSON.stringify(data)}`,
    logger,
  } as unknown as LoaderContext;
  return { context, set, clear, logger };
}

describe("louiseLoader", () => {
  it("defaults the loader name to `louise:<slug>`", () => {
    expect(louiseLoader({ collection, read: async () => [] }).name).toBe("louise:pages");
    expect(louiseLoader({ collection, read: async () => [], name: "custom" }).name).toBe("custom");
  });

  it("clears then repopulates the store, keyed by slug, with a digest", async () => {
    const rows = [
      { slug: "home", title: "Home" },
      { slug: "about", title: "About" },
    ];
    const loader = louiseLoader({ collection, read: async () => rows });
    const { context, set, clear } = makeContext();

    await loader.load(context);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenNthCalledWith(1, {
      id: "home",
      data: rows[0],
      digest: `digest:${JSON.stringify(rows[0])}`,
    });
    expect(set).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "about" }));
  });

  it("honors a custom idOf", async () => {
    const loader = louiseLoader({
      collection,
      read: async () => [{ slug: "home", title: "Home", id: 9 }],
      idOf: (row) => `page-${row.id}`,
    });
    const { context, set } = makeContext();
    await loader.load(context);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ id: "page-9" }));
  });

  it("fails safe on a read error: keeps the store, logs, does not throw", async () => {
    const loader = louiseLoader({
      collection,
      read: async () => {
        throw new Error("d1 unreachable");
      },
    });
    const { context, set, clear, logger } = makeContext();

    await expect(loader.load(context)).resolves.toBeUndefined();
    expect(clear).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
