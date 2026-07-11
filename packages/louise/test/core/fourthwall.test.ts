import { describe, expect, it } from "vitest";
import {
  fourthwallMoneyToCents,
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
