// core/commerce/square—the request path (headers, hosts, errors, retry and
// Retry-After, timeouts) plus customers, cards, inventory, locations, and
// payments, against a stubbed fetch (#695).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  batchChangeInventory,
  createCard,
  createCustomer,
  createLocation,
  createPayment,
  deletePaymentLink,
  ensureCustomer,
  listCards,
  listLocations,
  retrieveCustomer,
  retrieveInventoryCounts,
  retrieveLocation,
  retrievePayment,
  SQUARE_VERSION,
  SquareApiError,
  searchCustomersByEmail,
  updateCustomer,
  updateLocation,
} from "../../src/core/commerce/square.js";
import { UpstreamError } from "../../src/core/security/index.js";

const CONFIG = { accessToken: "tok", environment: "sandbox" } as const;
const SANDBOX = "https://connect.squareupsandbox.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Call {
  method: string;
  origin: string;
  path: string;
  search: URLSearchParams;
  headers: Headers;
  body: unknown;
  init: RequestInit;
}

interface Reply {
  status?: number;
  body?: unknown;
  /** A raw body, sent as is instead of JSON. */
  raw?: string;
  headers?: Record<string, string>;
}

/** Stub fetch with a fake Square; `answer` sees each call and its index. */
function square(answer: (call: Call, index: number) => Reply | Promise<Reply>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      const call: Call = {
        method: String(init.method),
        origin: url.origin,
        path: url.pathname,
        search: url.searchParams,
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        init,
      };
      calls.push(call);
      const reply = await answer(call, calls.length - 1);
      const text = reply.raw ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
      return new Response(text, { status: reply.status ?? 200, headers: reply.headers });
    }),
  );
  return calls;
}

const answer = (body: unknown) => square(() => ({ body }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the request path", () => {
  it("sends the bearer token, JSON headers, and the pinned version to the sandbox by default", async () => {
    const calls = answer({ locations: [] });
    await listLocations({ accessToken: "tok" });
    const [call] = calls;
    expect(call?.origin).toBe(SANDBOX);
    expect(call?.method).toBe("GET");
    expect(call?.headers.get("authorization")).toBe("Bearer tok");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.headers.get("accept")).toBe("application/json");
    expect(call?.headers.get("square-version")).toBe(SQUARE_VERSION);
    // Provider APIs don't redirect, so a 3xx comes back rather than being followed.
    expect(call?.init.redirect).toBe("manual");
    // A GET carries no body at all, not an empty JSON one.
    expect(call?.init.body).toBeUndefined();
  });

  it("uses the production host and a version the caller pins", async () => {
    const calls = answer({ locations: [] });
    await listLocations({ accessToken: "tok", environment: "production", version: "2025-10-16" });
    expect(calls[0]?.origin).toBe("https://connect.squareup.com");
    expect(calls[0]?.headers.get("square-version")).toBe("2025-10-16");
  });

  it("turns a decline into a SquareApiError with status, code, and category", async () => {
    square(() => ({
      status: 402,
      body: {
        errors: [
          { code: "CARD_DECLINED", category: "PAYMENT_METHOD_ERROR", detail: "Card declined." },
        ],
      },
    }));
    const err = await createPayment(CONFIG, {
      sourceId: "cnon:card-nonce-ok",
      amountMoney: { amount: 1200, currency: "USD" },
      locationId: "L1",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SquareApiError);
    expect(err).toMatchObject({
      status: 402,
      code: "CARD_DECLINED",
      category: "PAYMENT_METHOD_ERROR",
      retryable: false,
      detail: "Card declined.",
      operation: "POST /v2/payments",
    });
    expect((err as Error).message).toBe("Square request failed (402 CARD_DECLINED)");
  });

  it("keeps a non-JSON error page out of the message, and only its first 500 characters in detail", async () => {
    const page = `<html>${"x".repeat(600)}</html>`;
    square(() => ({ status: 502, raw: page }));
    const err = (await listLocations(CONFIG).catch((e: unknown) => e)) as SquareApiError;
    expect(err).toBeInstanceOf(SquareApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBeNull();
    expect(err.category).toBeNull();
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("Square request failed (502)");
    expect(err.detail).toBe(page.slice(0, 500));
  });

  it("refuses a 2xx whose body isn't JSON", async () => {
    square(() => ({ raw: "OK" }));
    const err = (await listLocations(CONFIG).catch((e: unknown) => e)) as SquareApiError;
    expect(err).toBeInstanceOf(SquareApiError);
    expect(err).toMatchObject({ status: 200, code: "INVALID_RESPONSE", detail: "OK" });
  });

  it("strips the query from the operation it reports", async () => {
    square(() => ({ status: 400, body: { errors: [{ code: "BAD_REQUEST" }] } }));
    const err = (await listCards(CONFIG, { customerId: "C1" }).catch(
      (e: unknown) => e,
    )) as SquareApiError;
    expect(err.operation).toBe("GET /v2/cards");
  });

  it("sends DELETE with no body and maps the cancelled order", async () => {
    const calls = answer({ id: "LINK1", cancelled_order_id: "ORDER1" });
    const res = await deletePaymentLink(CONFIG, "LINK1");
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      path: "/v2/online-checkout/payment-links/LINK1",
    });
    expect(calls[0]?.init.body).toBeUndefined();
    expect(res).toEqual({ id: "LINK1", cancelledOrderId: "ORDER1" });
  });
});

describe("SquareConfig.retry", () => {
  const slowDown = { status: 429, body: { errors: [{ code: "RATE_LIMITED" }] } };

  it("waits for Square's Retry-After on a 429 rather than its own backoff", async () => {
    vi.useFakeTimers();
    const calls = square((_call, i) =>
      i === 0 ? { ...slowDown, headers: { "retry-after": "3" } } : { body: { locations: [] } },
    );
    const done = listLocations({ ...CONFIG, retry: { attempts: 1, baseDelayMs: 10 } });
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await expect(done).resolves.toEqual([]);
  });

  it("backs off exponentially up to maxDelayMs when Retry-After isn't a number of seconds", async () => {
    vi.useFakeTimers();
    // No jitter, so each step lands on an exact tick.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const calls = square((_call, i) =>
      i < 3
        ? {
            status: 503,
            body: { errors: [{ code: "SERVICE_UNAVAILABLE" }] },
            // The HTTP-date form: not seconds, so the backoff curve applies.
            headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
          }
        : { body: { locations: [{ id: "L1", name: "Main Street" }] } },
    );
    const done = listLocations({
      ...CONFIG,
      retry: { attempts: 3, baseDelayMs: 100, maxDelayMs: 150 },
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); // 100 ms: the first step
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(149);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // 150 ms: 200 capped at maxDelayMs
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(150); // 400 capped at 150
    expect(calls).toHaveLength(4);
    const locations = await done;
    expect(locations.map((l) => l.id)).toEqual(["L1"]);
  });

  it("defaults to two retries when retry is set without attempts", async () => {
    vi.useFakeTimers();
    const calls = square(() => ({
      status: 500,
      body: { errors: [{ code: "INTERNAL_SERVER_ERROR" }] },
    }));
    const done = listLocations({ ...CONFIG, retry: {} }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = (await done) as SquareApiError;
    expect(calls).toHaveLength(3);
    expect(err).toBeInstanceOf(SquareApiError);
    expect(err).toMatchObject({ status: 500, code: "INTERNAL_SERVER_ERROR", retryable: true });
  });

  it("throws the last error once the attempts run out", async () => {
    let n = 0;
    const calls = square(() => ({
      status: 500,
      body: { errors: [{ code: `FAULT_${++n}` }] },
    }));
    const err = (await listLocations({
      ...CONFIG,
      retry: { attempts: 1, baseDelayMs: 1 },
    }).catch((e: unknown) => e)) as SquareApiError;
    expect(calls).toHaveLength(2);
    expect(err.code).toBe("FAULT_2");
  });

  it("does nothing extra when attempts is 0", async () => {
    const calls = square(() => slowDown);
    await expect(listLocations({ ...CONFIG, retry: { attempts: 0 } })).rejects.toBeInstanceOf(
      SquareApiError,
    );
    expect(calls).toHaveLength(1);
  });

  it("retries a request that got no response at all", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (n++ === 0) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ locations: [{ id: "L1" }] }), { status: 200 });
      }),
    );
    const locations = await listLocations({ ...CONFIG, retry: { attempts: 1, baseDelayMs: 1 } });
    expect(n).toBe(2);
    expect(locations.map((l) => l.id)).toEqual(["L1"]);
  });

  it("throws the network failure itself when no retries remain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const err = (await listLocations({
      ...CONFIG,
      retry: { attempts: 1, baseDelayMs: 1 },
    }).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).not.toBeInstanceOf(SquareApiError);
    expect(err).toMatchObject({ status: 0, code: "network", retryable: true });
    expect(err.operation).toBe("GET /v2/locations");
  });
});

describe("SquareConfig.timeoutMs", () => {
  it("abandons an attempt that runs past it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    const err = (await listLocations({ ...CONFIG, timeoutMs: 5 }).catch(
      (e: unknown) => e,
    )) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ status: 0, code: "timeout" });
    expect(err.message).toBe("Square request failed (timed out)");
  });
});

describe("customers", () => {
  it("searches by exact email, one result", async () => {
    const calls = answer({ customers: [{ id: "C1", email_address: "alex@example.com" }] });
    const found = await searchCustomersByEmail(CONFIG, "alex@example.com");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/v2/customers/search",
      body: { query: { filter: { email_address: { exact: "alex@example.com" } } }, limit: 1 },
    });
    expect(found).toEqual([
      { id: "C1", email: "alex@example.com", givenName: null, familyName: null, phoneNumber: null },
    ]);
  });

  it("answers an empty list when Square finds nobody", async () => {
    answer({});
    expect(await searchCustomersByEmail(CONFIG, "nobody@example.com")).toEqual([]);
  });

  it("retrieves one customer by an encoded id", async () => {
    const calls = answer({
      customer: {
        id: "C/1",
        email_address: "kai@example.com",
        given_name: "Kai",
        family_name: "Doe",
        phone_number: "+18005550100",
      },
    });
    const c = await retrieveCustomer(CONFIG, "C/1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v2/customers/C%2F1" });
    expect(c).toEqual({
      id: "C/1",
      email: "kai@example.com",
      givenName: "Kai",
      familyName: "Doe",
      phoneNumber: "+18005550100",
    });
  });

  it("creates a customer with every field it was given", async () => {
    const calls = answer({ customer: { id: "C2", email_address: "quinn@example.com" } });
    const c = await createCustomer(CONFIG, {
      email: "quinn@example.com",
      givenName: "Quinn",
      familyName: "Doe",
      phoneNumber: "+18005550101",
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/v2/customers",
      body: {
        email_address: "quinn@example.com",
        given_name: "Quinn",
        family_name: "Doe",
        phone_number: "+18005550101",
      },
    });
    expect(c.id).toBe("C2");
  });

  it("returns an existing customer without creating one", async () => {
    const calls = answer({ customers: [{ id: "C1", email_address: "alex@example.com" }] });
    const res = await ensureCustomer(CONFIG, { email: "alex@example.com", givenName: "Alex" });
    expect(res.created).toBe(false);
    expect(res.customer.id).toBe("C1");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["retrieveCustomer", () => retrieveCustomer(CONFIG, "C9"), /Square customer C9 not found/],
    [
      "createCustomer",
      () => createCustomer(CONFIG, { email: "alex@example.com" }),
      /returned no customer/,
    ],
    [
      "updateCustomer",
      () => updateCustomer(CONFIG, "C1", { givenName: "Alex" }),
      /update returned no customer/,
    ],
  ])("%s throws when Square answers without a customer", async (_name, call, message) => {
    answer({});
    await expect(call()).rejects.toThrow(message);
  });
});

describe("cards", () => {
  it("sends the token, verification token, and customer, with a random idempotency key", async () => {
    const calls = answer({ card: { id: "CARD1", customer_id: "C1" } });
    await createCard(CONFIG, {
      sourceId: "cnon:card-nonce-ok",
      customerId: "C1",
      verificationToken: "verf-1",
    });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      source_id: "cnon:card-nonce-ok",
      verification_token: "verf-1",
      card: { customer_id: "C1" },
    });
    expect(body.idempotency_key).toMatch(UUID);
  });

  it("throws when Square answers without a card", async () => {
    answer({});
    await expect(
      createCard(CONFIG, { sourceId: "cnon:card-nonce-ok", customerId: "C1" }),
    ).rejects.toThrow(/returned no card/);
  });

  it("asks for disabled cards too when told, and stops at maxPages", async () => {
    const calls = answer({ cards: [{ id: "CARD1", enabled: false }], cursor: "MORE" });
    const cards = await listCards(CONFIG, {
      customerId: "C1",
      includeDisabled: true,
      maxPages: 1,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.search.get("include_disabled")).toBe("true");
    expect(calls[0]?.search.get("customer_id")).toBe("C1");
    expect(cards).toEqual([
      {
        id: "CARD1",
        last4: null,
        cardBrand: null,
        expMonth: null,
        expYear: null,
        customerId: null,
        enabled: false,
      },
    ]);
  });
});

describe("inventory", () => {
  it("batch-retrieves counts for the given locations, as numbers", async () => {
    const calls = answer({
      counts: [
        { catalog_object_id: "VAR1", state: "IN_STOCK", quantity: "4.5", location_id: "L1" },
        {},
      ],
    });
    const counts = await retrieveInventoryCounts(CONFIG, ["VAR1"], ["L1"]);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/v2/inventory/counts/batch-retrieve",
      body: { catalog_object_ids: ["VAR1"], location_ids: ["L1"] },
    });
    expect(counts).toEqual([
      { catalogObjectId: "VAR1", state: "IN_STOCK", quantity: 4.5, locationId: "L1" },
      { catalogObjectId: "", state: "", quantity: 0, locationId: "" },
    ]);
  });

  it("leaves location_ids out when none are given, so every location counts", async () => {
    const calls = answer({});
    expect(await retrieveInventoryCounts(CONFIG, ["VAR1"])).toEqual([]);
    expect(calls[0]?.body).toEqual({ catalog_object_ids: ["VAR1"] });
  });

  it("sends an ADJUSTMENT as a string delta between states, stamped now by default", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
    const calls = answer({
      counts: [{ catalog_object_id: "VAR1", state: "SOLD", quantity: "2", location_id: "L1" }],
    });
    const counts = await batchChangeInventory(
      CONFIG,
      [
        {
          type: "ADJUSTMENT",
          catalogObjectId: "VAR1",
          locationId: "L1",
          quantity: 2,
          fromState: "IN_STOCK",
          toState: "SOLD",
        },
        {
          type: "PHYSICAL_COUNT",
          catalogObjectId: "VAR2",
          locationId: "L1",
          quantity: 7,
          state: "IN_STOCK",
          occurredAt: "2026-09-26T08:00:00Z",
        },
      ],
      { idempotencyKey: "recount of 2026-09-27" },
    );
    expect(calls[0]).toMatchObject({ path: "/v2/inventory/changes/batch-create" });
    expect(calls[0]?.body).toEqual({
      idempotency_key: "recount of 2026-09-27",
      changes: [
        {
          type: "ADJUSTMENT",
          adjustment: {
            catalog_object_id: "VAR1",
            location_id: "L1",
            from_state: "IN_STOCK",
            to_state: "SOLD",
            quantity: "2",
            occurred_at: "2026-09-27T12:00:00.000Z",
          },
        },
        {
          type: "PHYSICAL_COUNT",
          physical_count: {
            catalog_object_id: "VAR2",
            location_id: "L1",
            state: "IN_STOCK",
            quantity: "7",
            occurred_at: "2026-09-26T08:00:00Z",
          },
        },
      ],
    });
    expect(counts).toEqual([
      { catalogObjectId: "VAR1", state: "SOLD", quantity: 2, locationId: "L1" },
    ]);
  });

  it("answers an empty list when Square returns no counts", async () => {
    answer({});
    const counts = await batchChangeInventory(CONFIG, []);
    expect(counts).toEqual([]);
  });
});

describe("locations", () => {
  it("answers null when Square's body has no location", async () => {
    answer({});
    expect(await retrieveLocation(CONFIG, "L1")).toBeNull();
  });

  it("still throws a failure that isn't a 404", async () => {
    square(() => ({ status: 401, body: { errors: [{ code: "UNAUTHORIZED" }] } }));
    await expect(retrieveLocation(CONFIG, "L1")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("fills defaults for a location Square describes sparsely", async () => {
    answer({ locations: [{}] });
    expect(await listLocations(CONFIG)).toEqual([
      {
        id: "",
        name: "",
        status: "",
        currency: "USD",
        timezone: null,
        address: null,
        businessName: null,
      },
    ]);
  });

  it("sends every address part it's given on create", async () => {
    const calls = answer({ location: { id: "L2", name: "Harbor" } });
    await createLocation(CONFIG, {
      name: "Harbor",
      businessName: "Example Organization",
      timezone: "America/Chicago",
      address: { line2: "Suite 2", country: "US" },
    });
    expect(calls[0]?.body).toEqual({
      location: {
        name: "Harbor",
        business_name: "Example Organization",
        timezone: "America/Chicago",
        address: { address_line_2: "Suite 2", country: "US" },
      },
    });
  });

  it.each([
    ["createLocation", () => createLocation(CONFIG, { name: "Harbor" }), /returned no location/],
    [
      "updateLocation",
      () => updateLocation(CONFIG, "L1", { name: "Harbor" }),
      /Square location L1 update returned none/,
    ],
  ])("%s throws when Square answers without a location", async (_name, call, message) => {
    answer({});
    await expect(call()).rejects.toThrow(message);
  });
});

describe("createPayment", () => {
  it("sends every optional field and maps a sparse payment with safe defaults", async () => {
    const calls = answer({ payment: {} });
    const payment = await createPayment(CONFIG, {
      sourceId: "cnon:card-nonce-ok",
      amountMoney: { amount: 2500, currency: "USD" },
      locationId: "L1",
      orderId: "ORDER1",
      customerId: "C1",
      verificationToken: "verf-1",
      buyerEmailAddress: "alex@example.com",
      referenceId: "cart-42",
      idempotencyKey: "checkout-42",
    });
    expect(calls[0]?.body).toEqual({
      source_id: "cnon:card-nonce-ok",
      idempotency_key: "checkout-42",
      amount_money: { amount: 2500, currency: "USD" },
      location_id: "L1",
      order_id: "ORDER1",
      customer_id: "C1",
      verification_token: "verf-1",
      buyer_email_address: "alex@example.com",
      reference_id: "cart-42",
    });
    expect(payment).toEqual({
      id: "",
      status: "",
      orderId: null,
      amountMoney: { amount: 0, currency: "USD" },
      tipMoney: { amount: 0, currency: "USD" },
      receiptUrl: null,
      createdAt: null,
    });
  });

  it("throws when Square answers without a payment", async () => {
    answer({});
    await expect(
      createPayment(CONFIG, {
        sourceId: "cnon:card-nonce-ok",
        amountMoney: { amount: 100, currency: "USD" },
        locationId: "L1",
      }),
    ).rejects.toThrow(/returned no payment/);
  });
});

describe("retrievePayment", () => {
  it("GETs the encoded id and maps every field", async () => {
    const calls = answer({
      payment: {
        id: "P/1",
        status: "COMPLETED",
        order_id: "O1",
        receipt_url: "https://squareup.com/receipt/preview/P1",
        created_at: "2026-10-02T15:00:00.000Z",
        amount_money: { amount: 1500, currency: "USD" },
        tip_money: { amount: 200, currency: "USD" },
      },
    });
    const payment = await retrievePayment(CONFIG, "P/1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v2/payments/P%2F1" });
    expect(payment).toEqual({
      id: "P/1",
      status: "COMPLETED",
      orderId: "O1",
      amountMoney: { amount: 1500, currency: "USD" },
      tipMoney: { amount: 200, currency: "USD" },
      receiptUrl: "https://squareup.com/receipt/preview/P1",
      createdAt: "2026-10-02T15:00:00.000Z",
    });
  });

  it("throws when Square answers without a payment", async () => {
    answer({});
    await expect(retrievePayment(CONFIG, "P9")).rejects.toThrow(/Square payment P9 not found/);
  });
});
