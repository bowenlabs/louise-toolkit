import { afterEach, describe, expect, it, vi } from "vitest";
import {
  centsToMajor,
  listCatalogItems,
  mapCatalogItem,
  verifySquareSignature,
} from "../../src/core/commerce/square.js";

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
        item_data: {
          name: "Harbor Blend",
          description: "House medium roast",
          image_ids: ["img-1"],
          variations: [
            {
              id: "var-1",
              type: "ITEM_VARIATION",
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
      variations: [{ id: "var-1", name: "12 oz", sku: "HB-12", priceCents: 2000, currency: "USD" }],
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
