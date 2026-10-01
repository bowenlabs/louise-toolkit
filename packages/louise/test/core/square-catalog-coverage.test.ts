// core/commerce/square—catalog reads and writes: the detailed extraction,
// categories, modifier lists, single and batch upserts, image upload, and the
// read-modify-write guard, against a stubbed fetch (#695).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  batchUpsertCatalogObjects,
  type CatalogItemInput,
  createCatalogImage,
  listCatalogDetailed,
  listCategories,
  listModifierLists,
  readModifyWriteCatalog,
  retrieveCatalogItem,
  retrieveVariationPrices,
  upsertCatalogItem,
} from "../../src/core/commerce/square.js";

const CONFIG = { accessToken: "tok", environment: "sandbox" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

/** Stub fetch with a fake Square; `answer` sees each call and its index. */
function square(answer: (call: Call, index: number) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      const call = {
        method: String(init.method),
        path: url.pathname,
        search: url.search,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return new Response(JSON.stringify(answer(call, calls.length - 1)), { status: 200 });
    }),
  );
  return calls;
}

const answer = (body: unknown) => square(() => body);

afterEach(() => vi.unstubAllGlobals());

describe("listCatalogDetailed", () => {
  it("extracts categories, the reporting category, and enabled modifier bounds across pages", async () => {
    const pages = [
      {
        objects: [
          {
            id: "ITEM1",
            type: "ITEM",
            item_data: {
              name: "Latte",
              image_ids: ["IMG1"],
              categories: [{ id: "CAT_DRINKS" }, {}, { id: "CAT_HOT" }],
              reporting_category: { id: "CAT_DRINKS" },
              modifier_list_info: [
                // Square's -1 means "unset": normalized to 0.
                {
                  modifier_list_id: "ML_MILK",
                  min_selected_modifiers: -1,
                  max_selected_modifiers: -1,
                },
                {
                  modifier_list_id: "ML_SHOTS",
                  min_selected_modifiers: 1,
                  max_selected_modifiers: 3,
                },
                { modifier_list_id: "ML_OFF", enabled: false },
                { min_selected_modifiers: 1 },
              ],
            },
          },
          { id: "CAT1", type: "CATEGORY" },
          { id: "ITEM_GONE", type: "ITEM", is_deleted: true, item_data: { name: "Gone" } },
          {
            id: "ITEM_ARCHIVED",
            type: "ITEM",
            item_data: { name: "Archived", is_archived: true, categories: [{ id: "CAT_HOT" }] },
          },
        ],
        related_objects: [
          { id: "IMG1", type: "IMAGE", image_data: { url: "https://example.com/latte.jpg" } },
          { id: "IMG2", type: "IMAGE", image_data: {} },
          { id: "CAT_DRINKS", type: "CATEGORY" },
        ],
        cursor: "PAGE2",
      },
      { objects: [{ id: "ITEM2", type: "ITEM" }] },
    ];
    const calls = square((_call, i) => pages[i]);
    const detailed = await listCatalogDetailed(CONFIG);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/catalog/search" });
    expect(calls[0]?.body).toEqual({
      object_types: ["ITEM"],
      include_related_objects: true,
      include_deleted_objects: false,
    });
    expect(calls[1]?.body).toMatchObject({ cursor: "PAGE2" });

    expect(detailed.items.map((i) => i.id)).toEqual(["ITEM1", "ITEM2"]);
    expect(detailed.items[0]?.imageUrl).toBe("https://example.com/latte.jpg");
    expect(detailed.itemCategories).toEqual({ ITEM1: ["CAT_DRINKS", "CAT_HOT"] });
    expect(detailed.reportingCategory).toEqual({ ITEM1: "CAT_DRINKS" });
    expect(detailed.itemModifiers).toEqual({
      ITEM1: [
        { id: "ML_MILK", min: 0, max: 0 },
        { id: "ML_SHOTS", min: 1, max: 3 },
      ],
    });
  });

  it("answers an empty catalog when Square returns no objects", async () => {
    answer({});
    expect(await listCatalogDetailed(CONFIG)).toEqual({
      items: [],
      itemCategories: {},
      reportingCategory: {},
      itemModifiers: {},
    });
  });
});

describe("listCategories", () => {
  it("keeps REGULAR categories only, with a slug, parent, and ordinal", async () => {
    const pages = [
      {
        objects: [
          {
            id: "CAT_TEA",
            type: "CATEGORY",
            category_data: {
              name: "  Hot Drinks & Tea!  ",
              category_type: "REGULAR_CATEGORY",
              is_top_level: true,
              ordinal: 2,
            },
          },
          {
            id: "CAT_GREEN",
            type: "CATEGORY",
            // No category_type: an older category, treated as REGULAR.
            category_data: { name: "Green", parent_category: { id: "CAT_TEA", ordinal: 5 } },
          },
          { id: "CAT_MENU", type: "CATEGORY", category_data: { category_type: "MENU_CATEGORY" } },
          { id: "CAT_OLD", type: "CATEGORY", is_deleted: true, category_data: { name: "Old" } },
          { id: "CAT_BARE", type: "CATEGORY" },
          { id: "ITEM1", type: "ITEM", category_data: { name: "Not a category" } },
        ],
        cursor: "PAGE2",
      },
      { objects: [{ id: "CAT_EMPTY", type: "CATEGORY", category_data: {} }] },
    ];
    const calls = square((_call, i) => pages[i]);
    const cats = await listCategories(CONFIG);

    expect(calls[0]?.body).toEqual({ object_types: ["CATEGORY"], include_deleted_objects: false });
    expect(calls[1]?.body).toMatchObject({ cursor: "PAGE2" });
    expect(cats).toEqual([
      {
        id: "CAT_TEA",
        name: "  Hot Drinks & Tea!  ",
        slug: "hot-drinks-tea",
        parentId: null,
        isTop: true,
        ordinal: 2,
      },
      {
        id: "CAT_GREEN",
        name: "Green",
        slug: "green",
        parentId: "CAT_TEA",
        isTop: false,
        ordinal: 5,
      },
      { id: "CAT_EMPTY", name: "", slug: "", parentId: null, isTop: false, ordinal: 0 },
    ]);
  });

  it("answers [] when Square returns no objects", async () => {
    answer({});
    expect(await listCategories(CONFIG)).toEqual([]);
  });
});

describe("listModifierLists", () => {
  it("maps each list by id, modifiers in ordinal order, dropping deleted ones", async () => {
    const pages = [
      {
        objects: [
          {
            id: "ML_MILK",
            type: "MODIFIER_LIST",
            modifier_list_data: {
              name: "Milk",
              selection_type: "MULTIPLE",
              modifiers: [
                {
                  id: "MOD_OAT",
                  modifier_data: { name: "Oat", price_money: { amount: 75 }, ordinal: 2 },
                },
                {
                  id: "MOD_WHOLE",
                  modifier_data: { name: "Whole", ordinal: 1, on_by_default: true },
                },
                { id: "MOD_GONE", is_deleted: true, modifier_data: { name: "Gone" } },
                { id: "MOD_BARE" },
                { id: "MOD_NOORD", modifier_data: {} },
              ],
            },
          },
          { id: "ML_OLD", type: "MODIFIER_LIST", is_deleted: true, modifier_list_data: {} },
          { id: "ML_BARE", type: "MODIFIER_LIST" },
          { id: "ITEM1", type: "ITEM", modifier_list_data: {} },
        ],
        cursor: "PAGE2",
      },
      { objects: [{ id: "ML_SIZE", type: "MODIFIER_LIST", modifier_list_data: {} }] },
    ];
    const calls = square((_call, i) => pages[i]);
    const lists = await listModifierLists(CONFIG);

    expect(calls[0]?.body).toEqual({
      object_types: ["MODIFIER_LIST"],
      include_deleted_objects: false,
    });
    expect(calls[1]?.body).toMatchObject({ cursor: "PAGE2" });
    expect(lists).toEqual({
      ML_MILK: {
        id: "ML_MILK",
        name: "Milk",
        selectionType: "MULTIPLE",
        modifiers: [
          { id: "MOD_NOORD", name: "", priceCents: 0 },
          { id: "MOD_WHOLE", name: "Whole", priceCents: 0, onByDefault: true },
          { id: "MOD_OAT", name: "Oat", priceCents: 75 },
        ],
      },
      // No selection type: SINGLE, Square's default.
      ML_SIZE: { id: "ML_SIZE", name: "", selectionType: "SINGLE", modifiers: [] },
    });
  });

  it("answers {} when Square returns no objects", async () => {
    answer({});
    expect(await listModifierLists(CONFIG)).toEqual({});
  });
});

describe("upsertCatalogItem", () => {
  it("serializes presence, per-location overrides, and imagery for item and variations", async () => {
    const calls = answer({
      catalog_object: { id: "ITEM1", type: "ITEM" },
      id_mappings: [
        { client_object_id: "latte-12", object_id: "VAR_REAL" },
        { client_object_id: "#orphan" },
        { object_id: "NO_CLIENT" },
      ],
    });
    const { idMappings } = await upsertCatalogItem(CONFIG, {
      name: "Latte",
      description: "Espresso and steamed milk",
      imageIds: ["IMG1"],
      categoryIds: ["CAT_DRINKS"],
      reportingCategoryId: "CAT_DRINKS",
      presence: {
        presentAtAllLocations: false,
        presentAtLocationIds: ["L1", "L2"],
        absentAtLocationIds: [],
      },
      variations: [
        {
          clientId: "latte-12",
          name: "12 oz",
          sku: "LAT-12",
          priceCents: 450,
          currency: "USD",
          presence: { presentAtLocationIds: ["L1"] },
          locationOverrides: [
            { locationId: "L1", priceCents: 500 },
            { locationId: "L2", priceCents: 550, currency: "CAD", trackInventory: true },
            { locationId: "L3", soldOut: true },
          ],
        },
      ],
    });

    const body = calls[0]?.body as { idempotency_key: string; object: unknown };
    expect(body.idempotency_key).toMatch(UUID);
    expect(body.object).toEqual({
      type: "ITEM",
      id: "#item",
      present_at_all_locations: false,
      present_at_location_ids: ["L1", "L2"],
      absent_at_location_ids: [],
      item_data: {
        name: "Latte",
        description: "Espresso and steamed milk",
        image_ids: ["IMG1"],
        categories: [{ id: "CAT_DRINKS" }],
        reporting_category: { id: "CAT_DRINKS" },
        variations: [
          {
            type: "ITEM_VARIATION",
            id: "latte-12",
            present_at_location_ids: ["L1"],
            item_variation_data: {
              item_id: "#item",
              name: "12 oz",
              sku: "LAT-12",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: 450, currency: "USD" },
              location_overrides: [
                {
                  location_id: "L1",
                  price_money: { amount: 500, currency: "USD" },
                  pricing_type: "FIXED_PRICING",
                },
                {
                  location_id: "L2",
                  price_money: { amount: 550, currency: "CAD" },
                  pricing_type: "FIXED_PRICING",
                  track_inventory: true,
                },
                // No price: availability only, and no pricing type to override.
                { location_id: "L3", sold_out: true },
              ],
            },
          },
        ],
      },
    });
    // Only complete mappings survive.
    expect(idMappings).toEqual({ "latte-12": "VAR_REAL" });
  });

  it("sends the caller's idempotency key and no overrides key for an empty list", async () => {
    const calls = answer({ catalog_object: { id: "ITEM1", type: "ITEM" } });
    await upsertCatalogItem(CONFIG, {
      name: "Latte",
      idempotencyKey: "push-latte",
      variations: [{ name: "12 oz", priceCents: 450, locationOverrides: [] }],
    });
    const body = calls[0]?.body as {
      idempotency_key: string;
      object: { item_data: { variations: { item_variation_data: object }[] } };
    };
    expect(body.idempotency_key).toBe("push-latte");
    expect(body.object.item_data.variations[0]?.item_variation_data).not.toHaveProperty(
      "location_overrides",
    );
  });

  it("throws when Square answers without the object", async () => {
    answer({});
    await expect(
      upsertCatalogItem(CONFIG, {
        name: "Latte",
        variations: [{ name: "12 oz", priceCents: 450 }],
      }),
    ).rejects.toThrow(/returned no object/);
  });
});

describe("batchUpsertCatalogObjects", () => {
  const item = (i: number): CatalogItemInput => ({
    name: `Item ${i}`,
    variations: [{ name: "Regular", priceCents: 100 + i }],
  });

  it("assigns temporary ids, sends one idempotent request, and maps ITEMs back", async () => {
    const calls = answer({
      objects: [
        { id: "ITEM_A", type: "ITEM", item_data: { name: "Beans" } },
        { id: "VAR_A", type: "ITEM_VARIATION" },
      ],
      id_mappings: [
        { client_object_id: "beans", object_id: "ITEM_A" },
        { client_object_id: "#var-0-0", object_id: "VAR_A" },
        { client_object_id: "#incomplete" },
      ],
    });
    const res = await batchUpsertCatalogObjects(
      CONFIG,
      [
        { clientId: "beans", name: "Beans", variations: [{ name: "12 oz", priceCents: 1800 }] },
        {
          id: "ITEM_B",
          version: 4,
          name: "Mug",
          presence: { presentAtAllLocations: true },
          categoryIds: ["CAT_GOODS"],
          variations: [
            { id: "VAR_B", version: 2, name: "Blue", priceCents: 1400, presence: {} },
            { clientId: "mug-red", name: "Red", priceCents: 1400 },
          ],
        },
        {
          name: "Filters",
          description: "Pack of 100",
          variations: [{ name: "Pack", priceCents: 600 }],
        },
      ],
      { idempotencyKey: "catalog-push-1" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/catalog/batch-upsert" });
    const body = calls[0]?.body as {
      idempotency_key: string;
      batches: { objects: Record<string, unknown>[] }[];
    };
    expect(body.idempotency_key).toBe("catalog-push-1");
    // Three items, seven objects with their variations: one batch (#700).
    expect(body.batches).toHaveLength(1);
    const [beans, mug, filters] = body.batches[0]?.objects ?? [];
    expect(beans).toEqual({
      type: "ITEM",
      id: "beans",
      item_data: {
        name: "Beans",
        variations: [
          {
            type: "ITEM_VARIATION",
            id: "#var-0-0",
            item_variation_data: {
              item_id: "beans",
              name: "12 oz",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: 1800, currency: "USD" },
            },
          },
        ],
      },
    });
    expect(mug).toMatchObject({
      id: "ITEM_B",
      version: 4,
      present_at_all_locations: true,
      item_data: {
        categories: [{ id: "CAT_GOODS" }],
        variations: [
          { id: "VAR_B", version: 2, item_variation_data: { item_id: "ITEM_B" } },
          { id: "mug-red", item_variation_data: { item_id: "ITEM_B" } },
        ],
      },
    });
    expect(filters).toMatchObject({
      id: "#item-2",
      item_data: {
        description: "Pack of 100",
        variations: [{ id: "#var-2-0", item_variation_data: { item_id: "#item-2" } }],
      },
    });

    expect(res.idMappings).toEqual({ beans: "ITEM_A", "#var-0-0": "VAR_A" });
    expect(res.objects.map((o) => o.id)).toEqual(["ITEM_A"]);
  });

  it("packs items into one batch while they fit, with a random key by default (#700)", async () => {
    const calls = answer({});
    const res = await batchUpsertCatalogObjects(
      CONFIG,
      Array.from({ length: 25 }, (_, i) => item(i)),
    );
    const body = calls[0]?.body as {
      idempotency_key: string;
      batches: { objects: { id: string }[] }[];
    };
    expect(body.idempotency_key).toMatch(UUID);
    expect(body.batches.map((b) => b.objects.length)).toEqual([25]);
    expect(body.batches.flatMap((b) => b.objects.map((o) => o.id))).toEqual(
      Array.from({ length: 25 }, (_, i) => `#item-${i}`),
    );
    expect(res).toEqual({ idMappings: {}, objects: [] });
  });

  it("refuses the whole batch, before any request, when one item breaks a guard", async () => {
    const calls = answer({});
    await expect(
      batchUpsertCatalogObjects(CONFIG, [
        item(0),
        {
          name: "Beans",
          presence: { presentAtLocationIds: ["L1"] },
          variations: [
            { name: "12 oz", priceCents: 1800, presence: { presentAtLocationIds: ["L2"] } },
          ],
        },
      ]),
    ).rejects.toThrow(/variation "12 oz" is present at L2, where its parent item is not/);
    await expect(
      batchUpsertCatalogObjects(CONFIG, [
        {
          name: "Too many",
          variations: Array.from({ length: 251 }, (_, j) => ({ name: `V${j}`, priceCents: 1 })),
        },
      ]),
    ).rejects.toThrow(/has 251 variations, over Square's cap of 250/);
    expect(calls).toHaveLength(0);
  });
});

describe("createCatalogImage", () => {
  it("names a bare Blob `image`, sends a random key, and maps a missing URL and caption to null", async () => {
    let form: FormData | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string, init: RequestInit) => {
        form = init.body as FormData;
        return new Response(JSON.stringify({ image: { id: "IMG1", type: "IMAGE" } }), {
          status: 200,
        });
      }),
    );
    const image = await createCatalogImage(CONFIG, {
      file: new Blob(["b"], { type: "image/png" }),
    });
    expect(image).toEqual({ id: "IMG1", url: null, caption: null });
    expect((form?.get("image_file") as File).name).toBe("image");
    const request = JSON.parse(String(form?.get("request"))) as Record<string, unknown>;
    expect(request.idempotency_key).toMatch(UUID);
    expect(request).not.toHaveProperty("object_id");
  });

  it("throws when Square answers without an image", async () => {
    answer({});
    await expect(
      createCatalogImage(CONFIG, { file: new Blob(["b"]), idempotencyKey: "img-1" }),
    ).rejects.toThrow(/returned no image/);
  });
});

describe("readModifyWriteCatalog", () => {
  it("throws when the write comes back empty", async () => {
    square((call) =>
      call.method === "GET" ? { object: { id: "VAR1", type: "ITEM_VARIATION", version: 3 } } : {},
    );
    await expect(readModifyWriteCatalog(CONFIG, "VAR1", () => {})).rejects.toThrow(
      /Square catalog write for VAR1 returned none/,
    );
  });

  it("sends the caller's idempotency key on the write", async () => {
    const calls = square((call) =>
      call.method === "GET"
        ? { object: { id: "VAR1", type: "ITEM_VARIATION", version: 3 } }
        : { catalog_object: { id: "VAR1", type: "ITEM_VARIATION", version: 4 } },
    );
    const written = await readModifyWriteCatalog(CONFIG, "VAR1", () => {}, {
      idempotencyKey: "price-VAR1",
    });
    expect((calls[1]?.body as { idempotency_key: string }).idempotency_key).toBe("price-VAR1");
    expect(written.version).toBe(4);
  });
});

describe("retrieveCatalogItem", () => {
  it("GETs the encoded id with related objects and resolves the image", async () => {
    const calls = answer({
      object: { id: "ITEM/1", type: "ITEM", item_data: { name: "Latte", image_ids: ["IMG1"] } },
      related_objects: [
        { id: "IMG1", type: "IMAGE", image_data: { url: "https://example.com/latte.jpg" } },
      ],
    });
    const item = await retrieveCatalogItem(CONFIG, "ITEM/1");
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/v2/catalog/object/ITEM%2F1",
      search: "?include_related_objects=true",
    });
    expect(item).toMatchObject({
      id: "ITEM/1",
      name: "Latte",
      imageUrl: "https://example.com/latte.jpg",
    });
  });

  it.each([
    ["no object", {}],
    ["an object that isn't an ITEM", { object: { id: "VAR1", type: "ITEM_VARIATION" } }],
  ])("answers null for %s", async (_name, body) => {
    answer(body);
    expect(await retrieveCatalogItem(CONFIG, "X")).toBeNull();
  });
});

describe("retrieveVariationPrices", () => {
  it("maps each ITEM_VARIATION to its base price and skips everything else", async () => {
    const calls = answer({
      objects: [
        {
          id: "VAR1",
          type: "ITEM_VARIATION",
          item_variation_data: { price_money: { amount: 450, currency: "USD" } },
        },
        { id: "VAR2", type: "ITEM_VARIATION" },
        { id: "ITEM1", type: "ITEM" },
      ],
    });
    const prices = await retrieveVariationPrices(CONFIG, ["VAR1", "VAR2", "ITEM1"]);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/catalog/batch-retrieve" });
    expect(calls[0]?.body).toEqual({
      object_ids: ["VAR1", "VAR2", "ITEM1"],
      include_related_objects: true,
    });
    expect([...prices]).toEqual([
      ["VAR1", { amount: 450, currency: "USD" }],
      ["VAR2", { amount: 0, currency: null }],
    ]);
  });

  it("keeps the currency Square sends and leaves a missing one null, never a guess", async () => {
    answer({
      objects: [
        {
          id: "VAR-EUR",
          type: "ITEM_VARIATION",
          item_variation_data: { price_money: { amount: 450, currency: "EUR" } },
        },
        {
          id: "VAR-NONE",
          type: "ITEM_VARIATION",
          item_variation_data: { price_money: { amount: 300 } },
        },
      ],
    });
    const prices = await retrieveVariationPrices(CONFIG, ["VAR-EUR", "VAR-NONE"]);
    expect(prices.get("VAR-EUR")).toEqual({ amount: 450, currency: "EUR" });
    expect(prices.get("VAR-NONE")).toEqual({ amount: 300, currency: null });
  });

  it("omits a variation whose parent item is archived", async () => {
    answer({
      objects: [
        {
          id: "VAR_LIVE",
          type: "ITEM_VARIATION",
          item_variation_data: { item_id: "ITEM_LIVE", price_money: { amount: 450 } },
        },
        {
          id: "VAR_ARCHIVED",
          type: "ITEM_VARIATION",
          item_variation_data: { item_id: "ITEM_ARCHIVED", price_money: { amount: 500 } },
        },
      ],
      related_objects: [
        { id: "ITEM_LIVE", type: "ITEM", item_data: { name: "Latte" } },
        { id: "ITEM_ARCHIVED", type: "ITEM", item_data: { name: "Mocha", is_archived: true } },
      ],
    });
    const prices = await retrieveVariationPrices(CONFIG, ["VAR_LIVE", "VAR_ARCHIVED"]);
    expect([...prices.keys()]).toEqual(["VAR_LIVE"]);
  });

  it("answers an empty map when Square returns no objects", async () => {
    answer({});
    expect((await retrieveVariationPrices(CONFIG, ["VAR1"])).size).toBe(0);
  });
});
