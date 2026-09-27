// core/commerce/square/menu—menu tabs from the category tree, with hidden
// items, the sold-out rule, zero prices, and modifier bounds (#715).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMenuTabs,
  type DetailedCatalog,
  type MenuCatalog,
  type SquareCatalogItem,
  type SquareCategory,
  type SquareInventoryCount,
  type SquareModifierList,
  type SquareVariation,
} from "../../src/core/commerce/square.js";

const PRESENT = { presentAtAllLocations: true, presentAtLocationIds: [], absentAtLocationIds: [] };

function variation(id: string, priceCents: number, extra: Partial<SquareVariation> = {}) {
  return {
    ...PRESENT,
    id,
    name: id,
    sku: null,
    priceCents,
    currency: "USD",
    locationOverrides: [],
    version: 1,
    ...extra,
  } satisfies SquareVariation;
}

function item(id: string, variations: SquareVariation[]): SquareCatalogItem {
  return {
    ...PRESENT,
    id,
    name: `Item ${id}`,
    description: "",
    imageUrl: null,
    images: [],
    variations,
    version: 1,
  };
}

function category(id: string, parentId: string | null, ordinal = 0): SquareCategory {
  return { id, name: `Cat ${id}`, slug: `cat-${id}`, parentId, isTop: parentId === null, ordinal };
}

function count(
  catalogObjectId: string,
  quantity: number,
  extra: Partial<SquareInventoryCount> = {},
) {
  return { catalogObjectId, quantity, state: "IN_STOCK", locationId: "L1", ...extra };
}

// Drinks (top) → Hot (ordinal 2) → Tea (grandchild), and Cold (ordinal 1).
// Food (top) has no subcategories. Merch is top level but never chosen.
const CATEGORIES = [
  category("drinks", null, 0),
  category("hot", "drinks", 2),
  category("tea", "hot", 0),
  category("cold", "drinks", 1),
  category("food", null, 1),
  category("merch", null, 2),
];

function menu(
  items: [SquareCatalogItem, string[]][],
  extra: Partial<Omit<MenuCatalog, "catalog">> & Partial<DetailedCatalog> = {},
): MenuCatalog {
  const { categories = CATEGORIES, modifierLists = {}, counts = [], itemModifiers = {} } = extra;
  return {
    catalog: {
      items: items.map(([i]) => i),
      itemCategories: Object.fromEntries(items.map(([i, cats]) => [i.id, cats])),
      reportingCategory: {},
      itemModifiers,
    },
    categories,
    modifierLists,
    counts,
  };
}

const tabIds = (tabs: ReturnType<typeof buildMenuTabs>) =>
  tabs.map((t) => [t.id, t.items.map((i) => i.id)]);

describe("buildMenuTabs grouping", () => {
  const input = menu([
    [item("latte", [variation("latte-v", 450)]), ["hot"]],
    [item("chai", [variation("chai-v", 400)]), ["tea"]],
    [item("iced", [variation("iced-v", 425)]), ["cold"]],
    [item("water", [variation("water-v", 200)]), ["drinks"]],
    [item("both", [variation("both-v", 500)]), ["hot", "cold"]],
    [item("bagel", [variation("bagel-v", 500)]), ["food"]],
    [item("mug", [variation("mug-v", 1800)]), ["merch"]],
    [item("loose", [variation("loose-v", 100)]), []],
  ]);

  it("makes a tab per subcategory in ordinal order, then a trailing tab for direct items", () => {
    expect(tabIds(buildMenuTabs(input, { categoryIds: ["drinks"] }))).toEqual([
      ["cold", ["iced", "both"]],
      ["hot", ["latte", "chai", "both"]], // chai sits two levels down, under Tea
      ["drinks", ["water"]],
    ]);
  });

  it("gives a top-level category with no subcategories one tab, in the chosen order", () => {
    expect(tabIds(buildMenuTabs(input, { categoryIds: ["food", "drinks"] }))).toEqual([
      ["food", ["bagel"]],
      ["cold", ["iced", "both"]],
      ["hot", ["latte", "chai", "both"]],
      ["drinks", ["water"]],
    ]);
  });

  it("carries the category's name and slug on each tab", () => {
    const [food] = buildMenuTabs(input, { categoryIds: ["food"] });
    expect(food).toMatchObject({ id: "food", name: "Cat food", slug: "cat-food" });
  });

  it("is an empty menu when no category is chosen, rather than a guess", () => {
    expect(buildMenuTabs(input, { categoryIds: [] })).toEqual([]);
  });

  it("skips a chosen id that isn't a top-level category, or isn't in the tree", () => {
    expect(tabIds(buildMenuTabs(input, { categoryIds: ["hot", "gone", "food"] }))).toEqual([
      ["food", ["bagel"]],
    ]);
  });

  it("leaves out a tab with no items", () => {
    const sparse = menu([[item("water", [variation("water-v", 200)]), ["drinks"]]]);
    expect(tabIds(buildMenuTabs(sparse, { categoryIds: ["drinks"] }))).toEqual([
      ["drinks", ["water"]],
    ]);
  });
});

describe("buildMenuTabs items", () => {
  it("leaves hidden items off every tab", () => {
    const input = menu([
      [item("latte", [variation("latte-v", 450)]), ["hot"]],
      [item("secret", [variation("secret-v", 450)]), ["hot", "drinks"]],
    ]);
    expect(
      tabIds(buildMenuTabs(input, { categoryIds: ["drinks"], hiddenItemIds: ["secret"] })),
    ).toEqual([["hot", ["latte"]]]);
  });

  it("drops a zero-priced variation, and an item with no priced variation left", () => {
    const input = menu([
      [item("drip", [variation("drip-sm", 300), variation("drip-open", 0)]), ["food"]],
      [item("market", [variation("market-v", 0)]), ["food"]],
    ]);
    const [tab] = buildMenuTabs(input, { categoryIds: ["food"] });
    expect(tab?.items.map((i) => [i.id, i.variations.map((v) => v.id)])).toEqual([
      ["drip", ["drip-sm"]],
    ]);
  });

  describe("sold out", () => {
    const two = item("scone", [variation("scone-a", 400), variation("scone-b", 400)]);
    const soldOut = (counts: SquareInventoryCount[], locationId?: string) =>
      buildMenuTabs(menu([[two, ["food"]]], { counts }), {
        categoryIds: ["food"],
        ...(locationId ? { locationId } : {}),
      })[0]?.items[0]?.soldOut;

    it("is sold out when every variation is tracked and at zero or below", () => {
      expect(soldOut([count("scone-a", 0), count("scone-b", -2)])).toBe(true);
    });

    it("isn't sold out while one variation has stock", () => {
      expect(soldOut([count("scone-a", 0), count("scone-b", 3)])).toBe(false);
    });

    it("isn't sold out when a variation is untracked, even with the rest at zero", () => {
      expect(soldOut([count("scone-a", 0)])).toBe(false);
    });

    it("isn't sold out with no stock data at all", () => {
      expect(soldOut([])).toBe(false);
    });

    it("reads only IN_STOCK counts", () => {
      expect(soldOut([count("scone-a", 5, { state: "SOLD" }), count("scone-b", 0)])).toBe(false);
      expect(
        soldOut([
          count("scone-a", 0),
          count("scone-a", 9, { state: "WASTE" }),
          count("scone-b", 0),
        ]),
      ).toBe(true);
    });

    it("adds counts across locations, or reads one location when given", () => {
      const counts = [
        count("scone-a", 0),
        count("scone-a", 4, { locationId: "L2" }),
        count("scone-b", 0),
      ];
      expect(soldOut(counts)).toBe(false);
      expect(soldOut(counts, "L1")).toBe(true);
    });

    it("reports each variation's stock, or null when untracked", () => {
      const [tab] = buildMenuTabs(menu([[two, ["food"]]], { counts: [count("scone-a", 7)] }), {
        categoryIds: ["food"],
      });
      expect(tab?.items[0]?.variations.map((v) => v.stock)).toEqual([7, null]);
    });
  });

  it("prices a variation at the chosen location, where an override wins", () => {
    const priced = item("latte", [
      variation("latte-v", 450, {
        locationOverrides: [
          {
            locationId: "L2",
            priceCents: 500,
            currency: "USD",
            trackInventory: null,
            soldOut: null,
          },
        ],
      }),
    ]);
    const price = (locationId?: string) =>
      buildMenuTabs(menu([[priced, ["food"]]]), {
        categoryIds: ["food"],
        ...(locationId ? { locationId } : {}),
      })[0]?.items[0]?.variations[0]?.priceCents;
    expect(price()).toBe(450);
    expect(price("L1")).toBe(450);
    expect(price("L2")).toBe(500);
  });

  it("takes each modifier list's min and max from the item's ref, not the list", () => {
    const milk: SquareModifierList = {
      id: "milk",
      name: "Milk",
      selectionType: "SINGLE",
      modifiers: [{ id: "oat", name: "Oat", priceCents: 75 }],
    };
    const empty: SquareModifierList = { ...milk, id: "empty", modifiers: [] };
    const input = menu(
      [
        [item("latte", [variation("latte-v", 450)]), ["food"]],
        [item("cortado", [variation("cortado-v", 400)]), ["food"]],
      ],
      {
        modifierLists: { milk, empty },
        itemModifiers: {
          latte: [
            { id: "milk", min: 1, max: 1 },
            { id: "empty", min: 0, max: 0 }, // resolves to no modifiers: dropped
            { id: "gone", min: 0, max: 0 }, // not in the lists: dropped
          ],
          cortado: [{ id: "milk", min: 0, max: 2 }],
        },
      },
    );
    const [tab] = buildMenuTabs(input, { categoryIds: ["food"] });
    expect(tab?.items.map((i) => i.modifierLists)).toEqual([
      [{ ...milk, min: 1, max: 1 }],
      [{ ...milk, min: 0, max: 2 }],
    ]);
  });

  it("makes no Square call", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    buildMenuTabs(menu([[item("latte", [variation("latte-v", 450)]), ["hot"]]]), {
      categoryIds: ["drinks"],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
