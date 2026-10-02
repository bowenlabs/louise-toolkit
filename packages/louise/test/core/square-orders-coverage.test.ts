// core/commerce/square—orders, payment links, invoices, subscriptions, and
// loyalty accounts against a stubbed fetch: what Square receives and what
// comes back (#695).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateOrder,
  cancelSubscription,
  createInvoice,
  createOrder,
  createPaymentLink,
  createSubscription,
  deletePaymentLink,
  orderSubtotal,
  pauseSubscription,
  publishInvoice,
  resumeSubscription,
  retrieveInvoice,
  retrieveLoyaltyAccountByCustomer,
  retrieveOrder,
  retrievePaymentLink,
  retrieveSubscription,
  searchOrders,
  searchOrdersByCustomer,
  searchSubscriptionsByCustomer,
  updateSubscription,
} from "../../src/core/commerce/square.js";
import { type DegradedEvent, onDegraded } from "../../src/core/degraded.js";

const CONFIG = { accessToken: "tok", environment: "sandbox" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

interface Reply {
  status?: number;
  body: unknown;
}

/** Stub fetch with a fake Square; `answer` sees each call and its index. */
function square(answer: (call: Call, index: number) => Reply): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const call = {
        method: String(init.method),
        path: new URL(input).pathname,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const { status = 200, body } = answer(call, calls.length - 1);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

const answer = (body: unknown) => square(() => ({ body }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const LINE = { catalogObjectId: "VAR1", quantity: 1 };

describe("retrieveOrder", () => {
  it("GETs the encoded id and maps every field", async () => {
    const calls = answer({
      order: {
        id: "O/1",
        location_id: "L1",
        state: "COMPLETED",
        reference_id: "cart-42",
        customer_id: "C1",
        created_at: "2026-09-27T10:00:00Z",
        closed_at: "2026-09-27T10:05:00Z",
        updated_at: "2026-09-27T10:06:00Z",
        total_money: { amount: 1500, currency: "USD" },
        line_items: [
          {
            name: "Harbor Blend",
            quantity: "2",
            catalog_object_id: "VAR1",
            gross_sales_money: { amount: 1500, currency: "USD" },
          },
          {},
        ],
      },
    });
    const order = await retrieveOrder(CONFIG, "O/1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v2/orders/O%2F1" });
    expect(order).toEqual({
      id: "O/1",
      locationId: "L1",
      state: "COMPLETED",
      totalMoney: { amount: 1500, currency: "USD" },
      totalTaxMoney: { amount: 0, currency: "USD" },
      totalDiscountMoney: { amount: 0, currency: "USD" },
      totalServiceChargeMoney: { amount: 0, currency: "USD" },
      referenceId: "cart-42",
      customerId: "C1",
      createdAt: "2026-09-27T10:00:00Z",
      closedAt: "2026-09-27T10:05:00Z",
      updatedAt: "2026-09-27T10:06:00Z",
      lineItems: [
        {
          name: "Harbor Blend",
          quantity: "2",
          catalogObjectId: "VAR1",
          grossSalesMoney: { amount: 1500, currency: "USD" },
        },
        {
          name: "",
          quantity: "0",
          catalogObjectId: null,
          grossSalesMoney: { amount: 0, currency: "USD" },
        },
      ],
    });
  });

  it.each([
    ["retrieveOrder", () => retrieveOrder(CONFIG, "O9"), /Square order O9 not found/],
    [
      "createOrder",
      () => createOrder(CONFIG, { locationId: "L1", lineItems: [LINE] }),
      /creation returned no order/,
    ],
    [
      "calculateOrder",
      () => calculateOrder(CONFIG, { locationId: "L1", lineItems: [LINE] }),
      /calculation returned no order/,
    ],
  ])("%s throws when Square answers without an order", async (_name, call, message) => {
    answer({});
    await expect(call()).rejects.toThrow(message);
  });

  it("maps a sparse order with empty strings and nulls", async () => {
    answer({ order: {} });
    const order = await createOrder(CONFIG, { locationId: "L1", lineItems: [LINE] });
    expect(order).toMatchObject({
      id: "",
      locationId: "",
      state: "",
      referenceId: null,
      customerId: null,
      createdAt: null,
      lineItems: [],
    });
  });
});

describe("orderSubtotal", () => {
  it("is the total less tax and service charges, so discounts are already out", async () => {
    answer({
      order: {
        total_money: { amount: 2330, currency: "USD" },
        total_tax_money: { amount: 180, currency: "USD" },
        total_discount_money: { amount: 250, currency: "USD" },
        total_service_charge_money: { amount: 150, currency: "USD" },
      },
    });
    const order = await calculateOrder(CONFIG, { locationId: "L1", lineItems: [LINE] });
    expect(orderSubtotal(order)).toEqual({ amount: 2000, currency: "USD" });
  });
});

describe("searchOrdersByCustomer", () => {
  it("asks for one customer's orders, newest first, 50 by default", async () => {
    const calls = answer({ orders: [{ id: "O1" }, { id: "O2" }] });
    const orders = await searchOrdersByCustomer(CONFIG, {
      locationIds: ["L1"],
      customerId: "C1",
    });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/orders/search" });
    expect(calls[0]?.body).toEqual({
      location_ids: ["L1"],
      return_entries: false,
      limit: 50,
      query: {
        filter: { customer_filter: { customer_ids: ["C1"] } },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
      },
    });
    // Ten or fewer locations: Square's own order, untouched.
    expect(orders.map((o) => o.id)).toEqual(["O1", "O2"]);
  });

  it("answers an empty list when the customer has no orders", async () => {
    answer({});
    expect(await searchOrdersByCustomer(CONFIG, { locationIds: ["L1"], customerId: "C1" })).toEqual(
      [],
    );
  });

  it("chunks past ten locations, then re-sorts and trims to the newest `limit` overall", async () => {
    const pages = [
      {
        orders: [
          { id: "A-new", created_at: "2026-09-20T00:00:00Z" },
          { id: "A-old", created_at: "2026-09-01T00:00:00Z" },
        ],
      },
      {
        orders: [{ id: "B-undated" }, { id: "B-newest", created_at: "2026-09-25T00:00:00Z" }],
      },
    ];
    const calls = square((_call, i) => ({ body: pages[i] }));
    const locationIds = Array.from({ length: 12 }, (_, i) => `L${i + 1}`);
    const orders = await searchOrdersByCustomer(CONFIG, {
      locationIds,
      customerId: "C1",
      limit: 3,
    });

    expect(calls.map((c) => (c.body as { location_ids: string[] }).location_ids)).toEqual([
      locationIds.slice(0, 10),
      locationIds.slice(10),
    ]);
    expect(calls.every((c) => (c.body as { limit: number }).limit === 3)).toBe(true);
    // Newest first across both chunks; the order with no timestamp sinks
    // and is the one trimmed.
    expect(orders.map((o) => o.id)).toEqual(["B-newest", "A-new", "A-old"]);
  });
});

describe("searchOrders", () => {
  it("drops the state filter for [] and ranges on updated_at from a start instant", async () => {
    const calls = answer({ orders: [{ id: "O1" }] });
    await searchOrders(CONFIG, {
      locationIds: ["L1"],
      states: [],
      dateField: "updatedAt",
      startAt: "2026-09-01T00:00:00Z",
      sortOrder: "ASC",
      limit: 100,
    });
    expect(calls[0]?.body).toEqual({
      location_ids: ["L1"],
      return_entries: false,
      limit: 100,
      query: {
        filter: { date_time_filter: { updated_at: { start_at: "2026-09-01T00:00:00Z" } } },
        sort: { sort_field: "UPDATED_AT", sort_order: "ASC" },
      },
    });
  });

  it("ranges on closed_at up to an end instant by default", async () => {
    const calls = answer({});
    await searchOrders(CONFIG, { locationIds: ["L1"], endAt: "2026-10-01T00:00:00Z" });
    expect(calls[0]?.body).toMatchObject({
      query: {
        filter: {
          state_filter: { states: ["COMPLETED"] },
          date_time_filter: { closed_at: { end_at: "2026-10-01T00:00:00Z" } },
        },
      },
    });
  });

  it("stops at maxPages even while Square still has a cursor", async () => {
    const calls = answer({ orders: [{ id: "O1" }], cursor: "MORE" });
    const orders = await searchOrders(CONFIG, { locationIds: ["L1"], maxPages: 2 });
    expect(calls).toHaveLength(2);
    expect((calls[1]?.body as { cursor?: string }).cursor).toBe("MORE");
    expect(orders).toHaveLength(2);
  });

  it("re-sorts oldest first across chunks, with an open order's missing closed_at last", async () => {
    const pages = [
      { orders: [{ id: "open" }, { id: "late", closed_at: "2026-09-20T00:00:00Z" }] },
      {
        orders: [
          { id: "early", closed_at: "2026-09-02T00:00:00Z" },
          { id: "also-open" },
          { id: "same-early", closed_at: "2026-09-02T00:00:00Z" },
        ],
      },
    ];
    square((_call, i) => ({ body: pages[i] }));
    const locationIds = Array.from({ length: 11 }, (_, i) => `L${i + 1}`);
    const orders = await searchOrders(CONFIG, { locationIds, sortOrder: "ASC" });
    expect(orders.map((o) => o.id)).toEqual(["early", "same-early", "late", "open", "also-open"]);
  });
});

describe("createPaymentLink", () => {
  const LINK = {
    id: "LINK1",
    version: 1,
    url: "https://square.link/u/example",
    long_url: "https://checkout.square.site/merchant/example",
    order_id: "ORDER1",
    created_at: "2026-09-27T10:00:00Z",
  };

  it("sends a quick-pay link with only the keys it was given", async () => {
    const calls = answer({ payment_link: LINK });
    const link = await createPaymentLink(CONFIG, {
      quickPay: {
        name: "Gift card",
        priceMoney: { amount: 2500, currency: "USD" },
        locationId: "L1",
      },
    });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/online-checkout/payment-links" });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.idempotency_key).toMatch(UUID);
    // Unset options are absent, not null: Square reads a present key as a choice.
    expect(Object.keys(body).sort()).toEqual(["idempotency_key", "quick_pay"]);
    expect(body.quick_pay).toEqual({
      name: "Gift card",
      price_money: { amount: 2500, currency: "USD" },
      location_id: "L1",
    });
    expect(link).toEqual({
      id: "LINK1",
      version: 1,
      url: "https://square.link/u/example",
      longUrl: "https://checkout.square.site/merchant/example",
      orderId: "ORDER1",
      createdAt: "2026-09-27T10:00:00Z",
    });
  });

  it("sends an order-backed link with checkout options, wallets, and buyer data", async () => {
    const calls = answer({ payment_link: {} });
    const link = await createPaymentLink(CONFIG, {
      order: {
        locationId: "L1",
        customerId: "C1",
        referenceId: "cart-42",
        lineItems: [
          { catalogObjectId: "VAR1", quantity: 2, modifierIds: ["MOD1"] },
          { name: "Deposit", priceCents: 5000, quantity: 1 },
        ],
      },
      description: "Order 42",
      paymentNote: "Pickup Tuesday",
      checkoutOptions: {
        redirectUrl: "https://example.com/thanks?cart=42",
        askForShippingAddress: true,
        merchantSupportEmail: "help@example.com",
        allowTipping: true,
        enableCoupon: false,
        enableLoyalty: true,
        shippingFee: { name: "Shipping", charge: { amount: 800, currency: "USD" } },
        acceptedPaymentMethods: {
          applePay: true,
          googlePay: true,
          cashAppPay: false,
          afterpayClearpay: false,
        },
      },
      prePopulatedData: { buyerEmail: "alex@example.com", buyerPhoneNumber: "+18005550103" },
      idempotencyKey: "cart-42-link",
    });
    expect(calls[0]?.body).toEqual({
      idempotency_key: "cart-42-link",
      description: "Order 42",
      payment_note: "Pickup Tuesday",
      order: {
        location_id: "L1",
        customer_id: "C1",
        reference_id: "cart-42",
        line_items: [
          { catalog_object_id: "VAR1", quantity: "2", modifiers: [{ catalog_object_id: "MOD1" }] },
          { name: "Deposit", quantity: "1", base_price_money: { amount: 5000, currency: "USD" } },
        ],
      },
      checkout_options: {
        redirect_url: "https://example.com/thanks?cart=42",
        ask_for_shipping_address: true,
        merchant_support_email: "help@example.com",
        allow_tipping: true,
        enable_coupon: false,
        enable_loyalty: true,
        shipping_fee: { name: "Shipping", charge: { amount: 800, currency: "USD" } },
        accepted_payment_methods: {
          apple_pay: true,
          google_pay: true,
          cash_app_pay: false,
          afterpay_clearpay: false,
        },
      },
      pre_populated_data: { buyer_email: "alex@example.com", buyer_phone_number: "+18005550103" },
    });
    // A sparse link maps to safe defaults.
    expect(link).toEqual({
      id: "",
      version: 0,
      url: "",
      longUrl: null,
      orderId: null,
      createdAt: null,
    });
  });

  it("leaves wallets and shipping out when checkout options don't set them", async () => {
    const calls = answer({ payment_link: LINK });
    await createPaymentLink(CONFIG, {
      order: { locationId: "L1", lineItems: [LINE] },
      checkoutOptions: { redirectUrl: "https://example.com/thanks" },
    });
    expect((calls[0]?.body as { checkout_options: unknown }).checkout_options).toEqual({
      redirect_url: "https://example.com/thanks",
    });
  });

  it.each([
    [
      "both",
      {
        quickPay: { name: "x", priceMoney: { amount: 1, currency: "USD" }, locationId: "L1" },
        order: { locationId: "L1", lineItems: [LINE] },
      },
    ],
    ["neither", {}],
  ])("refuses %s of quickPay and order without calling Square", async (_name, input) => {
    const calls = answer({ payment_link: LINK });
    await expect(createPaymentLink(CONFIG, input)).rejects.toThrow(/exactly one of/);
    expect(calls).toHaveLength(0);
  });

  it("throws when Square answers without a link", async () => {
    answer({});
    await expect(
      createPaymentLink(CONFIG, { order: { locationId: "L1", lineItems: [LINE] } }),
    ).rejects.toThrow(/returned none/);
  });
});

describe("retrievePaymentLink", () => {
  it("GETs the encoded id and maps the link", async () => {
    const calls = answer({
      payment_link: { id: "LINK/1", version: 3, url: "https://square.link/u/a" },
    });
    const link = await retrievePaymentLink(CONFIG, "LINK/1");
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/v2/online-checkout/payment-links/LINK%2F1",
    });
    expect(link).toMatchObject({ id: "LINK/1", version: 3, url: "https://square.link/u/a" });
  });

  it("answers null when Square's body has no link", async () => {
    answer({});
    expect(await retrievePaymentLink(CONFIG, "LINK1")).toBeNull();
  });

  describe("on failure", () => {
    const events: DegradedEvent[] = [];
    let stop = () => {};
    beforeEach(() => {
      events.length = 0;
      // The degrade logs a line; keep it out of the test output.
      vi.spyOn(console, "error").mockImplementation(() => {});
      stop = onDegraded((e) => events.push(e));
    });
    afterEach(() => stop());

    it("answers null for a 404 without reporting a degrade", async () => {
      square(() => ({ status: 404, body: { errors: [{ code: "NOT_FOUND" }] } }));
      expect(await retrievePaymentLink(CONFIG, "LINK1")).toBeNull();
      expect(events).toEqual([]);
    });

    it("answers null for any other failure too, but reports it", async () => {
      square(() => ({ status: 401, body: { errors: [{ code: "UNAUTHORIZED" }] } }));
      expect(await retrievePaymentLink(CONFIG, "LINK1")).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: "commerce.square.paymentLink",
        details: { linkId: "LINK1" },
      });
      expect(events[0]?.cause).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    });
  });
});

describe("deletePaymentLink", () => {
  it("falls back to the id it asked for when Square doesn't echo one", async () => {
    answer({});
    expect(await deletePaymentLink(CONFIG, "LINK1")).toEqual({
      id: "LINK1",
      cancelledOrderId: null,
    });
  });
});

describe("invoices", () => {
  it("emails a schedule whose BALANCE covers the remainder", async () => {
    const calls = answer({ invoice: { id: "INV1", version: 0, status: "DRAFT" } });
    await createInvoice(CONFIG, {
      locationId: "L1",
      orderId: "ORDER1",
      customerId: "C1",
      deliveryMethod: "EMAIL",
      paymentRequests: [
        { type: "DEPOSIT", dueDate: "2026-10-01", amountCents: 10000, currency: "CAD" },
        { type: "BALANCE", dueDate: "2026-11-01" },
      ],
    });
    const body = calls[0]?.body as { idempotency_key: string; invoice: Record<string, unknown> };
    expect(body.idempotency_key).toMatch(UUID);
    expect(body.invoice.delivery_method).toBe("EMAIL");
    expect(body.invoice.payment_requests).toEqual([
      {
        request_type: "DEPOSIT",
        due_date: "2026-10-01",
        tipping_enabled: false,
        fixed_amount_requested_money: { amount: 10000, currency: "CAD" },
      },
      // No fixed amount: Square computes what's left.
      { request_type: "BALANCE", due_date: "2026-11-01", tipping_enabled: false },
    ]);
  });

  it("retrieves one invoice and maps its payment requests", async () => {
    const calls = answer({
      invoice: {
        id: "INV/1",
        version: 4,
        status: "PARTIALLY_PAID",
        order_id: "ORDER1",
        public_url: "https://squareup.com/pay-invoice/example",
        payment_requests: [
          {
            uid: "PR1",
            request_type: "DEPOSIT",
            due_date: "2026-10-01",
            status: "PAID",
            computed_amount_money: { amount: 10000, currency: "USD" },
            total_completed_amount_money: { amount: 10000, currency: "USD" },
          },
          {},
        ],
      },
    });
    const invoice = await retrieveInvoice(CONFIG, "INV/1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v2/invoices/INV%2F1" });
    expect(invoice).toEqual({
      id: "INV/1",
      version: 4,
      status: "PARTIALLY_PAID",
      orderId: "ORDER1",
      publicUrl: "https://squareup.com/pay-invoice/example",
      paymentRequests: [
        {
          uid: "PR1",
          requestType: "DEPOSIT",
          dueDate: "2026-10-01",
          status: "PAID",
          computedAmountCents: 10000,
          totalCompletedAmountCents: 10000,
        },
        {
          uid: null,
          requestType: "",
          dueDate: null,
          status: null,
          computedAmountCents: 0,
          totalCompletedAmountCents: 0,
        },
      ],
    });
  });

  it("maps a sparse invoice with safe defaults", async () => {
    answer({ invoice: {} });
    expect(await retrieveInvoice(CONFIG, "INV1")).toEqual({
      id: "",
      version: 0,
      status: "",
      orderId: null,
      publicUrl: null,
      paymentRequests: [],
    });
  });

  it.each([
    ["retrieveInvoice", () => retrieveInvoice(CONFIG, "INV9"), /Square invoice INV9 not found/],
    [
      "createInvoice",
      () =>
        createInvoice(CONFIG, {
          locationId: "L1",
          orderId: "O1",
          customerId: "C1",
          paymentRequests: [],
        }),
      /returned no invoice/,
    ],
    ["publishInvoice", () => publishInvoice(CONFIG, "INV1", 0), /INV1 publish returned none/],
  ])("%s throws when Square answers without an invoice", async (_name, call, message) => {
    answer({});
    await expect(call()).rejects.toThrow(message);
  });
});

describe("subscriptions", () => {
  /** The mapped shape of a subscription Square sent nothing about. */
  const EMPTY = {
    id: "",
    status: "",
    planVariationId: null,
    customerId: null,
    cardId: null,
    locationId: null,
    startDate: null,
    canceledDate: null,
    chargedThroughDate: null,
    invoiceIds: [],
    phases: [],
    actions: [],
    version: null,
    createdAt: null,
  };

  it("searches one customer's subscriptions, at every location by default", async () => {
    const calls = answer({
      subscriptions: [
        {
          id: "SUB1",
          status: "ACTIVE",
          plan_variation_id: "PLAN1",
          customer_id: "C1",
          card_id: "CARD1",
          location_id: "L1",
          start_date: "2026-09-01",
          canceled_date: "2026-12-01",
          charged_through_date: "2026-10-01",
          invoice_ids: ["INV2", "INV1"],
          phases: [
            { uid: "P1", ordinal: 0, order_template_id: "ORD_T", plan_phase_uid: "PP1" },
            {},
          ],
          actions: [{ id: "A1", type: "CANCEL", effective_date: "2026-12-01" }],
          version: 3,
          created_at: "2026-09-01T10:00:00Z",
        },
        {},
      ],
    });
    const subs = await searchSubscriptionsByCustomer(CONFIG, { customerId: "C1" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/subscriptions/search" });
    expect(calls[0]?.body).toEqual({ query: { filter: { customer_ids: ["C1"] } } });
    expect(subs).toEqual([
      {
        id: "SUB1",
        status: "ACTIVE",
        planVariationId: "PLAN1",
        customerId: "C1",
        cardId: "CARD1",
        locationId: "L1",
        startDate: "2026-09-01",
        canceledDate: "2026-12-01",
        chargedThroughDate: "2026-10-01",
        invoiceIds: ["INV2", "INV1"],
        phases: [
          { uid: "P1", ordinal: 0, orderTemplateId: "ORD_T", planPhaseUid: "PP1" },
          // A phase without an ordinal takes its position in the list.
          { uid: null, ordinal: 1, orderTemplateId: null, planPhaseUid: null },
        ],
        actions: [
          { id: "A1", type: "CANCEL", effectiveDate: "2026-12-01", newPlanVariationId: null },
        ],
        version: 3,
        createdAt: "2026-09-01T10:00:00Z",
      },
      EMPTY,
    ]);
  });

  it("narrows to locations when given, and answers [] for none found", async () => {
    const calls = answer({});
    expect(
      await searchSubscriptionsByCustomer(CONFIG, { customerId: "C1", locationIds: ["L1"] }),
    ).toEqual([]);
    expect(calls[0]?.body).toEqual({
      query: { filter: { customer_ids: ["C1"], location_ids: ["L1"] } },
    });
  });

  it("retrieves one subscription with its actions, and null for an unknown id", async () => {
    const calls = square((call) =>
      call.path.endsWith("/SUB1")
        ? { body: { subscription: { id: "SUB1", status: "PAUSED" } } }
        : { status: 404, body: { errors: [{ code: "NOT_FOUND" }] } },
    );
    expect(await retrieveSubscription(CONFIG, "SUB1")).toMatchObject({
      id: "SUB1",
      status: "PAUSED",
    });
    expect(await retrieveSubscription(CONFIG, "nope")).toBeNull();
    expect(calls[0]).toMatchObject({ method: "GET", path: "/v2/subscriptions/SUB1" });
  });

  it("throws when a retrieve answers 200 without a subscription", async () => {
    answer({});
    await expect(retrieveSubscription(CONFIG, "SUB1")).rejects.toThrow(/SUB1 not found/);
  });

  it("enrolls a customer against a saved card", async () => {
    const calls = answer({ subscription: { id: "SUB1", status: "PENDING" } });
    const sub = await createSubscription(CONFIG, {
      locationId: "L1",
      planVariationId: "PLAN1",
      customerId: "C1",
      cardId: "CARD1",
      idempotencyKey: "enroll C1 in PLAN1",
    });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/subscriptions" });
    // Nothing optional is sent when nothing optional was given.
    expect(calls[0]?.body).toEqual({
      idempotency_key: "enroll C1 in PLAN1",
      location_id: "L1",
      plan_variation_id: "PLAN1",
      customer_id: "C1",
      card_id: "CARD1",
    });
    expect(sub).toMatchObject({ id: "SUB1", status: "PENDING" });
  });

  it("enrolls against order templates, with a start date, override, tax, and zone", async () => {
    const calls = answer({ subscription: { id: "SUB1", status: "PENDING" } });
    await createSubscription(CONFIG, {
      locationId: "L1",
      planVariationId: "PLAN1",
      customerId: "C1",
      cardId: "CARD1",
      startDate: "2026-11-01",
      phases: [{ ordinal: 0, orderTemplateId: "ORD_T" }],
      priceOverride: { amount: 1800, currency: "USD" },
      taxPercentage: "8.5",
      timezone: "America/Chicago",
    });
    expect(calls[0]?.body).toMatchObject({
      start_date: "2026-11-01",
      phases: [{ ordinal: 0, order_template_id: "ORD_T" }],
      price_override_money: { amount: 1800, currency: "USD" },
      tax_percentage: "8.5",
      timezone: "America/Chicago",
    });
    expect((calls[0]?.body as { idempotency_key: string }).idempotency_key).toMatch(UUID);
  });

  it("throws when Square answers without a subscription", async () => {
    answer({});
    await expect(
      createSubscription(CONFIG, {
        locationId: "L1",
        planVariationId: "PLAN1",
        customerId: "C1",
        cardId: "CARD1",
      }),
    ).rejects.toThrow(/returned no subscription/);
  });

  it("updates sparsely: a new card, a cleared cancel, and the version read", async () => {
    const calls = answer({ subscription: { id: "SUB1", status: "ACTIVE", version: 4 } });
    const sub = await updateSubscription(CONFIG, "SUB1", {
      cardId: "CARD2",
      canceledDate: null,
      version: 3,
    });
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/v2/subscriptions/SUB1" });
    expect(calls[0]?.body).toEqual({
      subscription: { card_id: "CARD2", canceled_date: null, version: 3 },
    });
    expect(sub).toMatchObject({ id: "SUB1", version: 4 });
  });

  it("sends an empty subscription for an update with nothing to change", async () => {
    const calls = answer({ subscription: { id: "SUB1" } });
    await updateSubscription(CONFIG, "SUB1", {});
    expect(calls[0]?.body).toEqual({ subscription: {} });
    answer({});
    await expect(updateSubscription(CONFIG, "SUB1", { cardId: "CARD2" })).rejects.toThrow(
      /update returned no subscription/,
    );
  });

  it("cancels at the end of the period, answering the scheduled action", async () => {
    const calls = answer({
      subscription: { id: "SUB1", status: "ACTIVE", canceled_date: "2026-11-01" },
      actions: [{ id: "A1", type: "CANCEL", effective_date: "2026-11-01" }],
    });
    const change = await cancelSubscription(CONFIG, "SUB1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/v2/subscriptions/SUB1/cancel",
      body: {},
    });
    expect(change.subscription).toMatchObject({ status: "ACTIVE", canceledDate: "2026-11-01" });
    expect(change.actions).toEqual([
      { id: "A1", type: "CANCEL", effectiveDate: "2026-11-01", newPlanVariationId: null },
    ]);
  });

  it("pauses with an empty body by default, and passes each option through", async () => {
    const calls = answer({ subscription: { id: "SUB1" }, actions: [{ type: "PAUSE" }] });
    const change = await pauseSubscription(CONFIG, "SUB1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/v2/subscriptions/SUB1/pause",
      body: {},
    });
    expect(change.actions).toEqual([
      { id: "", type: "PAUSE", effectiveDate: null, newPlanVariationId: null },
    ]);
    await pauseSubscription(CONFIG, "SUB1", {
      pauseEffectiveDate: "2026-11-01",
      pauseCycles: 2,
      resumeEffectiveDate: "2027-01-01",
      resumeChangeTiming: "END_OF_PERIOD",
      pauseReason: "Travelling",
    });
    expect(calls[1]?.body).toEqual({
      pause_effective_date: "2026-11-01",
      pause_cycle_duration: 2,
      resume_effective_date: "2027-01-01",
      resume_change_timing: "END_OF_PERIOD",
      pause_reason: "Travelling",
    });
  });

  it("resumes now by default, or on a date with a timing", async () => {
    const calls = answer({ subscription: { id: "SUB1", status: "ACTIVE" }, actions: [] });
    await resumeSubscription(CONFIG, "SUB1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/v2/subscriptions/SUB1/resume",
      body: {},
    });
    await resumeSubscription(CONFIG, "SUB1", {
      resumeEffectiveDate: "2026-11-15",
      resumeChangeTiming: "IMMEDIATE",
    });
    expect(calls[1]?.body).toEqual({
      resume_effective_date: "2026-11-15",
      resume_change_timing: "IMMEDIATE",
    });
  });

  it.each([
    ["cancelSubscription", () => cancelSubscription(CONFIG, "SUB1"), /cancel returned no/],
    ["pauseSubscription", () => pauseSubscription(CONFIG, "SUB1"), /pause returned no/],
    ["resumeSubscription", () => resumeSubscription(CONFIG, "SUB1"), /resume returned no/],
  ])("%s throws when Square answers without a subscription", async (_name, call, message) => {
    answer({});
    await expect(call()).rejects.toThrow(message);
  });
});

describe("retrieveLoyaltyAccountByCustomer", () => {
  it("searches for one account by customer and maps it", async () => {
    const calls = answer({
      loyalty_accounts: [
        { id: "LA1", program_id: "P1", balance: 40, lifetime_points: 120, customer_id: "C1" },
      ],
    });
    const account = await retrieveLoyaltyAccountByCustomer(CONFIG, "C1");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/loyalty/accounts/search" });
    expect(calls[0]?.body).toEqual({ query: { customer_ids: ["C1"] }, limit: 1 });
    expect(account).toEqual({
      id: "LA1",
      programId: "P1",
      balance: 40,
      lifetimePoints: 120,
      customerId: "C1",
    });
  });

  it("maps a sparse account to zero points", async () => {
    answer({ loyalty_accounts: [{}] });
    expect(await retrieveLoyaltyAccountByCustomer(CONFIG, "C1")).toEqual({
      id: "",
      programId: null,
      balance: 0,
      lifetimePoints: 0,
      customerId: null,
    });
  });

  it("answers null for a customer with no account", async () => {
    answer({ loyalty_accounts: [] });
    expect(await retrieveLoyaltyAccountByCustomer(CONFIG, "C1")).toBeNull();
  });
});
