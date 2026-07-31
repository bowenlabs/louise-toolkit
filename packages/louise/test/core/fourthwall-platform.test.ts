import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addProductImages,
  cancelExternalOrder,
  createExternalOrder,
  createProduct,
  deleteProduct,
  type FourthwallPlatformConfig,
  getExternalOrder,
  getProductInventory,
  isCancellable,
  listExternalOrders,
  resetFourthwallRateLimits,
  setProductAvailability,
  setProductState,
  validateExternalOrder,
  verifyFourthwallPlatformSignature,
} from "../../src/core/commerce/fourthwall-platform.js";

/** One recorded call, in the shape the assertions actually read. */
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stubFetch(responses: { status?: number; body?: unknown; headers?: HeadersInit }[]) {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      );
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        headers,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const r = responses[Math.min(i++, responses.length - 1)] ?? {};
      const status = r.status ?? 200;
      // 204/205/304 are null-body statuses; `new Response("", { status: 204 })`
      // throws, so an empty string is not a stand-in for "no body".
      const nullBody = status === 204 || status === 205 || status === 304;
      return new Response(nullBody || r.body === undefined ? null : JSON.stringify(r.body), {
        status,
        headers: r.headers,
      });
    }),
  );
  return calls;
}

const config: FourthwallPlatformConfig = {
  username: "api-user",
  password: "s3cret",
  // Off by default in tests: the real 5/min bucket would make a two-create test
  // take a minute. Its behaviour is asserted directly in its own block.
  rateLimit: false,
};

beforeEach(() => {
  resetFourthwallRateLimits();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fourthwall platform — request layer", () => {
  it("authenticates with HTTP Basic against the Open API base", async () => {
    const calls = stubFetch([{ body: [] }]);
    await listExternalOrders(config);
    expect(calls[0]?.url).toBe("https://api.fourthwall.com/open-api/v1.0/external-orders");
    // Basic, not Bearer, and not the storefront's query-param token — this is
    // the credential that must never reach a browser.
    expect(calls[0]?.headers.authorization).toBe(`Basic ${btoa("api-user:s3cret")}`);
    expect(calls[0]?.url).not.toContain("storefront_token");
  });

  it("survives a 204 and an empty 200 body", async () => {
    // `res.json()` throws on an empty body, so an unconditional parse would
    // turn a successful DELETE into an error.
    stubFetch([{ status: 204 }]);
    await expect(deleteProduct(config, "p1")).resolves.toBeUndefined();
  });

  it("reports the provider's message rather than a bare status", async () => {
    stubFetch([{ status: 400, body: { message: "variantId is required" } }]);
    await expect(
      createProduct(config, { kind: "digital", name: "X", price: { value: 5, currency: "USD" } }),
    ).rejects.toThrow(/Fourthwall POST \/products 400: variantId is required/);
  });

  it("does not retry by default", async () => {
    const calls = stubFetch([{ status: 500, body: { message: "boom" } }]);
    await expect(listExternalOrders(config)).rejects.toThrow(/500/);
    expect(calls).toHaveLength(1);
  });

  it("retries 429 and 5xx when opted in, but never a 4xx", async () => {
    const retrying = { ...config, retry: { attempts: 2, baseDelayMs: 1 } };

    const flaky = stubFetch([
      { status: 503, body: { message: "later" } },
      { status: 200, body: [{ id: "o1" }] },
    ]);
    await expect(listExternalOrders(retrying)).resolves.toHaveLength(1);
    expect(flaky).toHaveLength(2);

    vi.unstubAllGlobals();
    // A 403 is our bug, not Fourthwall's weather: retrying just makes the same
    // wrong request three times.
    const forbidden = stubFetch([{ status: 403, body: { message: "nope" } }]);
    await expect(listExternalOrders(retrying)).rejects.toThrow(/403/);
    expect(forbidden).toHaveLength(1);
  });
});

describe("fourthwall platform — external orders", () => {
  const order = {
    externalId: "cart-9",
    items: [{ variantId: "v1", quantity: 2 }],
    shipping: { name: "A", address1: "1 St", city: "Tulsa", country: "US", zip: "74103" },
  };

  it("validate surfaces the at-cost breakdown before anything is committed", async () => {
    stubFetch([
      {
        body: {
          valid: true,
          manufacturingCost: { value: 12.5, currency: "USD" },
          fulfillmentFee: { value: 2, currency: "USD" },
          shippingCost: { value: 5.25, currency: "USD" },
          totalCreatorCost: { value: 19.75, currency: "USD" },
        },
      },
    ]);
    const check = await validateExternalOrder(config, order);
    expect(check.valid).toBe(true);
    expect(check.totalCreatorCost).toEqual({ value: 19.75, currency: "USD" });
    expect(check.shippingCost?.value).toBe(5.25);
    expect(check.problems).toEqual([]);
  });

  it("treats a 200 carrying errors as INVALID, not as success", async () => {
    // The trap: Fourthwall answers 200 for a validation that failed, with the
    // reasons in the body. Reading `res.ok` as the verdict would submit an
    // order it had just been told would not work.
    stubFetch([{ body: { valid: false, errors: [{ message: "variant v1 is out of stock" }] } }]);
    const check = await validateExternalOrder(config, order);
    expect(check.valid).toBe(false);
    expect(check.problems).toEqual(["variant v1 is out of stock"]);
  });

  it("defaults to valid only when the body names no problems", async () => {
    stubFetch([{ body: {} }]);
    expect((await validateExternalOrder(config, order)).valid).toBe(true);

    vi.unstubAllGlobals();
    stubFetch([{ body: { errors: ["nope"] } }]);
    expect((await validateExternalOrder(config, order)).valid).toBe(false);
  });

  it("NEVER retries order creation, even when the caller enabled retries", async () => {
    // Fourthwall has no idempotency key, so a retried create that actually
    // succeeded server-side is a second order and a second charge. A sync job
    // that turned retries on globally must not silently get that.
    const calls = stubFetch([{ status: 500, body: { message: "boom" } }]);
    await expect(
      createExternalOrder({ ...config, retry: { attempts: 3, baseDelayMs: 1 } }, order),
    ).rejects.toThrow(/500/);
    expect(calls).toHaveLength(1);
  });

  it("lists with paging and status filters, and maps the envelope either way", async () => {
    const calls = stubFetch([{ body: { results: [{ id: "o1", externalId: "cart-9" }] } }]);
    const orders = await listExternalOrders(config, { page: 2, size: 50, status: "SHIPPED" });
    expect(orders[0]).toMatchObject({ id: "o1", externalId: "cart-9" });
    expect(calls[0]?.url).toContain("page=2");
    expect(calls[0]?.url).toContain("size=50");
    expect(calls[0]?.url).toContain("status=SHIPPED");

    vi.unstubAllGlobals();
    stubFetch([{ body: [{ id: "o2" }] }]);
    expect(await listExternalOrders(config)).toHaveLength(1);
  });

  it("returns null for a missing order rather than throwing", async () => {
    stubFetch([{ status: 404, body: { message: "not found" } }]);
    await expect(getExternalOrder(config, "nope")).resolves.toBeNull();
  });

  it("still throws for a non-404 failure on get", async () => {
    // The null is specifically "no such order", not "any failure is empty".
    stubFetch([{ status: 500, body: { message: "boom" } }]);
    await expect(getExternalOrder(config, "o1")).rejects.toThrow(/500/);
  });

  it("cancels through the provider and exposes a local cancellability check", async () => {
    const calls = stubFetch([{ body: { id: "o1", status: "CANCELLED" } }]);
    expect(await cancelExternalOrder(config, "o1")).toMatchObject({ status: "CANCELLED" });
    expect(calls[0]?.url).toMatch(/\/external-orders\/o1\/cancel$/);

    // The API refuses once the goods physically exist and are moving; this lets
    // a UI hide the button instead of offering an action that throws.
    expect(isCancellable({ status: "PENDING" })).toBe(true);
    expect(isCancellable({ status: "PROCESSING" })).toBe(true);
    expect(isCancellable({ status: "PACKAGED" })).toBe(false);
    expect(isCancellable({ status: "SHIPPED" })).toBe(false);
    expect(isCancellable({ status: "DELIVERED" })).toBe(false);
  });
});

describe("fourthwall platform — products", () => {
  it("tags physical vs digital, and only digital carries a price", async () => {
    const calls = stubFetch([{ body: { id: "p1" } }, { body: { id: "p2" } }]);

    await createProduct(config, { kind: "physical", name: "Tee", profitMargin: 8 });
    expect(calls[0]?.body).toEqual({ name: "Tee", profitMargin: 8, type: "PHYSICAL" });
    // `kind` is the toolkit's discriminant, not a Fourthwall field — it must not
    // ride along into the request body.
    expect(calls[0]?.body).not.toHaveProperty("kind");

    await createProduct(config, {
      kind: "digital",
      name: "Zine",
      price: { value: 5, currency: "USD" },
    });
    expect(calls[1]?.body).toMatchObject({ type: "DIGITAL", price: { value: 5 } });
  });

  it("reads inventory and tolerates an untracked variant", async () => {
    stubFetch([{ body: [{ variantId: "v1", quantity: 4 }, { variantId: "v2" }] }]);
    const stock = await getProductInventory(config, "p1");
    expect(stock).toEqual([
      { variantId: "v1", quantity: 4, raw: { variantId: "v1", quantity: 4 } },
      // null, not 0 — "not stock-tracked" and "none left" are different facts,
      // and collapsing them hides a sellable variant.
      { variantId: "v2", quantity: null, raw: { variantId: "v2" } },
    ]);
  });

  it("toggles availability and state through their own endpoints", async () => {
    const calls = stubFetch([{ body: { id: "p1" } }, { body: { id: "p1" } }]);
    await setProductAvailability(config, "p1", false);
    expect(calls[0]?.url).toMatch(/\/products\/p1\/availability$/);
    expect(calls[0]?.body).toEqual({ available: false });

    await setProductState(config, "p1", "UNAVAILABLE");
    expect(calls[1]?.url).toMatch(/\/products\/p1\/state$/);
    expect(calls[1]?.body).toEqual({ state: "UNAVAILABLE" });
  });

  it("appends images as url objects", async () => {
    const calls = stubFetch([{ body: { id: "p1" } }]);
    await addProductImages(config, "p1", ["https://img/a.png", "https://img/b.png"]);
    expect(calls[0]?.body).toEqual({
      images: [{ url: "https://img/a.png" }, { url: "https://img/b.png" }],
    });
  });

  it("percent-encodes ids into the path", async () => {
    const calls = stubFetch([{ status: 204 }]);
    await deleteProduct(config, "p/1 2");
    expect(calls[0]?.url).toMatch(/\/products\/p%2F1%202$/);
  });
});

describe("fourthwall platform — rate limiting", () => {
  it("paces POST /products rather than letting it 429", async () => {
    vi.useFakeTimers();
    const calls = stubFetch([{ body: { id: "p" } }]);
    // 2 per minute, so the third create has to wait out a refill.
    const limited: FourthwallPlatformConfig = {
      ...config,
      rateLimit: { productCreatesPerMinute: 2, globalPer10s: 100 },
    };

    const make = (n: number) =>
      createProduct(limited, { kind: "physical", name: `p${n}`, profitMargin: 1 });
    const all = Promise.all([make(1), make(2), make(3)]);

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);

    // Half a minute buys exactly one more token at 2/min.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(3);
    await all;
  });

  it("shares one bucket across clients for the same shop", async () => {
    vi.useFakeTimers();
    const calls = stubFetch([{ body: { id: "p" } }]);
    const limits = { productCreatesPerMinute: 1, globalPer10s: 100 } as const;
    // Two API users, one shop. Fourthwall counts per SHOP, so separate buckets
    // would let the pair overrun the real limit together — which is the whole
    // reason `rateLimitKey` exists.
    const userA: FourthwallPlatformConfig = {
      username: "a",
      password: "x",
      rateLimitKey: "shop-1",
      rateLimit: limits,
    };
    const userB: FourthwallPlatformConfig = { ...userA, username: "b" };

    const all = Promise.all([
      createProduct(userA, { kind: "physical", name: "p1", profitMargin: 1 }),
      createProduct(userB, { kind: "physical", name: "p2", profitMargin: 1 }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    await all;
  });

  it("spends from the global bucket too, not just the narrow one", async () => {
    vi.useFakeTimers();
    const calls = stubFetch([{ body: [] }]);
    const limited: FourthwallPlatformConfig = {
      ...config,
      rateLimit: { globalPer10s: 2, productCreatesPerMinute: 5 },
    };
    const all = Promise.all([
      listExternalOrders(limited),
      listExternalOrders(limited),
      listExternalOrders(limited),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(3);
    await all;
  });

  it("opts out entirely when rateLimit is false", async () => {
    const calls = stubFetch([{ body: [] }]);
    await Promise.all(Array.from({ length: 20 }, () => listExternalOrders(config)));
    expect(calls).toHaveLength(20);
  });
});

describe("verifyFourthwallPlatformSignature", () => {
  it("accepts a correct signature and rejects a missing or wrong one", async () => {
    const secret = "whsec";
    const payload = '{"type":"order.placed"}';
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

    expect(await verifyFourthwallPlatformSignature(payload, expected, secret)).toBe(true);
    expect(await verifyFourthwallPlatformSignature(payload, ` ${expected} `, secret)).toBe(true);
    expect(await verifyFourthwallPlatformSignature(payload, null, secret)).toBe(false);
    expect(await verifyFourthwallPlatformSignature(payload, "bogus", secret)).toBe(false);
    expect(await verifyFourthwallPlatformSignature(`${payload} `, expected, secret)).toBe(false);
  });
});
