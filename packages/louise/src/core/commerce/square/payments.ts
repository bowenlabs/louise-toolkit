// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: payments.

import type { SquareConfig } from "./client.js";
import type { SquareMoney } from "./money.js";
import { sqPost } from "./request.js";
import { money } from "./wire.js";

export interface SquarePayment {
  id: string;
  status: string;
  orderId: string | null;
  amountMoney: SquareMoney;
  /** The tip, when one was sent; zero otherwise. Not included in `amountMoney`. */
  tipMoney: SquareMoney;
  receiptUrl: string | null;
}

interface RawPayment {
  id?: string;
  status?: string;
  order_id?: string;
  receipt_url?: string;
  amount_money?: { amount?: number; currency?: string };
  tip_money?: { amount?: number; currency?: string };
}

/**
 * Charge a payment with a Web Payments SDK card token (`sourceId`). Attach the
 * order so the amount matches Square's computed total. POST /v2/payments.
 *
 * A tip goes in `tipMoney`, never folded into `amountMoney`: Square requires a
 * payment for an order to equal the order's total, and documents `amount_money`
 * as "not including tip_money". Tips live on the payment, not the order.
 */
export async function createPayment(
  config: SquareConfig,
  input: {
    sourceId: string;
    amountMoney: SquareMoney;
    /** Charged on top of `amountMoney`. Omitted from the body when zero. */
    tipMoney?: SquareMoney;
    locationId: string;
    orderId?: string;
    customerId?: string;
    /** Web Payments SCA verification token (verifyBuyer) when present. */
    verificationToken?: string;
    buyerEmailAddress?: string;
    referenceId?: string;
    idempotencyKey?: string;
  },
): Promise<SquarePayment> {
  const res = await sqPost<{ payment?: RawPayment }>(config, "/v2/payments", {
    source_id: input.sourceId,
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    amount_money: { amount: input.amountMoney.amount, currency: input.amountMoney.currency },
    ...(input.tipMoney && input.tipMoney.amount > 0
      ? { tip_money: { amount: input.tipMoney.amount, currency: input.tipMoney.currency } }
      : {}),
    location_id: input.locationId,
    order_id: input.orderId,
    customer_id: input.customerId,
    verification_token: input.verificationToken,
    buyer_email_address: input.buyerEmailAddress,
    reference_id: input.referenceId,
  });
  if (!res.payment) throw new Error("Square payment creation returned no payment");
  const p = res.payment;
  return {
    id: p.id ?? "",
    status: p.status ?? "",
    orderId: p.order_id ?? null,
    amountMoney: money(p.amount_money),
    tipMoney: money(p.tip_money),
    receiptUrl: p.receipt_url ?? null,
  };
}
