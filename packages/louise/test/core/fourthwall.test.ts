import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FwProduct,
  fourthwallMoneyToCents,
  getCollectionProducts,
  mapFourthwallOrder,
  mapFourthwallOrderStatus,
} from "../../src/core/commerce/fourthwall.js";

describe("fourthwallMoneyToCents", () => {
  it("converts { value } major units to integer cents", () => {
    expect(fourthwallMoneyToCents({ value: 25, currency: "USD" })).toBe(2500);
    expect(fourthwallMoneyToCents({ value: 19.99 })).toBe(1999);
  });
  it("accepts a bare number and rejects everything else", () => {
    expect(fourthwallMoneyToCents(10)).toBe(1000);
    expect(fourthwallMoneyToCents(null)).toBeNull();
    expect(fourthwallMoneyToCents("nope")).toBeNull();
  });
});

describe("mapFourthwallOrderStatus", () => {
  it("maps to a coarse lifecycle state", () => {
    expect(mapFourthwallOrderStatus("SHIPPED")).toBe("fulfilled");
    expect(mapFourthwallOrderStatus("Delivered")).toBe("fulfilled");
    expect(mapFourthwallOrderStatus("refunded")).toBe("canceled");
    expect(mapFourthwallOrderStatus("CANCELLED")).toBe("canceled");
    expect(mapFourthwallOrderStatus("PLACED")).toBe("paid");
    expect(mapFourthwallOrderStatus(null)).toBe("paid");
  });
});

describe("mapFourthwallOrder", () => {
  it("returns null when the event carries no order id", () => {
    expect(mapFourthwallOrder({ data: {} })).toBeNull();
    expect(mapFourthwallOrder({})).toBeNull();
  });

  it("maps a full order payload, tolerating field aliases", () => {
    const order = mapFourthwallOrder({
      type: "order.placed",
      data: {
        id: "fw_123",
        friendlyId: "MB-1001",
        customer: { email: "buyer@example.com" },
        total: { value: 42, currency: "USD" },
        status: "SHIPPED",
        offers: [{ slug: "sunset", name: "Sunset print", quantity: 2, price: { value: 21 } }],
        shipping: { address: { city: "Tulsa" } },
      },
    });
    expect(order).toEqual({
      fourthwallOrderId: "fw_123",
      orderNumber: "MB-1001",
      email: "buyer@example.com",
      amount: 4200,
      currency: "USD",
      items: [{ slug: "sunset", name: "Sunset print", qty: 2, unitPrice: 2100 }],
      shippingAddress: { city: "Tulsa" },
      orderStatus: "fulfilled",
    });
  });

  it("falls back through orderId / amount / items aliases", () => {
    const order = mapFourthwallOrder({
      data: {
        orderId: "fw_9",
        email: "x@y.com",
        amount: { value: 5 },
        items: [{ productSlug: "p", productName: "P" }],
      },
    });
    expect(order?.fourthwallOrderId).toBe("fw_9");
    expect(order?.amount).toBe(500);
    expect(order?.items[0]).toEqual({ slug: "p", name: "P", qty: 1, unitPrice: null });
    expect(order?.orderStatus).toBe("paid");
  });
});

// The catalog read, which used to stop after one page.
//
// `unwrap` keeps `results` and drops the envelope around it, so
// `paging.hasNextPage` — the only field that says a list is incomplete — was
// discarded on every call. Nothing errored; the collection just came back
// smaller than it is, and more so the more the store sells. These pin the walk,
// because "read everything" is not observable in its own result.
describe("getCollectionProducts paging", () => {
  const product = (id: string) =>
    ({ id, name: id, slug: id, images: [], variants: [] }) as unknown as FwProduct;

  /** A fetch serving `pages` in order, in Fourthwall's `{results, paging}` envelope. */
  function servePages(pages: FwProduct[][]) {
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        calls.push(url);
        const page = Number(url.searchParams.get("page"));
        return {
          ok: true,
          json: async () => ({
            results: pages[page] ?? [],
            paging: { hasNextPage: page < pages.length - 1 },
          }),
        } as unknown as Response;
      }),
    );
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("returns every page, not just the first", async () => {
    servePages([[product("a"), product("b")], [product("c")], [product("d")]]);
    const out = await getCollectionProducts("tok", "all");
    expect(out.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("sends page (0-indexed) and an explicit size", async () => {
    // `size` is always sent because the omitted default is undocumented — the
    // reason a store could be two uploads from silently losing products.
    const calls = servePages([[product("a")], [product("b")]]);
    await getCollectionProducts("tok", "all");
    expect(calls.map((u) => u.searchParams.get("page"))).toEqual(["0", "1"]);
    expect(new Set(calls.map((u) => u.searchParams.get("size")))).toEqual(new Set(["50"]));
    expect(new Set(calls.map((u) => u.searchParams.get("storefront_token")))).toEqual(
      new Set(["tok"]),
    );
  });

  it("stops as soon as the envelope says there is no next page", async () => {
    const calls = servePages([[product("a")]]);
    await getCollectionProducts("tok", "all");
    expect(calls).toHaveLength(1);
  });

  it("treats a bare-array response as the only page", async () => {
    // The other envelope `unwrap` has always tolerated. It carries no paging,
    // so it is the whole answer — and must not be mistaken for an empty one.
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        calls.push(new URL(String(input)));
        return { ok: true, json: async () => [product("a"), product("b")] } as unknown as Response;
      }),
    );
    const out = await getCollectionProducts("tok", "all");
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(1);
  });

  it("stops on a malformed envelope rather than looping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ results: [product("a")], paging: null }),
          }) as unknown as Response,
      ),
    );
    await expect(getCollectionProducts("tok", "all")).resolves.toHaveLength(1);
  });

  it("throws rather than truncating when the pages never end", async () => {
    // A partial catalog is worse than a failed call for a caller reconciling
    // its mirror: it will drop whatever it did not see.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({ results: [product("x")], paging: { hasNextPage: true } }),
          }) as unknown as Response,
      ),
    );
    await expect(getCollectionProducts("tok", "all")).rejects.toThrow(
      /refusing to return a partial/i,
    );
  });

  it("propagates an API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad token" }) as Response),
    );
    await expect(getCollectionProducts("tok", "all")).rejects.toThrow(/401/);
  });
});
