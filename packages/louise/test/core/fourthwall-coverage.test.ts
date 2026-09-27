// core/commerce/fourthwall—the Storefront client against a stubbed fetch,
// plus the catalog helpers and webhook signature check (#695).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmacSha256Base64 } from "../../src/core/commerce/index.js";
import {
  createCart,
  type FwProduct,
  getCollectionProducts,
  getProduct,
  listCatalog,
  listCollections,
  lowestPrice,
  mapFourthwallOrder,
  verifyFourthwallSignature,
} from "../../src/core/commerce/fourthwall.js";
import { UpstreamError } from "../../src/core/security/index.js";

const API = "https://storefront-api.fourthwall.com/v1";

/** Stub fetch; `answer` gets the path (after /v1) and the parsed URL. */
function stubFetch(answer: (path: string, url: URL, init: RequestInit) => Response) {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      urls.push(url);
      return answer(url.pathname.replace("/v1", ""), url, init);
    }),
  );
  return urls;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listCollections", () => {
  it("reads a results envelope and sends the token and accept header", async () => {
    let accept: string | null = null;
    const urls = stubFetch((_, __, init) => {
      accept = new Headers(init.headers).get("accept");
      return json({ results: [{ id: "c1", name: "Prints", slug: "prints" }] });
    });
    expect(await listCollections("sf_tok")).toEqual([{ id: "c1", name: "Prints", slug: "prints" }]);
    expect(urls[0].origin + urls[0].pathname).toBe(`${API}/collections`);
    expect(urls[0].searchParams.get("storefront_token")).toBe("sf_tok");
    expect(accept).toBe("application/json");
  });

  it("reads a bare array and treats any other shape as empty", async () => {
    stubFetch(() => json([{ id: "c2", name: "Totes", slug: "totes" }]));
    expect(await listCollections("t")).toHaveLength(1);
    stubFetch(() => json({ unexpected: true }));
    expect(await listCollections("t")).toEqual([]);
    stubFetch(() => new Response(null, { status: 204 }));
    expect(await listCollections("t")).toEqual([]);
  });

  it("throws an UpstreamError naming the path, never the token", async () => {
    stubFetch(() => new Response("Forbidden", { status: 403 }));
    const err = (await listCollections("secret_tok").catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBe(403);
    expect(err.operation).toBe("GET /collections");
    expect(err.detail).toBe("Forbidden");
    expect(`${err.message} ${err.operation}`).not.toContain("secret_tok");
  });

  it("throws on a 200 whose body isn't JSON", async () => {
    stubFetch(() => new Response("<html>maintenance</html>", { status: 200 }));
    await expect(listCollections("t")).rejects.toMatchObject({ status: 200 });
  });
});

describe("getCollectionProducts", () => {
  it("encodes the slug and refuses a partial catalog after the page cap", async () => {
    const urls = stubFetch(() => json({ results: [], paging: { hasNextPage: true } }));
    await expect(getCollectionProducts("t", "a/b")).rejects.toThrow(
      'Fourthwall collection "a/b" still reported more pages after 200',
    );
    expect(urls).toHaveLength(200);
    expect(urls[0].pathname).toBe("/v1/collections/a%2Fb/products");
    expect(urls[199].searchParams.get("page")).toBe("199");
  });

  it("stops on a bare array and on a non-true hasNextPage", async () => {
    let urls = stubFetch(() => json([{ id: "p1" }]));
    expect(await getCollectionProducts("t", "prints")).toEqual([{ id: "p1" }]);
    expect(urls).toHaveLength(1);
    urls = stubFetch(() => json({ results: [{ id: "p2" }], paging: { hasNextPage: "yes" } }));
    expect(await getCollectionProducts("t", "prints")).toEqual([{ id: "p2" }]);
    expect(urls).toHaveLength(1);
  });
});

describe("listCatalog", () => {
  it("pairs every collection with all of its products", async () => {
    stubFetch((path, url) => {
      if (path === "/collections")
        return json([
          { id: "c1", name: "Prints", slug: "prints" },
          { id: "c2", name: "All Products", slug: "all" },
        ]);
      const page = Number(url.searchParams.get("page"));
      if (path === "/collections/prints/products")
        return json({ results: [{ id: `print-${page}` }], paging: { hasNextPage: page === 0 } });
      return json({ results: [{ id: "print-0" }, { id: "tote" }] });
    });
    const catalog = await listCatalog("t");
    expect(catalog.map((c) => [c.collection.slug, c.products.map((p) => p.id)])).toEqual([
      ["prints", ["print-0", "print-1"]],
      ["all", ["print-0", "tote"]],
    ]);
  });

  it("returns nothing when the store has no collections", async () => {
    stubFetch(() => json({ results: [] }));
    expect(await listCatalog("t")).toEqual([]);
  });
});

describe("getProduct", () => {
  it("returns the product at an encoded slug", async () => {
    const urls = stubFetch(() => json({ id: "p1", slug: "tote bag" }));
    expect(await getProduct("t", "tote bag")).toEqual({ id: "p1", slug: "tote bag" });
    expect(urls[0].pathname).toBe("/v1/products/tote%20bag");
  });

  it("returns null for an empty body", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    expect(await getProduct("t", "x")).toBeNull();
  });

  it("returns null quietly on a 404 and reports any other failure", async () => {
    const log = vi.mocked(console.error);
    stubFetch(() => new Response("", { status: 404 }));
    expect(await getProduct("t", "gone")).toBeNull();
    expect(log).not.toHaveBeenCalled();
    stubFetch(() => new Response("", { status: 401 }));
    expect(await getProduct("t", "tote")).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("commerce.fourthwall.product");
  });
});

describe("createCart", () => {
  it("posts the items as JSON and returns the cart id", async () => {
    let sent: { method?: string; body?: unknown; type?: string | null } = {};
    const urls = stubFetch((_, __, init) => {
      sent = {
        method: init.method,
        body: JSON.parse(String(init.body)),
        type: new Headers(init.headers).get("content-type"),
      };
      return json({ id: "cart_1" });
    });
    const items = [{ variantId: "v1", quantity: 2 }];
    expect(await createCart("sf_tok", items)).toEqual({ id: "cart_1" });
    expect(urls[0].pathname).toBe("/v1/carts");
    expect(urls[0].searchParams.get("storefront_token")).toBe("sf_tok");
    expect(sent).toEqual({ method: "POST", body: { items }, type: "application/json" });
  });

  it("flags a 2xx without an id as NO_CART_ID", async () => {
    stubFetch(() => json({ id: "" }));
    await expect(createCart("t", [])).rejects.toMatchObject({ status: 200, code: "NO_CART_ID" });
  });

  it("passes on a failed status without a code", async () => {
    stubFetch(() => json({ id: "cart_x", error: "bad variant" }, 422));
    const err = (await createCart("t", []).catch((e: unknown) => e)) as UpstreamError;
    expect(err.status).toBe(422);
    expect(err.code).toBeNull();
    expect(err.operation).toBe("POST /carts");
  });
});

describe("lowestPrice", () => {
  const product = (values: (number | undefined)[]) =>
    ({
      variants: values.map((value, i) => ({
        id: `v${i}`,
        name: "V",
        unitPrice: value === undefined ? undefined : { value, currency: "USD" },
      })),
    }) as unknown as FwProduct;

  it("returns the lowest positive variant price", () => {
    expect(lowestPrice(product([30, 25, 0, undefined, 40]))).toBe(25);
  });

  it("returns 0 when no variant has a price", () => {
    expect(lowestPrice(product([]))).toBe(0);
    expect(lowestPrice(product([0, undefined]))).toBe(0);
  });
});

describe("verifyFourthwallSignature", () => {
  const secret = "fw_secret";
  const body = '{"type":"ORDER_PLACED"}';

  it("accepts the base64 HMAC of the raw body, trimming the header", async () => {
    const sig = await hmacSha256Base64(secret, body);
    expect(await verifyFourthwallSignature(body, ` ${sig} `, secret)).toBe(true);
  });

  it("rejects a missing header, a wrong secret, and a changed body", async () => {
    const sig = await hmacSha256Base64(secret, body);
    expect(await verifyFourthwallSignature(body, null, secret)).toBe(false);
    expect(await verifyFourthwallSignature(body, "", secret)).toBe(false);
    expect(await verifyFourthwallSignature(body, sig, "other")).toBe(false);
    expect(await verifyFourthwallSignature(`${body} `, sig, secret)).toBe(false);
  });
});

describe("mapFourthwallOrder aliases", () => {
  it("reads nested and alternate field names", () => {
    const order = mapFourthwallOrder({
      data: {
        orderId: "o_1",
        orderNumber: "1001",
        customer: { email: "quinn@example.com" },
        amounts: { total: { value: 12.5, currency: "EUR" } },
        shippingAddress: { city: "Springfield" },
        lineItems: [{ productSlug: "tote", variant: { name: "Tote · Blue" }, unitPrice: 12.5 }],
      },
    });
    expect(order).toEqual({
      fourthwallOrderId: "o_1",
      orderNumber: "1001",
      email: "quinn@example.com",
      amount: 1250,
      currency: "EUR",
      items: [{ slug: "tote", name: "Tote · Blue", qty: 1, unitPrice: 1250 }],
      shippingAddress: { city: "Springfield" },
      orderStatus: "paid",
    });
  });

  it("falls back to a generic item name and no items for a non-array list", () => {
    const withItem = mapFourthwallOrder({
      data: { id: "o_2", amount: 3, currency: "USD", items: [{ productName: "Pin" }, {}] },
    });
    expect(withItem?.items.map((i) => i.name)).toEqual(["Pin", "Item"]);
    expect(withItem?.currency).toBe("USD");
    const noList = mapFourthwallOrder({ data: { id: "o_3", offers: "none" } });
    expect(noList?.items).toEqual([]);
    expect(noList?.shippingAddress).toBeNull();
  });
});
