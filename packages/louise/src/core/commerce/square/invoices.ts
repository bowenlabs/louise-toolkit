// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: invoices.

import type { SquareConfig } from "./client.js";
import { sqGet, sqPost } from "./request.js";

export interface SquareInvoicePaymentRequest {
  uid: string | null;
  requestType: string;
  dueDate: string | null;
  status: string | null;
  computedAmountCents: number;
  totalCompletedAmountCents: number;
}

export interface SquareInvoice {
  id: string;
  version: number;
  status: string;
  orderId: string | null;
  /** Square-hosted pay page—present after publishing with SHARE_MANUALLY. */
  publicUrl: string | null;
  paymentRequests: SquareInvoicePaymentRequest[];
}

interface RawInvoice {
  id?: string;
  version?: number;
  status?: string;
  order_id?: string;
  public_url?: string;
  payment_requests?: {
    uid?: string;
    request_type?: string;
    due_date?: string;
    status?: string;
    computed_amount_money?: { amount?: number; currency?: string };
    total_completed_amount_money?: { amount?: number; currency?: string };
  }[];
}

function mapInvoice(i: RawInvoice): SquareInvoice {
  return {
    id: i.id ?? "",
    version: i.version ?? 0,
    status: i.status ?? "",
    orderId: i.order_id ?? null,
    publicUrl: i.public_url ?? null,
    paymentRequests: (i.payment_requests ?? []).map((r) => ({
      uid: r.uid ?? null,
      requestType: r.request_type ?? "",
      dueDate: r.due_date ?? null,
      status: r.status ?? null,
      computedAmountCents: r.computed_amount_money?.amount ?? 0,
      totalCompletedAmountCents: r.total_completed_amount_money?.amount ?? 0,
    })),
  };
}

export interface InvoicePaymentRequestInput {
  /** Exactly one BALANCE (the last request), with an optional leading DEPOSIT
   *  and/or 2–12 INSTALLMENTs. */
  type: "DEPOSIT" | "BALANCE" | "INSTALLMENT";
  /** Due date, YYYY-MM-DD. */
  dueDate: string;
  /** Fixed amount for this request. Omit on BALANCE to auto-cover the remainder. */
  amountCents?: number;
  currency?: string;
}

/**
 * Create a DRAFT invoice for an existing OPEN Square Order (the order carries
 * the line items + total; the invoice adds the payment schedule + recipient).
 * POST /v2/invoices. Publish with {@link publishInvoice} to start collecting.
 * `deliveryMethod` "SHARE_MANUALLY" (default) yields a `publicUrl` after publish;
 * send your own email linking to it; "EMAIL" has Square email the customer.
 */
export async function createInvoice(
  config: SquareConfig,
  input: {
    locationId: string;
    orderId: string;
    customerId: string;
    paymentRequests: InvoicePaymentRequestInput[];
    deliveryMethod?: "SHARE_MANUALLY" | "EMAIL";
    title?: string;
    description?: string;
    idempotencyKey?: string;
  },
): Promise<SquareInvoice> {
  const res = await sqPost<{ invoice?: RawInvoice }>(config, "/v2/invoices", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    invoice: {
      location_id: input.locationId,
      order_id: input.orderId,
      primary_recipient: { customer_id: input.customerId },
      delivery_method: input.deliveryMethod ?? "SHARE_MANUALLY",
      title: input.title,
      description: input.description,
      accepted_payment_methods: { card: true },
      payment_requests: input.paymentRequests.map((r) => ({
        request_type: r.type,
        due_date: r.dueDate,
        tipping_enabled: false,
        ...(r.amountCents != null
          ? {
              fixed_amount_requested_money: {
                amount: r.amountCents,
                currency: r.currency ?? "USD",
              },
            }
          : {}),
      })),
    },
  });
  if (!res.invoice) throw new Error("Square invoice creation returned no invoice");
  return mapInvoice(res.invoice);
}

/** Publish a draft invoice (starts processing; yields the hosted `publicUrl` when
 *  created with SHARE_MANUALLY). POST /v2/invoices/{id}/publish. Pass the current
 *  `version` from {@link createInvoice} (optimistic concurrency). */
export async function publishInvoice(
  config: SquareConfig,
  invoiceId: string,
  version: number,
  idempotencyKey?: string,
): Promise<SquareInvoice> {
  const res = await sqPost<{ invoice?: RawInvoice }>(
    config,
    `/v2/invoices/${encodeURIComponent(invoiceId)}/publish`,
    { version, idempotency_key: idempotencyKey ?? crypto.randomUUID() },
  );
  if (!res.invoice) throw new Error(`Square invoice ${invoiceId} publish returned none`);
  return mapInvoice(res.invoice);
}

/** Retrieve one invoice—for example, to read each payment request's completed amount
 *  when reconciling a webhook. GET /v2/invoices/{id}. */
export async function retrieveInvoice(
  config: SquareConfig,
  invoiceId: string,
): Promise<SquareInvoice> {
  const res = await sqGet<{ invoice?: RawInvoice }>(
    config,
    `/v2/invoices/${encodeURIComponent(invoiceId)}`,
  );
  if (!res.invoice) throw new Error(`Square invoice ${invoiceId} not found`);
  return mapInvoice(res.invoice);
}
