import { describe, expect, it } from "vitest";
import { defineCatalogLoader } from "../src/catalog.js";

// `defineCatalogLoader`: a catalog as an Astro live collection, with a cache hint
// per entry and a read failure as a loader error, never a 500.

interface Product {
  slug: string;
  name: string;
}

const coffee: Product = { slug: "house-blend", name: "House blend" };
const tea: Product = { slug: "green-tea", name: "Green tea" };

function loader(overrides: Partial<Parameters<typeof defineCatalogLoader<Product>>[0]> = {}) {
  return defineCatalogLoader<Product>({
    name: "example-catalog",
    loadCatalog: async () => ({ items: [coffee, tea], fetchedAt: Date.UTC(2026, 0, 2) }),
    loadItem: async (id) => [coffee, tea].find((p) => p.slug === id) ?? null,
    idOf: (p) => p.slug,
    ...overrides,
  });
}

// The loader's own context arguments are unused past `filter`.
const collection = (l: ReturnType<typeof loader>) =>
  l.loadCollection({ filter: undefined } as never) as Promise<Record<string, unknown>>;
const entry = (l: ReturnType<typeof loader>, id: string) =>
  l.loadEntry({ filter: { id } } as never) as Promise<Record<string, unknown> | undefined>;

describe("defineCatalogLoader", () => {
  it("keys each item by its slug, with the snapshot's age as the cache hint", async () => {
    const result = await collection(loader());
    const hint = { tags: ["example-catalog"], lastModified: new Date(Date.UTC(2026, 0, 2)) };
    expect(result).toEqual({
      entries: [
        { id: "house-blend", data: coffee, cacheHint: hint },
        { id: "green-tea", data: tea, cacheHint: hint },
      ],
      cacheHint: hint,
    });
  });

  it("tags with `tag` when given, and leaves out lastModified without a fetch time", async () => {
    const result = await collection(
      loader({ tag: "catalog", loadCatalog: async () => ({ items: [coffee] }) }),
    );
    expect(result.cacheHint).toEqual({ tags: ["catalog"] });
  });

  it("turns a failed catalog read into a loader error", async () => {
    const boom = await collection(
      loader({
        loadCatalog: async () => {
          throw new Error("Square is down");
        },
      }),
    );
    expect((boom.error as Error).message).toBe("Square is down");
    const odd = await collection(
      loader({
        loadCatalog: async () => {
          throw "not an Error";
        },
      }),
    );
    expect((odd.error as Error).message).toBe("example-catalog catalog load failed");
  });

  it("resolves one entry by slug, and nothing for an unknown one", async () => {
    expect(await entry(loader(), "green-tea")).toEqual({
      id: "green-tea",
      data: tea,
      cacheHint: { tags: ["example-catalog"] },
    });
    expect(await entry(loader(), "missing")).toBeUndefined();
  });

  it("turns a failed entry read into a loader error", async () => {
    const result = await entry(
      loader({
        loadItem: async () => {
          throw 42;
        },
      }),
      "house-blend",
    );
    expect((result?.error as Error).message).toBe("example-catalog entry load failed");
  });
});
