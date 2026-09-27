// core/commerce/stripe—PaymentIntents, customers, invoices, and webhook
// signatures against a stubbed fetch (#695).
import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "../../src/core/commerce/index.js";
import {
  createAndSendInvoice,
  createLineItemInvoice,
  createPaymentIntent,
  ensureStripeCustomer,
  retrievePaymentIntent,
  verifyStripeSignature,
} from "../../src/core/commerce/stripe.js";
import { UpstreamError } from "../../src/core/security/index.js";

const KEY = "sk_test_example";
const VERSION = "2026-06-24.dahlia";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  form: URLSearchParams | null;
}

/** Stub fetch; `answer` gets the Stripe path (after /v1) and the form. */
function stubStripe(answer: (path: string, form: URLSearchParams | null) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const form = init.body instanceof URLSearchParams ? new URLSearchParams(init.body) : null;
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: init.headers as Record<string, string>,
        form,
      });
      return answer(url.replace("https://api.stripe.com/v1", ""), form);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPaymentIntent", () => {
  it("posts a form-encoded amount, lowercased currency, and slug-qty metadata", async () => {
    const calls = stubStripe(() => json({ id: "pi_1", client_secret: "pi_1_secret" }));
    const out = await createPaymentIntent(
      KEY,
      [
        { slug: "mug", name: "Mug", qty: 2, unitAmountCents: 1200 },
        { slug: "tee", name: "Tee", qty: 1, unitAmountCents: 2500 },
      ],
      { currency: "EUR" },
    );
    expect(out).toEqual({ id: "pi_1", clientSecret: "pi_1_secret", amountCents: 4900 });
    const [call] = calls;
    expect(call.url).toBe("https://api.stripe.com/v1/payment_intents");
    expect(call.method).toBe("POST");
    expect(call.headers).toEqual({
      authorization: `Bearer ${KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": VERSION,
    });
    expect(call.form?.get("amount")).toBe("4900");
    expect(call.form?.get("currency")).toBe("eur");
    expect(call.form?.get("automatic_payment_methods[enabled]")).toBe("true");
    expect(JSON.parse(call.form?.get("metadata[items]") ?? "")).toEqual([
      { s: "mug", q: 2 },
      { s: "tee", q: 1 },
    ]);
  });

  it("defaults the currency to usd", async () => {
    const calls = stubStripe(() => json({ id: "pi_2", client_secret: "s" }));
    await createPaymentIntent(KEY, [{ slug: "a", name: "A", qty: 1, unitAmountCents: 100 }]);
    expect(calls[0].form?.get("currency")).toBe("usd");
  });

  it("prefers decline_code over code in the thrown error", async () => {
    stubStripe(() =>
      json(
        {
          error: {
            message: "Your card was declined.",
            code: "card_declined",
            decline_code: "insufficient_funds",
            type: "card_error",
          },
        },
        402,
      ),
    );
    const err = await createPaymentIntent(KEY, []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    const up = err as UpstreamError;
    expect(up.status).toBe(402);
    expect(up.code).toBe("insufficient_funds");
    expect(up.detail).toBe("Your card was declined.");
    expect(up.operation).toBe("POST /payment_intents");
  });

  it("falls back to code, then type, for the error code", async () => {
    stubStripe(() => json({ error: { code: "amount_too_small" } }, 400));
    await expect(createPaymentIntent(KEY, [])).rejects.toMatchObject({ code: "amount_too_small" });
    stubStripe(() => json({ error: { type: "api_error" } }, 500));
    await expect(createPaymentIntent(KEY, [])).rejects.toMatchObject({
      code: "api_error",
      retryable: true,
    });
  });

  it("keeps a non-JSON error body as truncated detail", async () => {
    stubStripe(() => new Response("x".repeat(800), { status: 502 }));
    const err = (await createPaymentIntent(KEY, []).catch((e: unknown) => e)) as UpstreamError;
    expect(err.code).toBeNull();
    expect(err.detail).toHaveLength(500);
  });

  it("reports null detail for an empty error body", async () => {
    stubStripe(() => new Response("", { status: 503 }));
    const err = (await createPaymentIntent(KEY, []).catch((e: unknown) => e)) as UpstreamError;
    expect(err.detail).toBeNull();
  });

  it("treats a 2xx without a JSON body as a failure", async () => {
    stubStripe(() => new Response("", { status: 200 }));
    await expect(createPaymentIntent(KEY, [])).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("retrievePaymentIntent", () => {
  it("GETs the intent with the pinned version and no content type", async () => {
    const calls = stubStripe(() => json({ id: "pi_9", status: "succeeded" }));
    const pi = await retrievePaymentIntent<{ id: string; status: string }>(KEY, "pi_9");
    expect(pi).toEqual({ id: "pi_9", status: "succeeded" });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers).toEqual({
      authorization: `Bearer ${KEY}`,
      "stripe-version": VERSION,
    });
  });

  it("names the operation on a not-found error", async () => {
    stubStripe(() => json({ error: { code: "resource_missing", message: "No such" } }, 404));
    await expect(retrievePaymentIntent(KEY, "pi_gone")).rejects.toMatchObject({
      status: 404,
      code: "resource_missing",
      operation: "GET /payment_intents/pi_gone",
    });
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_example";
  const payload = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  const sign = (t: number, body = payload, key = secret) => hmacSha256Hex(key, `${t}.${body}`);

  it("accepts a valid signature", async () => {
    const header = `t=${now},v1=${await sign(now)}`;
    expect(await verifyStripeSignature(payload, header, secret, now)).toBe(true);
  });

  it("accepts when any of several v1 signatures matches, ignoring junk parts", async () => {
    const good = await sign(now);
    const header = `t=${now},v1=${"0".repeat(64)},junk,v0=abc, v1=${good}`;
    expect(await verifyStripeSignature(payload, header, secret, now)).toBe(true);
  });

  it("rejects a bad signature", async () => {
    const header = `t=${now},v1=${await sign(now, payload, "whsec_other")}`;
    expect(await verifyStripeSignature(payload, header, secret, now)).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const header = `t=${now},v1=${await sign(now)}`;
    expect(await verifyStripeSignature('{"id":"evt_2"}', header, secret, now)).toBe(false);
  });

  it("rejects a stale timestamp and honors a custom tolerance", async () => {
    const t = now - 301;
    const header = `t=${t},v1=${await sign(t)}`;
    expect(await verifyStripeSignature(payload, header, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, header, secret, now, 600)).toBe(true);
  });

  it("rejects a header missing its timestamp or signatures", async () => {
    const v1 = await sign(now);
    expect(await verifyStripeSignature(payload, `v1=${v1}`, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${now}`, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=soon,v1=${v1}`, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, "", secret, now)).toBe(false);
  });
});

describe("ensureStripeCustomer", () => {
  it("reuses a known customer without calling Stripe", async () => {
    const calls = stubStripe(() => json({}));
    expect(await ensureStripeCustomer(KEY, { email: "alex@example.com", customerId: "cus_1" })).toEqual(
      { id: "cus_1", created: false },
    );
    expect(calls).toHaveLength(0);
  });

  it("creates a customer with name and every address field", async () => {
    const calls = stubStripe(() => json({ id: "cus_new" }));
    const out = await ensureStripeCustomer(KEY, {
      email: "kai@example.com",
      name: "Kai",
      address: {
        line1: "1 Main St",
        line2: "Suite 2",
        city: "Springfield",
        state: "CA",
        postalCode: "94000",
        country: "US",
      },
    });
    expect(out).toEqual({ id: "cus_new", created: true });
    expect(calls[0].url).toBe("https://api.stripe.com/v1/customers");
    expect(Object.fromEntries(calls[0].form ?? [])).toEqual({
      email: "kai@example.com",
      name: "Kai",
      "address[line1]": "1 Main St",
      "address[line2]": "Suite 2",
      "address[city]": "Springfield",
      "address[state]": "CA",
      "address[postal_code]": "94000",
      "address[country]": "US",
    });
  });

  it("sends only the email when nothing else is known", async () => {
    const calls = stubStripe(() => json({ id: "cus_min" }));
    await ensureStripeCustomer(KEY, { email: "quinn@example.com", address: {} });
    expect(Object.fromEntries(calls[0].form ?? [])).toEqual({ email: "quinn@example.com" });
  });
});

describe("createAndSendInvoice", () => {
  it("creates a customer, an item, and an invoice, then finalizes and sends it", async () => {
    const calls = stubStripe((path) => {
      if (path === "/customers") return json({ id: "cus_1" });
      if (path === "/invoiceitems") return json({ id: "ii_1" });
      if (path === "/invoices") return json({ id: "in_1" });
      if (path === "/invoices/in_1/finalize") return json({ id: "in_1" });
      return json({ id: "in_1", hosted_invoice_url: "https://invoice.stripe.com/i/in_1" });
    });
    const out = await createAndSendInvoice(KEY, {
      email: "alex@example.com",
      amountCents: 5000,
      description: "Consulting",
      currency: "CAD",
    });
    expect(out).toEqual({ id: "in_1", hostedUrl: "https://invoice.stripe.com/i/in_1" });
    expect(calls.map((c) => c.url.replace("https://api.stripe.com/v1", ""))).toEqual([
      "/customers",
      "/invoiceitems",
      "/invoices",
      "/invoices/in_1/finalize",
      "/invoices/in_1/send",
    ]);
    expect(Object.fromEntries(calls[1].form ?? [])).toEqual({
      customer: "cus_1",
      amount: "5000",
      currency: "cad",
      description: "Consulting",
    });
    expect(Object.fromEntries(calls[2].form ?? [])).toEqual({
      customer: "cus_1",
      collection_method: "send_invoice",
      days_until_due: "30",
    });
  });

  it("defaults to usd and returns a null URL when Stripe omits one", async () => {
    const calls = stubStripe((path) =>
      path === "/customers" ? json({ id: "cus_2" }) : json({ id: "in_2" }),
    );
    const out = await createAndSendInvoice(KEY, {
      email: "kai@example.com",
      amountCents: 100,
      description: "Fee",
    });
    expect(out).toEqual({ id: "in_2", hostedUrl: null });
    expect(calls[1].form?.get("currency")).toBe("usd");
  });

  it("stops at the first failed step", async () => {
    const calls = stubStripe((path) =>
      path === "/customers" ? json({ id: "cus_3" }) : json({ error: { code: "invalid" } }, 400),
    );
    await expect(
      createAndSendInvoice(KEY, { email: "q@example.com", amountCents: 1, description: "d" }),
    ).rejects.toMatchObject({ operation: "POST /invoiceitems" });
    expect(calls).toHaveLength(2);
  });
});

describe("createLineItemInvoice", () => {
  it("posts each line item, turns on automatic tax, and reads the sent invoice", async () => {
    const calls = stubStripe((path) => {
      if (path === "/invoices") return json({ id: "in_5" });
      if (path.endsWith("/send"))
        return json({
          id: "in_5",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_5",
          number: "INV-0005",
          amount_due: 3210,
        });
      return json({ id: "x" });
    });
    const out = await createLineItemInvoice(KEY, {
      customerId: "cus_9",
      lineItems: [
        { description: "Design", amountCents: 1000.4, quantity: 2 },
        { description: "Setup", amountCents: 500, quantity: 0 },
      ],
      automaticTax: true,
      daysUntilDue: 14,
      currency: "gbp",
    });
    expect(out).toEqual({
      id: "in_5",
      hostedUrl: "https://invoice.stripe.com/i/in_5",
      number: "INV-0005",
      amountCents: 3210,
    });
    expect(Object.fromEntries(calls[0].form ?? [])).toEqual({
      customer: "cus_9",
      currency: "gbp",
      unit_amount: "1000",
      quantity: "2",
      description: "Design",
    });
    // A zero quantity bills one unit.
    expect(calls[1].form?.get("quantity")).toBe("1");
    expect(Object.fromEntries(calls[2].form ?? [])).toEqual({
      customer: "cus_9",
      collection_method: "send_invoice",
      days_until_due: "14",
      auto_advance: "true",
      "automatic_tax[enabled]": "true",
    });
    expect(calls[3].url).toBe("https://api.stripe.com/v1/invoices/in_5/finalize");
    expect(calls[4].url).toBe("https://api.stripe.com/v1/invoices/in_5/send");
  });

  it("computes the total locally when Stripe omits amount_due", async () => {
    const calls = stubStripe((path) => (path === "/invoices" ? json({ id: "in_6" }) : json({ id: "in_6" })));
    const out = await createLineItemInvoice(KEY, {
      customerId: "cus_9",
      lineItems: [
        { description: "A", amountCents: 250, quantity: 3 },
        { description: "B", amountCents: 100, quantity: 0 },
      ],
    });
    expect(out).toEqual({ id: "in_6", hostedUrl: null, number: null, amountCents: 850 });
    expect(calls[0].form?.get("currency")).toBe("usd");
    const invForm = calls[2].form;
    expect(invForm?.get("days_until_due")).toBe("30");
    expect(invForm?.has("automatic_tax[enabled]")).toBe(false);
  });
});
