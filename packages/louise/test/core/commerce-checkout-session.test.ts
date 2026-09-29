// core/commerce/checkout-session—the checkout-session id a stored cart keeps
// across reloads. An id held in page memory changed on every reload while the
// cart didn't, so a retry after a lost response went out under a new
// idempotency key and charged twice.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cartFingerprint,
  type CheckoutSessionStorage,
  checkoutSession,
} from "../../src/core/commerce/index.js";

const HOUR = 60 * 60 * 1000;
const KEY = "shop-checkout-session";

/** A Map-backed storage that outlives a session object, like localStorage
 *  outlives a page. */
function memoryStorage(): CheckoutSessionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

const failing = (): CheckoutSessionStorage => ({
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
});

const latte = { variantId: "V1", quantity: 1, modifiers: [{ id: "OAT" }] };

describe("checkoutSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the same after a reload finds the same cart", () => {
    const storage = memoryStorage();
    const id = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage }).id("cart-a", 0);
    const reloaded = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage });
    expect(reloaded.id("cart-a", 1000)).toBe(id);
  });

  it("is stable across retries of the same cart", () => {
    const session = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage: memoryStorage() });
    expect(session.id("cart-a", 0)).toBe(session.id("cart-a", 1));
  });

  it("is new for a different cart, whichever tab changed it", () => {
    const storage = memoryStorage();
    const here = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage });
    const there = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage });
    const id = here.id("cart-a", 0);
    there.id("cart-b", 1);
    expect(here.id("cart-a", 2)).not.toBe(id);
  });

  it("is new after rotate(), for the same cart", () => {
    const session = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage: memoryStorage() });
    const id = session.id("cart-a", 0);
    session.rotate();
    const next = session.id("cart-a", 1);
    expect(next).not.toBe(id);
    expect(session.id("cart-a", 2)).toBe(next);
  });

  it("is new once another tab rotates it", () => {
    const storage = memoryStorage();
    const here = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage });
    const id = here.id("cart-a", 0);
    checkoutSession({ storageKey: KEY, idleMs: HOUR, storage }).rotate();
    expect(here.id("cart-a", 1)).not.toBe(id);
  });

  it("retires after idleMs unused, and each use restarts the clock", () => {
    const session = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage: memoryStorage() });
    const id = session.id("cart-a", 0);
    expect(session.id("cart-a", 59 * 60 * 1000)).toBe(id);
    expect(session.id("cart-a", 118 * 60 * 1000)).toBe(id);
    expect(session.id("cart-a", 179 * 60 * 1000)).not.toBe(id);
  });

  it("keeps two storage keys apart", () => {
    const storage = memoryStorage();
    const shop = checkoutSession({ storageKey: "shop", idleMs: HOUR, storage });
    const cafe = checkoutSession({ storageKey: "cafe", idleMs: HOUR, storage });
    expect(shop.id("cart-a", 0)).not.toBe(cafe.id("cart-a", 0));
  });

  it("mints a new id over a stored value it can't read", () => {
    const storage = memoryStorage();
    storage.setItem(KEY, "{not json");
    const session = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage });
    const id = session.id("cart-a", 0);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.id("cart-a", 1)).toBe(id);
  });

  it("ignores a stored value of the wrong shape", () => {
    const storage = memoryStorage();
    storage.setItem(KEY, JSON.stringify({ id: "", bag: "cart-a", usedAt: 0 }));
    const id = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage }).id("cart-a", 0);
    expect(id).not.toBe("");
  });

  it("falls back to page memory when storage throws", () => {
    const session = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage: failing() });
    const id = session.id("cart-a", 0);
    expect(session.id("cart-a", 1)).toBe(id);
    session.rotate();
    expect(session.id("cart-a", 2)).not.toBe(id);
  });

  it("stays stable in page memory when only writes fail (a full quota)", () => {
    const session = checkoutSession({
      storageKey: KEY,
      idleMs: HOUR,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      },
    });
    const id = session.id("cart-a", 0);
    expect(session.id("cart-a", 1)).toBe(id);
  });

  it("uses localStorage by default, read on each call", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const id = checkoutSession({ storageKey: KEY, idleMs: HOUR }).id("cart-a", 0);
    expect(JSON.parse(storage.data.get(KEY) ?? "{}")).toMatchObject({ id, bag: "cart-a" });
  });

  it("works in page memory where there's no localStorage", () => {
    vi.stubGlobal("localStorage", undefined);
    const session = checkoutSession({ storageKey: KEY, idleMs: HOUR });
    const id = session.id("cart-a", 0);
    expect(session.id("cart-a", 1)).toBe(id);
  });

  it("mints a v4 id where crypto.randomUUID is missing (plain http)", () => {
    vi.stubGlobal("crypto", {
      randomUUID: undefined,
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    const session = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage: memoryStorage() });
    const id = session.id("cart-a", 0);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(session.id("cart-a", 1)).toBe(id);
    session.rotate();
    expect(session.id("cart-a", 2)).not.toBe(id);
  });

  it("doesn't count a use stamped in the future as recent", () => {
    const storage = memoryStorage();
    const id = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage }).id("cart-a", 10 * HOUR);
    // The clock moved backward: the stored use is ahead of now.
    const later = checkoutSession({ storageKey: KEY, idleMs: HOUR, storage });
    expect(later.id("cart-a", 0)).not.toBe(id);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses idleMs %s", (idleMs) => {
    expect(() => checkoutSession({ storageKey: KEY, idleMs })).toThrow(RangeError);
  });

  it("refuses an empty storage key", () => {
    expect(() => checkoutSession({ storageKey: "", idleMs: HOUR })).toThrow(RangeError);
  });
});

describe("cartFingerprint", () => {
  it("ignores prices, so a price repair keeps the attempt", () => {
    const priced = (unitPriceCents: number) => ({ ...latte, unitPriceCents });
    expect(cartFingerprint([priced(450)])).toBe(cartFingerprint([priced(475)]));
  });

  it("ignores line order and add-on order", () => {
    const tea = { variantId: "V2", quantity: 2 };
    const twoMods = { ...latte, modifiers: [{ id: "OAT" }, { id: "SHOT" }] };
    const swapped = { ...latte, modifiers: [{ id: "SHOT" }, { id: "OAT" }] };
    expect(cartFingerprint([twoMods, tea])).toBe(cartFingerprint([tea, swapped]));
  });

  it("changes with the quantity", () => {
    expect(cartFingerprint([latte])).not.toBe(cartFingerprint([{ ...latte, quantity: 2 }]));
  });

  it("changes with an add-on swap", () => {
    expect(cartFingerprint([latte])).not.toBe(
      cartFingerprint([{ ...latte, modifiers: [{ id: "WHOLE" }] }]),
    );
  });

  it("can't be fooled by separators inside ids", () => {
    expect(cartFingerprint([{ variantId: "a:1", quantity: 2 }])).not.toBe(
      cartFingerprint([{ variantId: "a", quantity: 1, modifiers: [{ id: "2:" }] }]),
    );
    expect(cartFingerprint([{ ...latte, modifiers: [{ id: "x,y" }] }])).not.toBe(
      cartFingerprint([{ ...latte, modifiers: [{ id: "x" }, { id: "y" }] }]),
    );
  });

  it("treats one line of 2 and two identical lines of 1 as the same order", () => {
    expect(cartFingerprint([{ ...latte, quantity: 2 }])).toBe(cartFingerprint([latte, latte]));
  });

  it("treats no add-ons and an empty list the same", () => {
    expect(cartFingerprint([{ variantId: "V1", quantity: 1 }])).toBe(
      cartFingerprint([{ variantId: "V1", quantity: 1, modifiers: [] }]),
    );
  });
});
