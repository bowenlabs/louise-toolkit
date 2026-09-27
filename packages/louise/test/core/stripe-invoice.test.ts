import { afterEach, describe, expect, it, vi } from "vitest";
import { createAndSendInvoice, createLineItemInvoice } from "../../src/core/commerce/stripe.js";

// #701: the invoice helpers lowercase the currency, round the fallback total
// the way they round each line, and encode the invoice id in the path.

afterEach(() => vi.unstubAllGlobals());

function stripe(invoice: Record<string, unknown> = {}) {
  const calls: { path: string; body: URLSearchParams }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname.replace(/^\/v1/, "");
      calls.push({ path, body: new URLSearchParams(String(init.body ?? "")) });
      if (path === "/customers") return Response.json({ id: "cus_1" });
      if (path === "/invoiceitems") return Response.json({ id: "ii_1" });
      if (path === "/invoices") return Response.json({ id: "in_1/x" });
      return Response.json({ id: "in_1/x", ...invoice });
    }),
  );
  return calls;
}

describe("createLineItemInvoice", () => {
  it("sends the currency lowercase, like the other helpers", async () => {
    const calls = stripe();
    await createLineItemInvoice("sk_test", {
      customerId: "cus_1",
      currency: "GBP",
      lineItems: [{ description: "Tea", amountCents: 500, quantity: 1 }],
    });
    expect(calls.find((c) => c.path === "/invoiceitems")?.body.get("currency")).toBe("gbp");
  });

  it("totals the rounded lines when Stripe doesn't report the amount due", async () => {
    stripe();
    const result = await createLineItemInvoice("sk_test", {
      customerId: "cus_1",
      lineItems: [
        { description: "Beans", amountCents: 100.4, quantity: 3 },
        { description: "Mug", amountCents: 999.6, quantity: 1 },
      ],
    });
    expect(result.amountCents).toBe(100 * 3 + 1000);
  });

  it("encodes the invoice id in the finalize and send paths", async () => {
    const calls = stripe();
    await createLineItemInvoice("sk_test", {
      customerId: "cus_1",
      lineItems: [{ description: "Tea", amountCents: 500, quantity: 1 }],
    });
    expect(calls.map((c) => c.path)).toContain("/invoices/in_1%2Fx/finalize");
    expect(calls.map((c) => c.path)).toContain("/invoices/in_1%2Fx/send");
  });
});

describe("createAndSendInvoice", () => {
  it("encodes the invoice id too", async () => {
    const calls = stripe({ hosted_invoice_url: "https://invoice.example.com/1" });
    const result = await createAndSendInvoice("sk_test", {
      email: "alex@example.com",
      amountCents: 500,
      description: "Tea",
    });
    expect(calls.map((c) => c.path)).toContain("/invoices/in_1%2Fx/send");
    expect(result.hostedUrl).toBe("https://invoice.example.com/1");
  });
});
