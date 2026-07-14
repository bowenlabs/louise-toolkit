import { afterEach, describe, expect, it, vi } from "vitest";
import {
  centsToMajor,
  createInvoice,
  createOrder,
  createTeamMember,
  createTimecard,
  listCatalogItems,
  mapCatalogItem,
  publishInvoice,
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
      variations: [
        { id: "var-1", name: "12 oz", sku: "HB-12", priceCents: 2000, currency: "USD", version: 5 },
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
