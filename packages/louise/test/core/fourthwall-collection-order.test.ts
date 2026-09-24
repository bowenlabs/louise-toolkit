import { describe, expect, it } from "vitest";
import { catchAllFirst, isCatchAllCollection } from "../../src/core/commerce/fourthwall.js";

// A sync that upserts a product once per collection it belongs to keeps the
// category of the LAST collection to touch it. Fourthwall returns its catch-all
// last, so on themidwestartist.com every product also filed under Prints or
// Totes ended up categorised "All Products".
//
// Nothing about a single write is wrong, which is why this is a test about
// ORDER and not about any one upsert.
const c = (name: string, slug: string) => ({ collection: { name, slug }, products: [] });
const names = (rows: { collection: { name: string } }[]) => rows.map((r) => r.collection.name);

describe("catchAllFirst", () => {
  it("moves the catch-all ahead of the real collections, so they win the write", () => {
    const out = catchAllFirst([
      c("Prints", "prints"),
      c("Totes", "totes"),
      c("All Products", "all"),
    ]);
    expect(names(out)[0]).toBe("All Products");
    expect(names(out)).toEqual(["All Products", "Prints", "Totes"]);
  });

  it("keeps the real collections in the order Fourthwall gave them", () => {
    // Only the catch-all moves. Anything else reordering would make which
    // category a multi-collection product lands in depend on the sort.
    const out = catchAllFirst([
      c("Buttons", "buttons"),
      c("All Products", "all"),
      c("Stickers", "stickers"),
      c("Prints", "prints"),
    ]);
    expect(names(out)).toEqual(["All Products", "Buttons", "Stickers", "Prints"]);
  });

  it("recognises the catch-all by name when the slug is something else", () => {
    const out = catchAllFirst([c("Prints", "prints"), c("All Products", "everything")]);
    expect(names(out)[0]).toBe("All Products");
  });

  it("recognises the `all-products` slug when the name has been changed", () => {
    const out = catchAllFirst([c("Prints", "prints"), c("Shop All", "all-products")]);
    expect(names(out)[0]).toBe("Shop All");
  });

  it("leaves a store with no catch-all completely alone", () => {
    const rows = [c("Prints", "prints"), c("Totes", "totes"), c("Buttons", "buttons")];
    expect(names(catchAllFirst(rows))).toEqual(["Prints", "Totes", "Buttons"]);
  });

  it("does not mutate the caller's array", () => {
    const rows = [c("Prints", "prints"), c("All Products", "all")];
    catchAllFirst(rows);
    expect(names(rows)).toEqual(["Prints", "All Products"]);
  });

  it("handles an empty catalog", () => {
    expect(catchAllFirst([])).toEqual([]);
  });
});

describe("isCatchAllCollection", () => {
  it("knows the catch-all by slug or by name, and nothing else", () => {
    expect(isCatchAllCollection({ slug: "all", name: "Everything" })).toBe(true);
    expect(isCatchAllCollection({ slug: "all-products", name: "Shop" })).toBe(true);
    expect(isCatchAllCollection({ slug: "x", name: " All Products " })).toBe(true);
    expect(isCatchAllCollection({ slug: "prints", name: "Prints" })).toBe(false);
    expect(isCatchAllCollection({ slug: "all-prints", name: "All prints" })).toBe(false);
  });
});
