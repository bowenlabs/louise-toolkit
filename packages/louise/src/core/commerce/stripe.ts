// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louise/commerce/stripe — Stripe glue. Raw fetch + crypto.subtle only, no Node
// SDKs: an embedded Payment Element over a multi-item cart (PaymentIntent)
// rather than single-item hosted Checkout Sessions, plus invoice + webhook-
// signature helpers. For merch fulfillment, pair it with
// louisecms/commerce/fourthwall.

// Stripe: PaymentIntents/Invoices are not yet in Stripe's /v2 namespace
// (v2 covers core accounts, event destinations, billing meters, money
// management as of 2026-07) — payments must use v1 endpoints. The webhook
// compensates v2-style: events are treated as pointers and the
// PaymentIntent is re-fetched from the API (see retrievePaymentIntent).

import { hmacSha256Hex, safeEqual } from "./index.js";

const STRIPE_API = "https://api.stripe.com/v1";
// Pin the Stripe API version so an account-default upgrade can't silently
// change response shapes / behavior (Stripe best practice for raw HTTP —
// mirrors what the official SDKs pin at release). Bump deliberately.
const STRIPE_VERSION = "2026-06-24.dahlia";

function stripeHeaders(secretKey: string): HeadersInit {
  return {
    authorization: `Bearer ${secretKey}`,
    "content-type": "application/x-www-form-urlencoded",
    "stripe-version": STRIPE_VERSION,
  };
}

async function stripePost<T>(secretKey: string, path: string, form: URLSearchParams): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: stripeHeaders(secretKey),
    body: form,
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`Stripe ${path} ${res.status}: ${data?.error?.message ?? "error"}`);
  }
  return data;
}

export interface CartItem {
  slug: string;
  name: string;
  qty: number;
  /** Unit price in cents. */
  unitAmountCents: number;
}

/**
 * Create a PaymentIntent for an embedded Payment Element checkout. The cart
 * is carried in metadata so the webhook can build the order without trusting
 * the client.
 */
export async function createPaymentIntent(
  secretKey: string,
  items: CartItem[],
): Promise<{ id: string; clientSecret: string; amountCents: number }> {
  const amountCents = items.reduce((n, i) => n + i.unitAmountCents * i.qty, 0);
  const form = new URLSearchParams();
  form.set("amount", String(amountCents));
  form.set("currency", "usd");
  form.set("automatic_payment_methods[enabled]", "true");
  form.set(
    "metadata[items]",
    JSON.stringify(
      // Slug+qty only (Stripe caps metadata values at 500 chars) — the
      // webhook re-reads product truth from D1, so nothing here stales.
      items.map((i) => ({ s: i.slug, q: i.qty })),
    ),
  );
  const pi = await stripePost<{ id: string; client_secret: string }>(
    secretKey,
    "/payment_intents",
    form,
  );
  return { id: pi.id, clientSecret: pi.client_secret, amountCents };
}

/**
 * Re-fetch a PaymentIntent by id — the webhook treats events as pointers
 * (v2-style thin-event handling) instead of trusting the delivered payload.
 */
export async function retrievePaymentIntent<T = Record<string, unknown>>(
  secretKey: string,
  id: string,
): Promise<T> {
  const res = await fetch(`${STRIPE_API}/payment_intents/${id}`, {
    headers: { authorization: `Bearer ${secretKey}`, "stripe-version": STRIPE_VERSION },
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(
      `Stripe /payment_intents/${id} ${res.status}: ${data?.error?.message ?? "error"}`,
    );
  }
  return data;
}

/**
 * Verify a Stripe webhook signature. `header` is the raw `Stripe-Signature`
 * value (`t=…,v1=…`); `payload` is the raw request body. Rejects signatures
 * older than `toleranceSeconds` (default 5 min).
 */
export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, ...v] = kv.split("=");
      return [k.trim(), v.join("=")];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${payload}`);
  return safeEqual(expected, v1);
}

export interface StripeAddress {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** Create + finalize + send a Stripe invoice; returns the hosted pay URL. */
export async function createAndSendInvoice(
  secretKey: string,
  input: { email: string; amountCents: number; description: string },
): Promise<{ id: string; hostedUrl: string | null }> {
  const customer = await stripePost<{ id: string }>(
    secretKey,
    "/customers",
    new URLSearchParams({ email: input.email }),
  );
  await stripePost(
    secretKey,
    "/invoiceitems",
    new URLSearchParams({
      customer: customer.id,
      amount: String(input.amountCents),
      currency: "usd",
      description: input.description,
    }),
  );
  const invoice = await stripePost<{ id: string }>(
    secretKey,
    "/invoices",
    new URLSearchParams({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: "30",
    }),
  );
  await stripePost(secretKey, `/invoices/${invoice.id}/finalize`, new URLSearchParams());
  const sent = await stripePost<{ id: string; hosted_invoice_url?: string }>(
    secretKey,
    `/invoices/${invoice.id}/send`,
    new URLSearchParams(),
  );
  return { id: sent.id, hostedUrl: sent.hosted_invoice_url ?? null };
}

export interface InvoiceLineItem {
  description: string;
  /** Unit price in cents. */
  amountCents: number;
  quantity: number;
}

/**
 * Create or reuse a Stripe customer. Pass `customerId` to reuse; otherwise a
 * customer is created with the email/name/address (address is what makes
 * automatic tax work). Returns the id and whether it was newly created.
 */
export async function ensureStripeCustomer(
  secretKey: string,
  input: { email: string; name?: string; address?: StripeAddress; customerId?: string },
): Promise<{ id: string; created: boolean }> {
  if (input.customerId) return { id: input.customerId, created: false };
  const form = new URLSearchParams({ email: input.email });
  if (input.name) form.set("name", input.name);
  const a = input.address;
  if (a) {
    if (a.line1) form.set("address[line1]", a.line1);
    if (a.line2) form.set("address[line2]", a.line2);
    if (a.city) form.set("address[city]", a.city);
    if (a.state) form.set("address[state]", a.state);
    if (a.postalCode) form.set("address[postal_code]", a.postalCode);
    if (a.country) form.set("address[country]", a.country);
  }
  const customer = await stripePost<{ id: string }>(secretKey, "/customers", form);
  return { id: customer.id, created: true };
}

/**
 * Create + finalize + send a Stripe invoice with line items and (optionally)
 * automatic tax. Auto tax requires Stripe Tax enabled on the account and a
 * customer address. Returns the id, hosted pay URL, number, and total.
 */
export async function createLineItemInvoice(
  secretKey: string,
  input: {
    customerId: string;
    lineItems: InvoiceLineItem[];
    automaticTax?: boolean;
    daysUntilDue?: number;
    currency?: string;
  },
): Promise<{ id: string; hostedUrl: string | null; number: string | null; amountCents: number }> {
  const currency = input.currency ?? "usd";
  for (const li of input.lineItems) {
    await stripePost(
      secretKey,
      "/invoiceitems",
      new URLSearchParams({
        customer: input.customerId,
        currency,
        unit_amount: String(Math.round(li.amountCents)),
        quantity: String(li.quantity || 1),
        description: li.description,
      }),
    );
  }
  const invForm = new URLSearchParams({
    customer: input.customerId,
    collection_method: "send_invoice",
    days_until_due: String(input.daysUntilDue ?? 30),
    auto_advance: "true",
  });
  if (input.automaticTax) invForm.set("automatic_tax[enabled]", "true");
  const invoice = await stripePost<{ id: string }>(secretKey, "/invoices", invForm);
  await stripePost(secretKey, `/invoices/${invoice.id}/finalize`, new URLSearchParams());
  const sent = await stripePost<{
    id: string;
    hosted_invoice_url?: string;
    number?: string;
    amount_due?: number;
  }>(secretKey, `/invoices/${invoice.id}/send`, new URLSearchParams());
  return {
    id: sent.id,
    hostedUrl: sent.hosted_invoice_url ?? null,
    number: sent.number ?? null,
    amountCents:
      sent.amount_due ??
      input.lineItems.reduce((n, li) => n + li.amountCents * (li.quantity || 1), 0),
  };
}
