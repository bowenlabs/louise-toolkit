import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CartLine,
  cartIssues,
  cartModifierIds,
  repairCart,
} from "../../src/core/commerce/index.js";
import { retrieveLiveCatalogObjectIds } from "../../src/core/commerce/square.js";

// The scenarios are coracle.coffee's (islands/order-cart-store.ts, priceCheckout
// in lib/square.ts), where each was a live checkout loop: a bag holding an old
// price failed every retry, and a deleted add-on made Square reject the order.

interface Mod {
  id: string;
  name: string;
}
type Line = CartLine<Mod> & { name: string };

const line = (variantId: string, name: string, cents: number, qty = 1, mods: Mod[] = []): Line => ({
  variantId,
  name,
  unitPriceCents: cents,
  quantity: qty,
  modifiers: mods,
});
const OAT = { id: "MOD_OAT", name: "Oat milk" };
const SHOT = { id: "MOD_SHOT", name: "Extra shot" };

describe("cartIssues", () => {
  it("reports EVERY problem, not just the first", () => {
    // A first-failure check is how a customer gets stuck: fix one, retry,
    // refused over the next.
    const issues = cartIssues(
      [line("V1", "Latte", 450), line("V2", "Mocha", 500), line("V3", "Drip", 300)],
      {
        prices: new Map([
          ["V1", 475],
          ["V3", 300],
        ]),
      },
    );
    expect(issues).toEqual([
      { kind: "price-changed", variantId: "V1", unitPriceCents: 475, wasCents: 450 },
      { kind: "unavailable", variantId: "V2" },
    ]);
  });

  it("is empty when the cart matches the catalog", () => {
    expect(cartIssues([line("V1", "Latte", 450)], { prices: new Map([["V1", 450]]) })).toEqual([]);
  });

  it("checks stock BEFORE price — a sold-out variant is usually still priced", () => {
    const issues = cartIssues([line("V1", "Latte", 450)], {
      prices: new Map([["V1", 450]]),
      outOfStock: new Set(["V1"]),
    });
    expect(issues).toEqual([{ kind: "out-of-stock", variantId: "V1" }]);
  });

  it("reports a deleted add-on once, however many lines carry it", () => {
    const issues = cartIssues(
      [line("V1", "Latte", 450, 1, [OAT, SHOT]), line("V2", "Mocha", 500, 1, [OAT])],
      {
        prices: new Map([
          ["V1", 450],
          ["V2", 500],
        ]),
        liveModifierIds: new Set(["MOD_SHOT"]),
      },
    );
    expect(issues).toEqual([{ kind: "modifier-unavailable", modifierId: "MOD_OAT" }]);
  });

  it("skips the add-on check when no liveModifierIds are given", () => {
    const issues = cartIssues([line("V1", "Latte", 450, 1, [OAT])], {
      prices: new Map([["V1", 450]]),
    });
    expect(issues).toEqual([]);
  });

  it("reports a variant once even when two lines share it", () => {
    const issues = cartIssues([line("V1", "Latte", 450), line("V1", "Latte", 450, 2, [OAT])], {
      prices: new Map(),
    });
    expect(issues).toEqual([{ kind: "unavailable", variantId: "V1" }]);
  });
});

describe("cartModifierIds", () => {
  it("lists each add-on once, for the provider lookup", () => {
    expect(
      cartModifierIds([
        line("V1", "Latte", 450, 1, [OAT, SHOT]),
        line("V2", "Mocha", 500, 1, [OAT]),
      ]),
    ).toEqual(["MOD_OAT", "MOD_SHOT"]);
  });
});

describe("repairCart", () => {
  it("updates a changed price in place and reports it", () => {
    const cart = [line("V1", "Latte", 450), line("V2", "Drip", 300)];
    const { lines, changes } = repairCart(cart, [
      { kind: "price-changed", variantId: "V1", unitPriceCents: 475, wasCents: 450 },
    ]);
    expect(lines.map((l) => [l.name, l.unitPriceCents])).toEqual([
      ["Latte", 475],
      ["Drip", 300],
    ]);
    expect(changes).toEqual([{ kind: "repriced", line: cart[0], fromCents: 450, toCents: 475 }]);
    // Inputs untouched.
    expect(cart[0]?.unitPriceCents).toBe(450);
  });

  it("removes unavailable and sold-out lines, with the line itself so the site can name it", () => {
    const cart = [line("V1", "Latte", 450), line("V2", "Mocha", 500), line("V3", "Drip", 300)];
    const { lines, changes } = repairCart(cart, [
      { kind: "unavailable", variantId: "V2" },
      { kind: "out-of-stock", variantId: "V3" },
    ]);
    expect(lines.map((l) => l.name)).toEqual(["Latte"]);
    expect(changes).toEqual([
      { kind: "removed", line: cart[1], reason: "unavailable" },
      { kind: "removed", line: cart[2], reason: "out-of-stock" },
    ]);
  });

  it("takes a deleted add-on off the line and reports which one", () => {
    const cart = [line("V1", "Latte", 450, 1, [OAT, SHOT])];
    const { lines, changes } = repairCart(cart, [
      { kind: "modifier-unavailable", modifierId: "MOD_OAT" },
    ]);
    expect(lines[0]?.modifiers?.map((m) => m.id)).toEqual(["MOD_SHOT"]);
    expect(changes).toEqual([{ kind: "modifier-removed", line: cart[0], modifier: OAT }]);
  });

  it("folds a line into its twin once they match", () => {
    // A Latte with oat milk + a plain Latte: drop oat milk and they're the same drink.
    const cart = [line("V1", "Latte", 450, 2), line("V1", "Latte", 450, 3, [OAT])];
    const { lines, changes } = repairCart(cart, [
      { kind: "modifier-unavailable", modifierId: "MOD_OAT" },
    ]);
    expect(lines.map((l) => [l.modifiers?.length, l.quantity])).toEqual([[0, 5]]);
    expect(changes.at(-1)).toMatchObject({ kind: "merged", droppedQuantity: 0 });
  });

  it("applies the caller's cap on merge and reports what it cut", () => {
    const cart = [line("V1", "Latte", 450, 8), line("V1", "Latte", 450, 5, [OAT])];
    const { lines, changes } = repairCart(
      cart,
      [{ kind: "modifier-unavailable", modifierId: "MOD_OAT" }],
      { maxQuantity: 10 },
    );
    expect(lines[0]?.quantity).toBe(10);
    expect(changes.at(-1)).toMatchObject({ kind: "merged", droppedQuantity: 3 });
  });

  it("has no cap unless the caller sets one", () => {
    const cart = [line("V1", "Latte", 450, 80), line("V1", "Latte", 450, 50, [OAT])];
    const { lines } = repairCart(cart, [{ kind: "modifier-unavailable", modifierId: "MOD_OAT" }]);
    expect(lines[0]?.quantity).toBe(130);
  });

  it("treats add-on order as irrelevant when matching twins", () => {
    const cart = [
      line("V1", "Latte", 450, 1, [SHOT, OAT]),
      line("V1", "Latte", 450, 1, [OAT, SHOT]),
    ];
    expect(repairCart(cart, []).lines).toHaveLength(1);
  });

  it("takes a custom key", () => {
    // e.g. a shop where a gift note makes two otherwise-identical lines distinct.
    const cart = [
      { ...line("V1", "Mug", 1800), note: "For Sam" },
      { ...line("V1", "Mug", 1800), note: "For Alex" },
    ];
    const { lines } = repairCart(cart, [], { key: (l) => `${l.variantId}|${l.note}` });
    expect(lines).toHaveLength(2);
  });

  it("is a no-op for no issues", () => {
    const cart = [line("V1", "Latte", 450)];
    expect(repairCart(cart, [])).toEqual({ lines: cart, changes: [] });
  });

  it("round-trips: a repaired cart has no issues against the same catalog", () => {
    const catalog = {
      prices: new Map([
        ["V1", 475],
        ["V3", 300],
      ]),
      liveModifierIds: new Set(["MOD_SHOT"]),
    };
    const cart = [
      line("V1", "Latte", 450, 1, [OAT, SHOT]),
      line("V2", "Mocha", 500),
      line("V3", "Drip", 300, 2, [OAT]),
    ];
    const { lines } = repairCart(cart, cartIssues(cart, catalog));
    expect(cartIssues(lines, catalog)).toEqual([]);
  });
});

describe("retrieveLiveCatalogObjectIds", () => {
  afterEach(() => vi.unstubAllGlobals());
  const CONFIG = { accessToken: "tok", environment: "sandbox" } as const;

  function stub(objects: unknown[]) {
    const bodies: { object_ids: string[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ objects }), { status: 200 });
      }),
    );
    return bodies;
  }

  it("keeps present, non-deleted objects of the requested type", async () => {
    stub([
      { id: "MOD_SHOT", type: "MODIFIER" },
      { id: "MOD_OLD", type: "MODIFIER", is_deleted: true },
      { id: "VAR1", type: "ITEM_VARIATION" },
    ]);
    const live = await retrieveLiveCatalogObjectIds(
      CONFIG,
      ["MOD_SHOT", "MOD_OLD", "MOD_GONE", "VAR1"],
      {
        type: "MODIFIER",
      },
    );
    // VAR1 exists but is not a modifier, so it can't pass for an add-on.
    expect([...live]).toEqual(["MOD_SHOT"]);
  });

  it("makes no request for an empty list", async () => {
    const bodies = stub([]);
    expect((await retrieveLiveCatalogObjectIds(CONFIG, [])).size).toBe(0);
    expect(bodies).toHaveLength(0);
  });

  it("de-duplicates and chunks at Square's 1000-id limit", async () => {
    const bodies = stub([]);
    const ids = Array.from({ length: 2300 }, (_, i) => `ID${i}`);
    await retrieveLiveCatalogObjectIds(CONFIG, [...ids, "ID0", "ID1"]);
    expect(bodies.map((b) => b.object_ids.length)).toEqual([1000, 1000, 300]);
  });
});
