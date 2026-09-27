// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: payment links, Square's hosted checkout.
//
// A Square-hosted checkout page, created server-side and handed to the buyer as
// a URL. The alternative rail—the Web Payments SDK card field in
// `commerce/square-web`—keeps the buyer on your page but mounts a CARD FIELD
// ONLY. A hosted link gets Apple Pay / Google Pay / Cash App Pay from a config
// flag, which is what a shopper standing in a shop with a phone actually wants.
//
// Prefer the `order` form over `quickPay`: it is the only one that carries a
// `referenceId` onto the resulting Order, and the reference is how a sale is
// attributed later (it survives into the merchant's own Square dashboard and
// the Transactions export). Its line items may be ad-hoc—`SquareOrderLineItem`
// already models the no-catalog-object variant—so a site can sell from its own
// catalog without mirroring anything into Square first.

import { reportDegraded } from "../../degraded.js";
import { UpstreamError } from "../../security/upstream.js";
import type { SquareConfig } from "./client.js";
import type { SquareMoney } from "./money.js";
import type { SquareOrderLineItem } from "./orders.js";
import { sqDelete, sqGet, sqPost } from "./request.js";
import { orderLineItemBody } from "./wire.js";

export interface SquarePaymentLink {
  id: string;
  /** Optimistic-concurrency version; required to update the link. */
  version: number;
  /** The short `square.link` URL—the one to put in front of a buyer. */
  url: string;
  /** The long `checkout.square.site` form. Absent on some responses. */
  longUrl: string | null;
  /** The Order the link created. The attribution anchor for the webhook. */
  orderId: string | null;
  createdAt: string | null;
}

interface RawPaymentLink {
  id?: string;
  version?: number;
  url?: string;
  long_url?: string;
  order_id?: string;
  created_at?: string;
}

function mapPaymentLink(l: RawPaymentLink): SquarePaymentLink {
  return {
    id: l.id ?? "",
    version: l.version ?? 0,
    url: l.url ?? "",
    longUrl: l.long_url ?? null,
    orderId: l.order_id ?? null,
    createdAt: l.created_at ?? null,
  };
}

/** Wallets offered on the hosted page. Omit a flag to take Square's default. */
export interface SquareAcceptedPaymentMethods {
  applePay?: boolean;
  googlePay?: boolean;
  cashAppPay?: boolean;
  afterpayClearpay?: boolean;
}

/** Optional presentation/behavior of the hosted checkout page. */
export interface SquareCheckoutOptions {
  /** Absolute https URL Square returns the buyer to after payment. Carry your
   *  own order/session id in its query string—this is the only hook you get
   *  for a branded confirmation page. */
  redirectUrl?: string;
  /** Square collects and validates the shipping address on its own page. */
  askForShippingAddress?: boolean;
  merchantSupportEmail?: string;
  acceptedPaymentMethods?: SquareAcceptedPaymentMethods;
  allowTipping?: boolean;
  shippingFee?: { name?: string; charge: SquareMoney };
  enableCoupon?: boolean;
  enableLoyalty?: boolean;
}

/** A one-off "name + price" link with no Order behind it. Cannot carry a
 *  `referenceId`, so prefer {@link PaymentLinkOrderInput} when the sale has to
 *  be attributed to anything. */
export interface QuickPayInput {
  name: string;
  priceMoney: SquareMoney;
  locationId: string;
}

/** An Order-backed link. Line items may be ad-hoc (no catalog object). */
export interface PaymentLinkOrderInput {
  locationId: string;
  lineItems: SquareOrderLineItem[];
  customerId?: string;
  /** Up to 40 chars. Surfaced in the Square dashboard + Transactions export,
   *  which is what makes it usable for attribution without this system. */
  referenceId?: string;
}

/**
 * Create a Square-hosted checkout page.
 * POST /v2/online-checkout/payment-links.
 *
 * Exactly one of `quickPay` or `order`—passing both is rejected here rather
 * than by Square, so the mistake surfaces at the call site.
 *
 * `idempotencyKey` defaults to a random UUID, which is right for an interactive
 * checkout (each attempt is a new link). Pass a deterministic key only when a
 * retry must resolve to the SAME link.
 */
export async function createPaymentLink(
  config: SquareConfig,
  input: {
    quickPay?: QuickPayInput;
    order?: PaymentLinkOrderInput;
    description?: string;
    paymentNote?: string;
    checkoutOptions?: SquareCheckoutOptions;
    prePopulatedData?: { buyerEmail?: string; buyerPhoneNumber?: string };
    idempotencyKey?: string;
  },
): Promise<SquarePaymentLink> {
  if (!input.quickPay === !input.order) {
    throw new Error("Square payment link needs exactly one of `quickPay` or `order`");
  }

  const co = input.checkoutOptions;
  const apm = co?.acceptedPaymentMethods;

  const res = await sqPost<{ payment_link?: RawPaymentLink }>(
    config,
    "/v2/online-checkout/payment-links",
    {
      idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      description: input.description,
      payment_note: input.paymentNote,
      quick_pay: input.quickPay && {
        name: input.quickPay.name,
        price_money: input.quickPay.priceMoney,
        location_id: input.quickPay.locationId,
      },
      order: input.order && {
        location_id: input.order.locationId,
        customer_id: input.order.customerId,
        reference_id: input.order.referenceId,
        line_items: input.order.lineItems.map(orderLineItemBody),
      },
      checkout_options: co && {
        redirect_url: co.redirectUrl,
        ask_for_shipping_address: co.askForShippingAddress,
        merchant_support_email: co.merchantSupportEmail,
        allow_tipping: co.allowTipping,
        enable_coupon: co.enableCoupon,
        enable_loyalty: co.enableLoyalty,
        shipping_fee: co.shippingFee && {
          name: co.shippingFee.name,
          charge: co.shippingFee.charge,
        },
        accepted_payment_methods: apm && {
          apple_pay: apm.applePay,
          google_pay: apm.googlePay,
          cash_app_pay: apm.cashAppPay,
          afterpay_clearpay: apm.afterpayClearpay,
        },
      },
      pre_populated_data: input.prePopulatedData && {
        buyer_email: input.prePopulatedData.buyerEmail,
        buyer_phone_number: input.prePopulatedData.buyerPhoneNumber,
      },
    },
  );
  if (!res.payment_link) throw new Error("Square payment link creation returned none");
  return mapPaymentLink(res.payment_link);
}

/** Retrieve one payment link. GET /v2/online-checkout/payment-links/{id}.
 *  Returns null when it no longer exists (already deleted, or a bad id). */
export async function retrievePaymentLink(
  config: SquareConfig,
  linkId: string,
): Promise<SquarePaymentLink | null> {
  try {
    const res = await sqGet<{ payment_link?: RawPaymentLink }>(
      config,
      `/v2/online-checkout/payment-links/${encodeURIComponent(linkId)}`,
    );
    return res.payment_link ? mapPaymentLink(res.payment_link) : null;
  } catch (err) {
    // A 404 is the "no longer exists" this documents. Anything else, a rejected
    // token or an outage, reads the same to the caller, so it's reported.
    if (!(err instanceof UpstreamError && err.status === 404)) {
      reportDegraded("commerce.square.paymentLink", err, { linkId });
    }
    return null;
  }
}

/** Delete a payment link, cancelling its unpaid order.
 *  DELETE /v2/online-checkout/payment-links/{id}. */
export async function deletePaymentLink(
  config: SquareConfig,
  linkId: string,
): Promise<{ id: string; cancelledOrderId: string | null }> {
  const res = await sqDelete<{ id?: string; cancelled_order_id?: string }>(
    config,
    `/v2/online-checkout/payment-links/${encodeURIComponent(linkId)}`,
  );
  return { id: res.id ?? linkId, cancelledOrderId: res.cancelled_order_id ?? null };
}
