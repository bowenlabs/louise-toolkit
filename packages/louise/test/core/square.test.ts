import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquareOrderLineItem } from "../../src/core/commerce/square.js";
import {
  calculateOrder,
  centsToMajor,
  createCatalogImage,
  createInvoice,
  createLocation,
  createOrder,
  createTeamMember,
  createTimecard,
  listCatalogItems,
  listLocations,
  mapCatalogItem,
  presentAt,
  priceAtLocation,
  readModifyWriteCatalog,
  publishInvoice,
  retrieveLocation,
  retrieveVariationPricesAt,
  updateLocation,
  searchOrders,
  setPhysicalCount,
  updateTimecard,
  upsertCatalogItem,
  verifySquareSignature,
} from "../../src/core/commerce/square.js";

const CONFIG = { accessToken: "tok", environment: "sandbox" } as const;

/** Stub global fetch to return `json` once, capturing each request's method,
 *  url, and parsed body — the shared shape the write-path tests assert against. */
function stubFetch(json: unknown): { url: string; method: string; body: unknown }[] {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: String(init.method),
        body: JSON.parse(String(init.body ?? "null")),
      });
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

// Reference HMAC-SHA256(base64) of (notificationUrl + body) — computed with the
// same WebCrypto primitives the verifier uses, so the test pins the algorithm
// (concatenation order + base64 encoding) rather than a hand-copied constant.
async function sign(notificationUrl: string, body: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(notificationUrl + body),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

const URL_ = "https://coracle.coffee/api/webhooks/square";
const BODY = JSON.stringify({ type: "payment.updated", data: { object: {} } });
const KEY = "wh-signing-key";

describe("verifySquareSignature", () => {
  it("accepts a signature over notificationUrl + body", async () => {
    const header = await sign(URL_, BODY, KEY);
    expect(await verifySquareSignature(URL_, BODY, header, KEY)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const header = await sign(URL_, BODY, KEY);
    expect(await verifySquareSignature(URL_, BODY + " ", header, KEY)).toBe(false);
  });

  it("rejects a mismatched notification URL (URL is part of the signed message)", async () => {
    const header = await sign(URL_, BODY, KEY);
    expect(await verifySquareSignature("https://evil.example/x", BODY, header, KEY)).toBe(false);
  });

  it("rejects the wrong signing key", async () => {
    const header = await sign(URL_, BODY, "other-key");
    expect(await verifySquareSignature(URL_, BODY, header, KEY)).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    expect(await verifySquareSignature(URL_, BODY, null, KEY)).toBe(false);
  });
});

describe("mapCatalogItem", () => {
  it("normalizes an ITEM with variations and resolves the primary image", () => {
    const images = new Map([["img-1", "https://cdn.square/img-1.jpg"]]);
    const item = mapCatalogItem(
      {
        id: "item-1",
        type: "ITEM",
        version: 3,
        item_data: {
          name: "Harbor Blend",
          description: "House medium roast",
          image_ids: ["img-1"],
          variations: [
            {
              id: "var-1",
              type: "ITEM_VARIATION",
              version: 5,
              item_variation_data: {
                name: "12 oz",
                sku: "HB-12",
                price_money: { amount: 2000, currency: "USD" },
              },
            },
          ],
        },
      },
      images,
    );
    expect(item).toEqual({
      id: "item-1",
      name: "Harbor Blend",
      description: "House medium roast",
      imageUrl: "https://cdn.square/img-1.jpg",
      version: 3,
      // Presence defaults to "sold everywhere" when Square omits the fields,
      // matching Square's own default for present_at_all_locations.
      presentAtAllLocations: true,
      presentAtLocationIds: [],
      absentAtLocationIds: [],
      variations: [
        {
          id: "var-1",
          name: "12 oz",
          sku: "HB-12",
          priceCents: 2000,
          currency: "USD",
          version: 5,
          locationOverrides: [],
          presentAtAllLocations: true,
          presentAtLocationIds: [],
          absentAtLocationIds: [],
        },
      ],
    });
  });

  it("falls back to null image and empty variations when absent", () => {
    const item = mapCatalogItem(
      { id: "item-2", type: "ITEM", item_data: { name: "Gift Card" } },
      new Map(),
    );
    expect(item.imageUrl).toBeNull();
    expect(item.variations).toEqual([]);
  });
});

describe("centsToMajor", () => {
  it("converts minor units to whole currency", () => {
    expect(centsToMajor(2500)).toBe(25);
    expect(centsToMajor(0)).toBe(0);
  });
});

describe("listCatalogItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression for #58: the SearchCatalogObjects endpoint is `/v2/catalog/search`,
  // not `/v2/catalog/search-catalog-objects` (which 404s "Resource not found").
  it("POSTs to /v2/catalog/search and walks the cursor", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const pages: Record<string, unknown> = {
      first: {
        objects: [
          { id: "item-1", type: "ITEM", item_data: { name: "Harbor Blend" } },
          { id: "cat-x", type: "CATEGORY" }, // non-ITEM: ignored
        ],
        cursor: "PAGE2",
      },
      PAGE2: {
        objects: [
          { id: "item-2", type: "ITEM", is_deleted: true, item_data: { name: "Retired" } }, // deleted: ignored
          { id: "item-3", type: "ITEM", item_data: { name: "Night Roast" } },
        ],
      },
    };
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { cursor?: string };
      calls.push({ url, body });
      const page = body.cursor ?? "first";
      return new Response(JSON.stringify(pages[page]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const items = await listCatalogItems({ accessToken: "tok", environment: "sandbox" });

    // Every request hit the real SearchCatalogObjects path on the sandbox host.
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.url).toBe("https://connect.squareupsandbox.com/v2/catalog/search");
    }
    // Cursor from page 1 was forwarded to page 2.
    expect(calls[1]?.body).toMatchObject({ cursor: "PAGE2" });
    // Only non-deleted ITEMs are mapped, across both pages.
    expect(items.map((i) => i.id)).toEqual(["item-1", "item-3"]);
  });
});

describe("upsertCatalogItem", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs an ITEM with fixed-price variations and returns the id mappings", async () => {
    const calls = stubFetch({
      catalog_object: {
        id: "ITEM_REAL",
        type: "ITEM",
        item_data: {
          name: "Harbor Blend",
          variations: [
            {
              id: "VAR_REAL",
              type: "ITEM_VARIATION",
              item_variation_data: {
                name: "12 oz",
                price_money: { amount: 2000, currency: "USD" },
              },
            },
          ],
        },
      },
      id_mappings: [
        { client_object_id: "#item", object_id: "ITEM_REAL" },
        { client_object_id: "#var-0", object_id: "VAR_REAL" },
      ],
    });

    const { item, idMappings } = await upsertCatalogItem(CONFIG, {
      name: "Harbor Blend",
      variations: [{ name: "12 oz", priceCents: 2000 }],
    });

    expect(calls[0]?.url).toBe("https://connect.squareupsandbox.com/v2/catalog/object");
    expect(calls[0]?.method).toBe("POST");
    // A new item + variation use temp ids and FIXED_PRICING at the given price.
    expect(calls[0]?.body).toMatchObject({
      object: {
        type: "ITEM",
        id: "#item",
        item_data: {
          name: "Harbor Blend",
          variations: [
            {
              id: "#var-0",
              item_variation_data: {
                item_id: "#item",
                pricing_type: "FIXED_PRICING",
                price_money: { amount: 2000, currency: "USD" },
              },
            },
          ],
        },
      },
    });
    // Response mapped to the real ids Square assigned, plus the temp→real map.
    expect(item.id).toBe("ITEM_REAL");
    expect(item.variations[0]?.id).toBe("VAR_REAL");
    expect(idMappings).toEqual({ "#item": "ITEM_REAL", "#var-0": "VAR_REAL" });
  });

  it("passes item + variation versions through when updating an existing item", async () => {
    const calls = stubFetch({
      catalog_object: { id: "ITEM1", type: "ITEM", item_data: { name: "x" } },
    });
    await upsertCatalogItem(CONFIG, {
      id: "ITEM1",
      name: "x",
      version: 7,
      variations: [{ id: "VAR1", name: "12 oz", priceCents: 2000, version: 3 }],
    });
    expect(calls[0]?.body).toMatchObject({
      object: { id: "ITEM1", version: 7, item_data: { variations: [{ id: "VAR1", version: 3 }] } },
    });
  });

  it("refuses a variation sold where its parent item is not", async () => {
    // Square accepts this and produces a silent partial state: the item renders
    // at L2 with no purchasable variation under it.
    const calls = stubFetch({ catalog_object: { id: "x", type: "ITEM" } });
    await expect(
      upsertCatalogItem(CONFIG, {
        name: "Harbor Blend",
        presence: { presentAtLocationIds: ["L1"] },
        variations: [
          { name: "12 oz", priceCents: 2000, presence: { presentAtLocationIds: ["L1", "L2"] } },
        ],
      }),
    ).rejects.toThrow(/present at L2, where its parent item is not/);
    // Thrown before the write, not after a 400.
    expect(calls).toHaveLength(0);
  });

  it("allows any variation locations when the item is present everywhere", async () => {
    const calls = stubFetch({ catalog_object: { id: "x", type: "ITEM" } });
    await upsertCatalogItem(CONFIG, {
      name: "Harbor Blend",
      presence: { presentAtAllLocations: true },
      variations: [{ name: "12 oz", priceCents: 2000, presence: { presentAtLocationIds: ["L9"] } }],
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses more than 250 variations, the cap a per-merchant design hits first", async () => {
    const calls = stubFetch({ catalog_object: { id: "x", type: "ITEM" } });
    await expect(
      upsertCatalogItem(CONFIG, {
        name: "Harbor Blend",
        variations: Array.from({ length: 251 }, (_, i) => ({
          name: `v${i}`,
          priceCents: 100,
        })),
      }),
    ).rejects.toThrow(/251 variations, over Square's cap of 250/);
    expect(calls).toHaveLength(0);
  });
});

describe("catalog images and categories", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes image ids and categories onto the item", async () => {
    const calls = stubFetch({ catalog_object: { id: "ITEM1", type: "ITEM" } });
    await upsertCatalogItem(CONFIG, {
      name: "Harbor Blend",
      variations: [{ name: "12 oz", priceCents: 2000 }],
      imageIds: ["IMG1", "IMG2"],
      categoryIds: ["CAT_COFFEE", "CAT_GIFTS"],
      reportingCategoryId: "CAT_COFFEE",
    });
    const body = calls[0]?.body as { object: { item_data: Record<string, unknown> } };
    expect(body.object.item_data.image_ids).toEqual(["IMG1", "IMG2"]);
    expect(body.object.item_data.categories).toEqual([{ id: "CAT_COFFEE" }, { id: "CAT_GIFTS" }]);
    expect(body.object.item_data.reporting_category).toEqual({ id: "CAT_COFFEE" });
  });

  it("omits the keys entirely when unset, so a price update can't strip imagery", async () => {
    // An absent key means "leave it alone"; sending [] would clear it.
    const calls = stubFetch({ catalog_object: { id: "ITEM1", type: "ITEM" } });
    await upsertCatalogItem(CONFIG, {
      name: "Harbor Blend",
      variations: [{ name: "12 oz", priceCents: 2000 }],
    });
    const data = (calls[0]?.body as { object: { item_data: Record<string, unknown> } }).object
      .item_data;
    expect(data).not.toHaveProperty("image_ids");
    expect(data).not.toHaveProperty("categories");
    expect(data).not.toHaveProperty("reporting_category");
  });

  it("refuses a reporting category the item is not in", async () => {
    // Square reports against it regardless, so the item silently vanishes from
    // the sales breakdown while looking right in the dashboard.
    const calls = stubFetch({ catalog_object: { id: "ITEM1", type: "ITEM" } });
    await expect(
      upsertCatalogItem(CONFIG, {
        name: "Harbor Blend",
        variations: [{ name: "12 oz", priceCents: 2000 }],
        categoryIds: ["CAT_GIFTS"],
        reportingCategoryId: "CAT_COFFEE",
      }),
    ).rejects.toThrow(/not in categoryIds/);
    expect(calls).toHaveLength(0);
  });

  it("uploads an image as multipart and returns its id", async () => {
    const captured: { headers?: Headers; body?: unknown } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        captured.headers = new Headers(init.headers);
        captured.body = init.body;
        return new Response(
          JSON.stringify({
            image: { id: "IMG1", type: "IMAGE", image_data: { url: "https://cdn/1.jpg" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const image = await createCatalogImage(CONFIG, {
      file: new Blob(["bytes"], { type: "image/jpeg" }),
      filename: "harbor.jpg",
      caption: "A bag of Harbor Blend",
    });

    expect(image).toEqual({
      id: "IMG1",
      url: "https://cdn/1.jpg",
      caption: "A bag of Harbor Blend",
    });
    expect(captured.body).toBeInstanceOf(FormData);
    // Critical: we must NOT set content-type. fetch derives it from the
    // FormData along with the boundary, and a hand-set one breaks the upload in
    // a way that surfaces as a Square-side rejection.
    expect(captured.headers?.get("content-type")).toBeNull();
    expect(captured.headers?.get("square-version")).toBeTruthy();

    const form = captured.body as FormData;
    expect(JSON.parse(String(form.get("request")))).toMatchObject({
      image: { type: "IMAGE", id: "#image", image_data: { caption: "A bag of Harbor Blend" } },
    });
    expect(form.get("image_file")).toBeInstanceOf(Blob);
  });

  it("attaches to an existing object when given one", async () => {
    const captured: { form?: FormData } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        captured.form = init.body as FormData;
        return new Response(JSON.stringify({ image: { id: "IMG1", type: "IMAGE" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await createCatalogImage(CONFIG, {
      file: new Blob(["b"], { type: "image/png" }),
      objectId: "ITEM1",
    });
    expect(JSON.parse(String(captured.form?.get("request")))).toMatchObject({ object_id: "ITEM1" });
  });
});

describe("readModifyWriteCatalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A variation carrying fields this client does not model, which is the point. */
  const stored = {
    id: "VAR1",
    type: "ITEM_VARIATION",
    version: 42,
    present_at_all_locations: false,
    present_at_location_ids: ["L1", "L2"],
    item_variation_data: {
      item_id: "ITEM1",
      name: "12 oz",
      sku: "HB-12",
      pricing_type: "FIXED_PRICING",
      price_money: { amount: 2000, currency: "USD" },
      location_overrides: [
        {
          location_id: "L2",
          price_money: { amount: 1800, currency: "USD" },
          track_inventory: true,
        },
      ],
      // A field introduced after this client's pinned Square-Version would look
      // exactly like this: unknown to us, meaningful to the seller.
      measurement_unit_id: "MU_GRAMS",
    },
  };

  function stubReadWrite() {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: String(init.method ?? "GET"),
          body: init.body ? JSON.parse(String(init.body)) : null,
        });
        const json = calls.length === 1 ? { object: stored } : { catalog_object: stored };
        return new Response(JSON.stringify(json), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    return calls;
  }

  it("round-trips every field, including ones it does not model", async () => {
    // The failure this guards is silent by definition — a dropped field reads as
    // an intentional clear — so it needs an explicit diff, not a spot check.
    const calls = stubReadWrite();
    await readModifyWriteCatalog(CONFIG, "VAR1", (object) => {
      const data = object.item_variation_data as Record<string, unknown>;
      data.price_money = { amount: 2200, currency: "USD" };
    });

    const written = (calls[1]?.body as { object: typeof stored }).object;
    expect(written).toEqual({
      ...stored,
      item_variation_data: {
        ...stored.item_variation_data,
        price_money: { amount: 2200, currency: "USD" },
      },
    });
    // Named explicitly: these are what a rebuild-from-parts helper would drop.
    const data = written.item_variation_data as Record<string, unknown>;
    expect(data.location_overrides).toEqual(stored.item_variation_data.location_overrides);
    expect(data.measurement_unit_id).toBe("MU_GRAMS");
    expect(written.present_at_location_ids).toEqual(["L1", "L2"]);
  });

  it("writes back the version it read, so a concurrent write loses rather than clobbers", async () => {
    const calls = stubReadWrite();
    await readModifyWriteCatalog(CONFIG, "VAR1", (object) => {
      // A caller trying to force a version cannot: the read's wins.
      object.version = 1;
    });
    expect((calls[1]?.body as { object: { version: number } }).object.version).toBe(42);
  });

  it("reads then writes, pinning the same Square-Version on both", async () => {
    const calls = stubReadWrite();
    await readModifyWriteCatalog(CONFIG, "VAR1", () => {});
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/v2/catalog/object/VAR1");
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toContain("/v2/catalog/object");
  });

  it("accepts a replacement object returned from the mutator", async () => {
    const calls = stubReadWrite();
    await readModifyWriteCatalog(CONFIG, "VAR1", (object) => ({ ...object, custom_attribute: 1 }));
    expect((calls[1]?.body as { object: Record<string, unknown> }).object.custom_attribute).toBe(1);
  });

  it("throws when the object is gone, rather than writing a fresh one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await expect(readModifyWriteCatalog(CONFIG, "GONE", () => {})).rejects.toThrow(/not found/);
  });
});

describe("createOrder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("emits catalog-ref and ad-hoc (name + base_price_money) line items", async () => {
    const calls = stubFetch({
      order: {
        id: "ORD1",
        location_id: "L1",
        state: "OPEN",
        total_money: { amount: 3000, currency: "USD" },
      },
    });

    await createOrder(CONFIG, {
      locationId: "L1",
      lineItems: [
        { catalogObjectId: "VAR1", quantity: 2 },
        { name: "Manufacturing deposit", priceCents: 3000, quantity: 1 },
      ],
    });

    expect(calls[0]?.body).toMatchObject({
      order: {
        line_items: [
          { catalog_object_id: "VAR1", quantity: "2" },
          {
            name: "Manufacturing deposit",
            quantity: "1",
            base_price_money: { amount: 3000, currency: "USD" },
          },
        ],
      },
    });
  });

  it("nests pricing_options INSIDE order, where Square actually reads it", async () => {
    // The foot-gun this guards: at the request root Square ignores the field
    // without erroring, so the call succeeds and the order is simply untaxed.
    // Asserting the nesting is the only way that regression is visible.
    const calls = stubFetch({ order: { id: "ORD1" } });

    await createOrder(CONFIG, {
      locationId: "L1",
      lineItems: [{ catalogObjectId: "VAR1", quantity: 1 }],
      pricingOptions: { autoApplyTaxes: true },
    });

    const body = calls[0]?.body as Record<string, unknown> & {
      order: { pricing_options?: unknown };
    };
    expect(body.order.pricing_options).toEqual({
      auto_apply_taxes: true,
      auto_apply_discounts: undefined,
    });
    expect(body).not.toHaveProperty("pricing_options");
  });

  it("omits pricing_options entirely when unset, so today's callers are unchanged", async () => {
    const calls = stubFetch({ order: { id: "ORD1" } });

    await createOrder(CONFIG, {
      locationId: "L1",
      lineItems: [{ catalogObjectId: "VAR1", quantity: 1 }],
    });

    const body = calls[0]?.body as { order: Record<string, unknown> };
    expect(body.order.pricing_options).toBeUndefined();
  });

  it("never sends order.taxes[], which Square documents as double-taxing", async () => {
    // Not a configuration choice — there is no way to express `taxes[]`
    // through this client, and this pins that it stays that way.
    const calls = stubFetch({ order: { id: "ORD1" } });

    await createOrder(CONFIG, {
      locationId: "L1",
      lineItems: [{ catalogObjectId: "VAR1", quantity: 1 }],
      pricingOptions: { autoApplyTaxes: true },
    });

    const body = calls[0]?.body as { order: Record<string, unknown> };
    expect(body.order).not.toHaveProperty("taxes");
  });
});

describe("createTeamMember", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs an ACTIVE member with all-locations assignment and maps the response", async () => {
    const calls = stubFetch({
      team_member: {
        id: "TM1",
        reference_id: "pu_9",
        given_name: "Sam",
        family_name: "Tiger",
        email_address: "sam@x.co",
        status: "ACTIVE",
        is_owner: false,
      },
    });

    const tm = await createTeamMember(CONFIG, {
      givenName: "Sam",
      familyName: "Tiger",
      emailAddress: "sam@x.co",
      referenceId: "pu_9",
      assignAllLocations: true,
    });

    expect(calls[0]?.url).toBe("https://connect.squareupsandbox.com/v2/team-members");
    expect(calls[0]?.body).toMatchObject({
      team_member: {
        given_name: "Sam",
        reference_id: "pu_9",
        status: "ACTIVE",
        assigned_locations: { assignment_type: "ALL_CURRENT_AND_FUTURE_LOCATIONS" },
      },
    });
    expect(tm).toMatchObject({
      id: "TM1",
      referenceId: "pu_9",
      emailAddress: "sam@x.co",
      isOwner: false,
    });
  });
});

describe("timecards", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createTimecard opens a card (POST, `timecard` wrapper)", async () => {
    const calls = stubFetch({
      timecard: {
        id: "TC1",
        location_id: "L1",
        team_member_id: "TM1",
        start_at: "2026-07-14T15:00:00Z",
        status: "OPEN",
        version: 1,
      },
    });

    const tc = await createTimecard(CONFIG, {
      locationId: "L1",
      teamMemberId: "TM1",
      startAt: "2026-07-14T15:00:00Z",
    });

    expect(calls[0]?.url).toBe("https://connect.squareupsandbox.com/v2/labor/timecards");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toMatchObject({
      timecard: { location_id: "L1", team_member_id: "TM1", start_at: "2026-07-14T15:00:00Z" },
    });
    expect(tc).toMatchObject({ id: "TC1", status: "OPEN", version: 1, endAt: null });
  });

  it("updateTimecard closes it (PUT to /{id} with end_at + version)", async () => {
    const calls = stubFetch({
      timecard: {
        id: "TC1",
        location_id: "L1",
        team_member_id: "TM1",
        start_at: "2026-07-14T15:00:00Z",
        end_at: "2026-07-14T19:00:00Z",
        status: "CLOSED",
        version: 2,
      },
    });

    const tc = await updateTimecard(CONFIG, "TC1", {
      locationId: "L1",
      teamMemberId: "TM1",
      startAt: "2026-07-14T15:00:00Z",
      endAt: "2026-07-14T19:00:00Z",
      version: 1,
    });

    expect(calls[0]?.url).toBe("https://connect.squareupsandbox.com/v2/labor/timecards/TC1");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toMatchObject({
      timecard: { end_at: "2026-07-14T19:00:00Z", version: 1 },
    });
    expect(tc).toMatchObject({ status: "CLOSED", endAt: "2026-07-14T19:00:00Z", version: 2 });
  });
});

describe("invoices", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createInvoice posts a DEPOSIT (fixed) + BALANCE schedule against an order", async () => {
    const calls = stubFetch({
      invoice: {
        id: "INV1",
        version: 0,
        status: "DRAFT",
        order_id: "ORD1",
        payment_requests: [
          {
            uid: "d",
            request_type: "DEPOSIT",
            computed_amount_money: { amount: 5000, currency: "USD" },
          },
          {
            uid: "b",
            request_type: "BALANCE",
            computed_amount_money: { amount: 5000, currency: "USD" },
          },
        ],
      },
    });

    const inv = await createInvoice(CONFIG, {
      locationId: "L1",
      orderId: "ORD1",
      customerId: "CUST1",
      paymentRequests: [
        { type: "DEPOSIT", dueDate: "2026-07-20", amountCents: 5000 },
        { type: "BALANCE", dueDate: "2026-08-15" },
      ],
    });

    expect(calls[0]?.url).toBe("https://connect.squareupsandbox.com/v2/invoices");
    expect(calls[0]?.body).toMatchObject({
      invoice: {
        order_id: "ORD1",
        primary_recipient: { customer_id: "CUST1" },
        delivery_method: "SHARE_MANUALLY",
        payment_requests: [
          {
            request_type: "DEPOSIT",
            due_date: "2026-07-20",
            fixed_amount_requested_money: { amount: 5000, currency: "USD" },
          },
          { request_type: "BALANCE", due_date: "2026-08-15" },
        ],
      },
    });
    // BALANCE has no fixed amount (auto-covers the remainder).
    const balanceReq = (
      calls[0]?.body as { invoice: { payment_requests: Record<string, unknown>[] } }
    ).invoice.payment_requests[1];
    expect(balanceReq).not.toHaveProperty("fixed_amount_requested_money");
    expect(inv).toMatchObject({ id: "INV1", version: 0, status: "DRAFT", orderId: "ORD1" });
    expect(inv.paymentRequests.map((r) => r.requestType)).toEqual(["DEPOSIT", "BALANCE"]);
  });

  it("publishInvoice posts the version and returns the hosted public_url", async () => {
    const calls = stubFetch({
      invoice: {
        id: "INV1",
        version: 1,
        status: "UNPAID",
        public_url: "https://squareup.com/pay/INV1",
      },
    });

    const inv = await publishInvoice(CONFIG, "INV1", 0);

    expect(calls[0]?.url).toBe("https://connect.squareupsandbox.com/v2/invoices/INV1/publish");
    expect(calls[0]?.body).toMatchObject({ version: 0 });
    expect(inv).toMatchObject({ status: "UNPAID", publicUrl: "https://squareup.com/pay/INV1" });
  });
});

// ── Multi-merchant: locations, per-location pricing, inventory ───────────────
//
// These are the paths where a bug costs real money: charging one merchant's
// price at another merchant's storefront, or selling stock a shop doesn't hold.

describe("presentAt", () => {
  const base = { presentAtLocationIds: [], absentAtLocationIds: [] };

  it("treats present_at_location_ids as a WHITELIST when not present everywhere", () => {
    const presence = { ...base, presentAtAllLocations: false, presentAtLocationIds: ["L1"] };
    expect(presentAt(presence, "L1")).toBe(true);
    expect(presentAt(presence, "L2")).toBe(false);
  });

  it("treats absent_at_location_ids as a BLACKLIST when present everywhere", () => {
    const presence = { ...base, presentAtAllLocations: true, absentAtLocationIds: ["L2"] };
    expect(presentAt(presence, "L1")).toBe(true);
    expect(presentAt(presence, "L2")).toBe(false);
  });

  it("ignores the whitelist when present everywhere, and vice versa", () => {
    // The two lists are not symmetric — only the one matching the flag applies.
    expect(
      presentAt({ ...base, presentAtAllLocations: true, presentAtLocationIds: ["L9"] }, "L1"),
    ).toBe(true);
    expect(
      presentAt({ ...base, presentAtAllLocations: false, absentAtLocationIds: ["L9"] }, "L1"),
    ).toBe(false);
  });
});

describe("priceAtLocation", () => {
  const variation = {
    id: "var-1",
    name: "Original",
    sku: null,
    priceCents: 20000,
    currency: "USD",
    version: 1,
    presentAtAllLocations: true,
    presentAtLocationIds: [],
    absentAtLocationIds: [],
    locationOverrides: [
      {
        locationId: "L-gallery",
        priceCents: 26000,
        currency: "USD",
        trackInventory: null,
        soldOut: null,
      },
      // An override that adjusts availability but NOT price.
      {
        locationId: "L-popup",
        priceCents: null,
        currency: null,
        trackInventory: false,
        soldOut: null,
      },
    ],
  };

  it("uses the location's override price where one is set", () => {
    expect(priceAtLocation(variation, "L-gallery")).toEqual({ amount: 26000, currency: "USD" });
  });

  it("falls back to the base price at a location with no override", () => {
    expect(priceAtLocation(variation, "L-studio")).toEqual({ amount: 20000, currency: "USD" });
  });

  it("falls back to the base price when an override sets no price", () => {
    // A non-price override must not be read as "free".
    expect(priceAtLocation(variation, "L-popup")).toEqual({ amount: 20000, currency: "USD" });
  });
});

describe("mapCatalogItem — location data", () => {
  it("carries presence and location overrides through", () => {
    const item = mapCatalogItem(
      {
        id: "item-1",
        type: "ITEM",
        present_at_all_locations: false,
        present_at_location_ids: ["L1"],
        item_data: {
          name: "Print",
          variations: [
            {
              id: "var-1",
              type: "ITEM_VARIATION",
              present_at_all_locations: true,
              absent_at_location_ids: ["L2"],
              item_variation_data: {
                name: "A3",
                price_money: { amount: 4500, currency: "USD" },
                location_overrides: [
                  { location_id: "L1", price_money: { amount: 5500, currency: "USD" } },
                ],
              },
            },
          ],
        },
      },
      new Map(),
    );
    expect(item.presentAtAllLocations).toBe(false);
    expect(item.presentAtLocationIds).toEqual(["L1"]);
    expect(item.variations[0].absentAtLocationIds).toEqual(["L2"]);
    expect(item.variations[0].locationOverrides).toEqual([
      { locationId: "L1", priceCents: 5500, currency: "USD", trackInventory: null, soldOut: null },
    ]);
    expect(priceAtLocation(item.variations[0], "L1")).toEqual({ amount: 5500, currency: "USD" });
  });
});

describe("retrieveVariationPricesAt", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves the override price at the location and omits absent variations", async () => {
    stubFetch({
      objects: [
        {
          id: "var-here",
          type: "ITEM_VARIATION",
          item_variation_data: {
            price_money: { amount: 1000, currency: "USD" },
            location_overrides: [
              { location_id: "L1", price_money: { amount: 1300, currency: "USD" } },
            ],
          },
        },
        {
          id: "var-base",
          type: "ITEM_VARIATION",
          item_variation_data: { price_money: { amount: 800, currency: "USD" } },
        },
        // Sold only at L2 — must not appear in an L1 lookup, so a caller that
        // requires every id to resolve fails closed instead of overselling.
        {
          id: "var-elsewhere",
          type: "ITEM_VARIATION",
          present_at_all_locations: false,
          present_at_location_ids: ["L2"],
          item_variation_data: { price_money: { amount: 900, currency: "USD" } },
        },
      ],
    });

    const prices = await retrieveVariationPricesAt(
      CONFIG,
      ["var-here", "var-base", "var-elsewhere"],
      "L1",
    );
    expect(prices.get("var-here")).toEqual({ amount: 1300, currency: "USD" });
    expect(prices.get("var-base")).toEqual({ amount: 800, currency: "USD" });
    expect(prices.has("var-elsewhere")).toBe(false);
  });
});

describe("listLocations / retrieveLocation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes locations and joins the address", async () => {
    stubFetch({
      locations: [
        {
          id: "L1",
          name: "Gallery",
          status: "ACTIVE",
          currency: "USD",
          timezone: "America/Chicago",
          address: {
            address_line_1: "12 Main St",
            locality: "Des Moines",
            administrative_district_level_1: "IA",
            postal_code: "50309",
          },
        },
      ],
    });
    const [loc] = await listLocations(CONFIG);
    expect(loc).toEqual({
      id: "L1",
      name: "Gallery",
      status: "ACTIVE",
      currency: "USD",
      timezone: "America/Chicago",
      address: "12 Main St, Des Moines, IA, 50309",
      businessName: null,
    });
  });

  it("returns null for a missing location rather than throwing", async () => {
    // "This merchant has no Square location yet" is a legitimate answer — the
    // `external` sales_mode depends on it.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ errors: [{ detail: "Not Found" }] }), { status: 404 }),
      ),
    );
    expect(await retrieveLocation(CONFIG, "nope")).toBeNull();
  });
});

describe("createLocation / updateLocation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs a structured address, not the joined line it reads back", async () => {
    const calls = stubFetch({ location: { id: "L9", name: "Studio", currency: "USD" } });
    const loc = await createLocation(CONFIG, {
      name: "Studio",
      businessName: "Midwest Artist",
      timezone: "America/Chicago",
      address: {
        line1: "9 Elm",
        locality: "Ames",
        region: "IA",
        postalCode: "50010",
        country: "US",
      },
    });

    expect(calls[0]?.url).toBe("https://connect.squareupsandbox.com/v2/locations");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      location: {
        name: "Studio",
        business_name: "Midwest Artist",
        timezone: "America/Chicago",
        address: {
          address_line_1: "9 Elm",
          locality: "Ames",
          administrative_district_level_1: "IA",
          postal_code: "50010",
          country: "US",
        },
      },
    });
    expect(loc.id).toBe("L9");
  });

  it("sends no currency — it belongs to the account, not the location", async () => {
    const calls = stubFetch({ location: { id: "L9", name: "Studio" } });
    await createLocation(CONFIG, { name: "Studio" });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("currency");
  });

  it("PUTs sparsely, so an omitted field is never cleared", async () => {
    const calls = stubFetch({ location: { id: "L1", name: "Renamed" } });
    await updateLocation(CONFIG, "L1", { name: "Renamed" });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("/v2/locations/L1");
    // Only the name — no address key at all, which is what keeps the existing
    // address intact rather than replaced with an empty object.
    expect(calls[0]?.body).toEqual({ location: { name: "Renamed" } });
  });
});

describe("setPhysicalCount", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends an absolute PHYSICAL_COUNT scoped to the location", async () => {
    const calls = stubFetch({ counts: [] });
    await setPhysicalCount(CONFIG, {
      catalogObjectId: "var-1",
      locationId: "L1",
      quantity: 4,
    });
    const body = calls[0].body as {
      idempotency_key: string;
      changes: { type: string; physical_count: Record<string, unknown> }[];
    };
    expect(calls[0].url).toContain("/v2/inventory/changes/batch-create");
    expect(body.idempotency_key).toBeTruthy();
    expect(body.changes[0].type).toBe("PHYSICAL_COUNT");
    expect(body.changes[0].physical_count).toMatchObject({
      catalog_object_id: "var-1",
      location_id: "L1",
      state: "IN_STOCK",
      // Square wants the quantity as a string.
      quantity: "4",
    });
  });
});

describe("searchOrders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to COMPLETED only, so unpaid orders never count as revenue", async () => {
    const calls = stubFetch({ orders: [] });
    await searchOrders(CONFIG, { locationIds: ["L1"] });
    const body = calls[0].body as { query: { filter: { state_filter?: { states: string[] } } } };
    expect(body.query.filter.state_filter?.states).toEqual(["COMPLETED"]);
  });

  it("matches the sort field to the date filter's field", async () => {
    // Square rejects a search whose sort field differs from the date filter's.
    const calls = stubFetch({ orders: [] });
    await searchOrders(CONFIG, {
      locationIds: ["L1"],
      startAt: "2026-01-01T00:00:00Z",
      dateField: "createdAt",
    });
    const body = calls[0].body as {
      query: {
        filter: { date_time_filter: Record<string, unknown> };
        sort: { sort_field: string };
      };
    };
    expect(body.query.sort.sort_field).toBe("CREATED_AT");
    expect(body.query.filter.date_time_filter).toHaveProperty("created_at");
  });

  it("follows the cursor and stops when it is absent", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        const page =
          call === 1 ? { orders: [{ id: "o1" }], cursor: "next" } : { orders: [{ id: "o2" }] };
        return new Response(JSON.stringify(page), { status: 200 });
      }),
    );
    const orders = await searchOrders(CONFIG, { locationIds: ["L1"] });
    expect(orders.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(call).toBe(2);
  });

  // Square caps `location_ids` at 10 per call. Passing 11 is a 400 — from the
  // exact multi-location account this endpoint exists to report on.
  it("chunks locationIds at 10, Square's hard ceiling", async () => {
    const calls = stubFetch({ orders: [] });
    const ids = Array.from({ length: 23 }, (_, i) => `L${i + 1}`);
    await searchOrders(CONFIG, { locationIds: ids });

    expect(calls).toHaveLength(3);
    const sent = calls.map((c) => (c.body as { location_ids: string[] }).location_ids);
    expect(sent.map((s) => s.length)).toEqual([10, 10, 3]);
    // Every location searched exactly once, none dropped.
    expect(sent.flat()).toEqual(ids);
  });

  it("re-sorts across chunks, so the merged result is still ordered", async () => {
    // Each chunk comes back sorted within itself; concatenating them is not.
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        const orders =
          call === 1
            ? [{ id: "old", closed_at: "2026-01-01T00:00:00Z" }]
            : [{ id: "new", closed_at: "2026-06-01T00:00:00Z" }];
        return new Response(JSON.stringify({ orders }), { status: 200 });
      }),
    );
    const ids = Array.from({ length: 11 }, (_, i) => `L${i + 1}`);
    const orders = await searchOrders(CONFIG, { locationIds: ids });
    // DESC by closedAt, the default — newest first regardless of which chunk.
    expect(orders.map((o) => o.id)).toEqual(["new", "old"]);
  });

  it("refuses an empty location list rather than asking Square to reject it", async () => {
    const calls = stubFetch({ orders: [] });
    await expect(searchOrders(CONFIG, { locationIds: [] })).rejects.toThrow(
      /at least one location/i,
    );
    expect(calls).toHaveLength(0);
  });

  it("maps closedAt and updatedAt, the axes it lets you sort on", async () => {
    stubFetch({
      orders: [
        {
          id: "o1",
          closed_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-02T00:00:00Z",
        },
      ],
    });
    const [order] = await searchOrders(CONFIG, { locationIds: ["L1"] });
    expect(order.closedAt).toBe("2026-06-01T00:00:00Z");
    expect(order.updatedAt).toBe("2026-06-02T00:00:00Z");
  });
});

describe("calculateOrder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prices a cart without creating an order", async () => {
    const calls = stubFetch({ order: { id: "preview", total_money: { amount: 2400 } } });
    const order = await calculateOrder(CONFIG, {
      locationId: "L1",
      lineItems: [{ catalogObjectId: "VAR1", quantity: 2 }],
    });

    expect(calls[0].url).toContain("/v2/orders/calculate");
    // No idempotency key: nothing is persisted, so there is nothing to dedupe.
    expect(calls[0].body).toEqual({
      order: {
        location_id: "L1",
        customer_id: undefined,
        line_items: [{ catalog_object_id: "VAR1", quantity: "2" }],
      },
    });
    expect(order.totalMoney).toEqual({ amount: 2400, currency: "USD" });
  });

  it("shares the line-item shape with createOrder, so the preview can't drift", async () => {
    const calls = stubFetch({ order: { id: "preview" } });
    await calculateOrder(CONFIG, {
      locationId: "L1",
      // An ad-hoc item must carry its own price; a catalog-backed one must not.
      lineItems: [{ name: "Tip", priceCents: 500, quantity: 1 }],
    });
    const body = calls[0].body as { order: { line_items: Record<string, unknown>[] } };
    expect(body.order.line_items[0]).toEqual({
      name: "Tip",
      quantity: "1",
      base_price_money: { amount: 500, currency: "USD" },
    });
  });

  it("prices the preview under the same pricing_options as the charge", async () => {
    // The whole point of a preview is that the number shown is the number
    // charged. Taxes are opt-in on BOTH calls, so a preview that omitted them
    // while createOrder applied them would show a total the customer never
    // agreed to — and it would look correct in isolation on either side.
    // One object passed to both calls: the test would be worthless if the two
    // sides could be given different carts.
    const cart = {
      locationId: "L1",
      lineItems: [{ catalogObjectId: "VAR1", quantity: 2 }] as SquareOrderLineItem[],
      pricingOptions: { autoApplyTaxes: true },
    };

    const previewCalls = stubFetch({ order: { id: "preview" } });
    await calculateOrder(CONFIG, cart);
    const preview = previewCalls[0].body as { order: { pricing_options?: unknown } };
    vi.unstubAllGlobals();

    const chargeCalls = stubFetch({ order: { id: "ORD1" } });
    await createOrder(CONFIG, cart);
    const charge = chargeCalls[0].body as { order: { pricing_options?: unknown } };

    expect(preview.order.pricing_options).toEqual({
      auto_apply_taxes: true,
      auto_apply_discounts: undefined,
    });
    expect(preview.order.pricing_options).toEqual(charge.order.pricing_options);
  });

  it("maps the tax Square computed back out", async () => {
    stubFetch({
      order: {
        id: "preview",
        total_money: { amount: 2600, currency: "USD" },
        total_tax_money: { amount: 200, currency: "USD" },
      },
    });
    const order = await calculateOrder(CONFIG, {
      locationId: "L1",
      lineItems: [{ catalogObjectId: "VAR1", quantity: 2 }],
      pricingOptions: { autoApplyTaxes: true },
    });

    // A caller showing a tax line needs both halves, not just the total.
    expect(order.totalMoney).toEqual({ amount: 2600, currency: "USD" });
    expect(order.totalTaxMoney).toEqual({ amount: 200, currency: "USD" });
  });
});

describe("SquareConfig.retry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not retry by default", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response(JSON.stringify({ errors: [{ detail: "slow down" }] }), { status: 429 });
      }),
    );
    await expect(listLocations(CONFIG)).rejects.toThrow(/429/);
    expect(calls).toBe(1);
  });

  it("retries a 429 and succeeds", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({ errors: [{ detail: "slow down" }] }), {
            status: 429,
          });
        }
        return new Response(JSON.stringify({ locations: [{ id: "L1", name: "Shop" }] }), {
          status: 200,
        });
      }),
    );
    const locations = await listLocations({ ...CONFIG, retry: { attempts: 2, baseDelayMs: 1 } });
    expect(locations).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("never retries a 4xx that is not 429", async () => {
    // A 401/400 is our bug and will stay wrong — retrying just delays the error.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response(JSON.stringify({ errors: [{ detail: "bad token" }] }), { status: 401 });
      }),
    );
    await expect(
      listLocations({ ...CONFIG, retry: { attempts: 3, baseDelayMs: 1 } }),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });
});
