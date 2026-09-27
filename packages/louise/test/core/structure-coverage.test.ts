import { describe, expect, it } from "vitest";
import {
  buildEditorStructure,
  type CollectionConfig,
  DEFAULT_EDITOR_GROUP,
} from "../../src/core/content/index.js";

// The Structure Builder in core/content/structure.ts (#695): the editor
// sidebar derived from each collection's `admin` hints plus call-site
// overrides, in a deterministic order.

const collection = (slug: string, admin?: CollectionConfig["admin"]): CollectionConfig => ({
  slug,
  fields: { title: { type: "text" } },
  ...(admin ? { admin } : {}),
});

describe("buildEditorStructure", () => {
  it("puts an unconfigured collection in the default group with defaults", () => {
    expect(buildEditorStructure({ collections: [collection("pages")] })).toEqual([
      {
        title: DEFAULT_EDITOR_GROUP,
        items: [
          {
            slug: "pages",
            label: "Pages",
            href: "/admin/pages",
            readOnly: false,
            singleton: false,
          },
        ],
      },
    ]);
    expect(DEFAULT_EDITOR_GROUP).toBe("Content");
  });

  it("applies the collection's own label, icon, read-only, and singleton hints", () => {
    const [group] = buildEditorStructure({
      collections: [
        collection("settings", {
          label: "Site settings",
          icon: "gear",
          readOnly: true,
          singleton: true,
        }),
      ],
    });
    expect(group.items).toEqual([
      {
        slug: "settings",
        label: "Site settings",
        href: "/admin/settings",
        readOnly: true,
        singleton: true,
        icon: "gear",
      },
    ]);
  });

  it("drops hidden collections, and a group left empty disappears", () => {
    const structure = buildEditorStructure({
      collections: [
        collection("pages"),
        collection("webhook_events", { hidden: true, group: "Logs" }),
      ],
    });
    expect(structure.map((g) => g.title)).toEqual(["Content"]);
    expect(structure[0].items.map((i) => i.slug)).toEqual(["pages"]);
  });

  it("sorts by order, puts unordered items last, and breaks ties by config position", () => {
    const [group] = buildEditorStructure({
      collections: [
        collection("a"),
        collection("b", { order: 2 }),
        collection("c"),
        collection("d", { order: 1 }),
        collection("e", { order: 2 }),
      ],
    });
    expect(group.items.map((i) => i.slug)).toEqual(["d", "b", "e", "a", "c"]);
  });

  it("orders groups by first appearance when no group order is given", () => {
    const structure = buildEditorStructure({
      collections: [
        collection("products", { group: "Store" }),
        collection("pages"),
        collection("orders", { group: "Store" }),
      ],
    });
    expect(structure.map((g) => [g.title, g.items.map((i) => i.slug)])).toEqual([
      ["Store", ["products", "orders"]],
      ["Content", ["pages"]],
    ]);
  });

  it("puts groups named in groupOrder first and skips names with no collections", () => {
    const structure = buildEditorStructure(
      {
        collections: [
          collection("pages"),
          collection("products", { group: "Store" }),
          collection("people", { group: "Team" }),
        ],
      },
      { groupOrder: ["Team", "Missing", "Content"] },
    );
    expect(structure.map((g) => g.title)).toEqual(["Team", "Content", "Store"]);
  });

  it("merges per-slug overrides over the collection's admin block", () => {
    const structure = buildEditorStructure(
      {
        collections: [
          collection("products", { group: "Catalog", label: "Items", order: 5 }),
          collection("payments"),
          collection("webhook_events"),
        ],
      },
      {
        overrides: {
          products: { group: "Store" },
          payments: { group: "Store", readOnly: true, order: 1 },
          webhook_events: { hidden: true },
        },
      },
    );
    expect(structure).toEqual([
      {
        title: "Store",
        items: [
          {
            slug: "payments",
            label: "Payments",
            href: "/admin/payments",
            readOnly: true,
            singleton: false,
          },
          // The override's group wins; the collection's own label and order stay.
          {
            slug: "products",
            label: "Items",
            href: "/admin/products",
            readOnly: false,
            singleton: false,
          },
        ],
      },
    ]);
  });

  it("builds hrefs from a custom base path", () => {
    const [group] = buildEditorStructure(
      { collections: [collection("pages")] },
      { basePath: "/studio" },
    );
    expect(group.items[0].href).toBe("/studio/pages");
  });

  it("leaves an empty slug's label empty rather than failing", () => {
    const [group] = buildEditorStructure({ collections: [collection("")] });
    expect(group.items[0].label).toBe("");
  });

  it("returns no groups for a config with no collections", () => {
    expect(buildEditorStructure({ collections: [] })).toEqual([]);
  });
});
