// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: orders: create, calculate, and read.

import type { SquareConfig } from "./client.js";
import type { SquareMoney } from "./money.js";
import { sqGet, sqPost } from "./request.js";
import { money, orderLineItemBody } from "./wire.js";

/**
 * An order line item—either a catalog variation reference (Square applies the
 * catalog price + taxes) OR an ad-hoc line (explicit name + price), for charges
 * with no catalog object behind them (for example, a manufacturing deposit).
 */
export type SquareOrderLineItem =
  | {
      catalogObjectId: string;
      quantity: number;
      /**
       * Selected modifiers (catalog object ids—the modifier, not its list).
       * Square prices these into the line from the catalog, so they are
       * server-authoritative: pass ids through, never a client-quoted amount.
       */
      modifierIds?: string[];
    }
  | { name: string; priceCents: number; quantity: number; currency?: string };

/**
 * An order-level charge Square adds on top of the line items—shipping is the
 * usual one. Applied in the `SUBTOTAL_PHASE` (before taxes, so it can itself be
 * taxed) or the `TOTAL_PHASE` (after). Defaults to subtotal, untaxed, which is
 * a flat shipping fee.
 */
export interface SquareServiceCharge {
  name: string;
  amountMoney: SquareMoney;
  calculationPhase?: "SUBTOTAL_PHASE" | "TOTAL_PHASE";
  taxable?: boolean;
}

/** Who receives a fulfillment. Square requires a display name. */
export interface SquareFulfillmentRecipient {
  displayName: string;
  phone?: string;
  email?: string;
}

/** A shipping address in the shape Square's `address` object wants. */
export interface SquareAddress {
  line1: string;
  line2?: string;
  /** City. */
  locality: string;
  /** State / province. */
  administrativeDistrictLevel1: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2, for example, "US". */
  country: string;
}

/**
 * How the order reaches the customer. Created in the `PROPOSED` state; the
 * seller advances it from POS or the Dashboard.
 *
 * A pickup is either `asap`—Square computes the ready time from the prep
 * duration, the order-ahead café case—or `scheduled` at a specific instant,
 * the "collect your beans Tuesday" case. Which of those a shop offers, and how
 * `pickupAt` is chosen, is policy that belongs to the caller.
 */
export type SquareFulfillment =
  | {
      type: "pickup";
      recipient: SquareFulfillmentRecipient;
      schedule:
        | {
            type: "asap";
            /** Minutes until the order is ready: the shop's prep time, a whole
             *  number ≥ 1. Required: how long a kitchen takes is the shop's fact,
             *  and a guessed default would promise customers the wrong time. */
            prepMinutes: number;
          }
        | { type: "scheduled"; pickupAt: string };
      /** Customer note to the kitchen. Square caps it at 500 characters. */
      note?: string;
    }
  | {
      type: "shipment";
      recipient: SquareFulfillmentRecipient & { address: SquareAddress };
      /** Delivery note to the packer. Square caps it at 500 characters. */
      note?: string;
    };

/**
 * Order-level pricing behaviour, sent as `order.pricing_options`.
 *
 * Square applies **nothing** by default to an API-created order. Dashboard tax
 * settings reach POS and Square Online on their own, but not `CreateOrder`—so
 * a storefront that omits this charges pre-tax, silently, and the merchant
 * finds out at reconciliation. There is no error to notice.
 *
 * Two documented foot-guns:
 *
 *   - It must be nested INSIDE `order`. At the request root Square ignores it
 *     without complaint—the call succeeds and the total is simply wrong.
 *     That is why this is a field on the input rather than something a caller
 *     assembles into the body themselves.
 *   - Never combine `auto_apply_taxes` with an explicit `order.taxes[]`;
 *     Square documents that as double-taxing. This client never sends
 *     `taxes[]`, so that combination is unreachable from here by construction.
 */
export interface SquarePricingOptions {
  /**
   * Apply the taxes configured on each catalog item (its `tax_ids`).
   *
   * Whether Square filters those `tax_ids` by the order's `location_id` is
   * strongly implied by Square staff but never stated in the docs. A seller
   * with different rates per location should confirm it against their own
   * catalog—two locations, two rates, one shared item—before trusting it.
   * If both rates apply, that case needs an explicit location→tax-object map
   * rather than this flag (#392).
   */
  autoApplyTaxes?: boolean;
  /** Apply the automatic (rule-based) discounts configured in the Dashboard. */
  autoApplyDiscounts?: boolean;
}

export interface SquareOrder {
  id: string;
  locationId: string;
  state: string;
  totalMoney: SquareMoney;
  totalTaxMoney: SquareMoney;
  /** Automatic + explicit discounts, as Square applied them. */
  totalDiscountMoney: SquareMoney;
  /** The sum of {@link SquareServiceCharge}s (for example, shipping). */
  totalServiceChargeMoney: SquareMoney;
  referenceId: string | null;
  customerId: string | null;
  createdAt: string | null;
  /** When money settled—the accounting axis, and null until an order closes. */
  closedAt: string | null;
  updatedAt: string | null;
  lineItems: {
    name: string;
    quantity: string;
    catalogObjectId: string | null;
    grossSalesMoney: SquareMoney;
  }[];
  /** What's still owed: `totalMoney` less what the order's tenders paid. */
  netAmountDueMoney: SquareMoney;
  /** The payments made against the order, one per tender. */
  tenders: SquareTender[];
}

/**
 * One payment made against an order. Square adds a tender when a payment for
 * the order completes, so an order that has a tender with a `paymentId` was
 * paid, even if the response to that payment call never arrived.
 */
export interface SquareTender {
  id: string;
  /** `CARD`, `CASH`, `SQUARE_GIFT_CARD`, and so on. */
  type: string;
  /** The payment's ID, for `retrievePayment`; null for a tender with no
   *  payment behind it, such as cash recorded by hand. */
  paymentId: string | null;
  amountMoney: SquareMoney;
  /** The tip on top of `amountMoney`, zero when there's none. */
  tipMoney: SquareMoney;
}

/**
 * An order's subtotal as Square computed it: the line items after discounts,
 * before taxes and service charges. `totalMoney` less `totalTaxMoney` and
 * `totalServiceChargeMoney`.
 *
 * Take a tip's cap on this, from {@link calculateOrder} on the client and from
 * the created order on the server, so both sides cap against the same number.
 * A subtotal summed from base variation prices misses discounts and
 * modifiers, and disagrees near the cap.
 */
export function orderSubtotal(order: SquareOrder): SquareMoney {
  return {
    amount:
      order.totalMoney.amount - order.totalTaxMoney.amount - order.totalServiceChargeMoney.amount,
    currency: order.totalMoney.currency,
  };
}

interface RawOrder {
  id?: string;
  location_id?: string;
  state?: string;
  reference_id?: string;
  customer_id?: string;
  created_at?: string;
  closed_at?: string;
  updated_at?: string;
  total_money?: { amount?: number; currency?: string };
  total_tax_money?: { amount?: number; currency?: string };
  total_discount_money?: { amount?: number; currency?: string };
  total_service_charge_money?: { amount?: number; currency?: string };
  line_items?: {
    name?: string;
    quantity?: string;
    catalog_object_id?: string;
    gross_sales_money?: { amount?: number; currency?: string };
  }[];
  net_amount_due_money?: { amount?: number; currency?: string };
  tenders?: {
    id?: string;
    type?: string;
    payment_id?: string;
    amount_money?: { amount?: number; currency?: string };
    tip_money?: { amount?: number; currency?: string };
  }[];
}

function mapOrder(o: RawOrder): SquareOrder {
  return {
    id: o.id ?? "",
    locationId: o.location_id ?? "",
    state: o.state ?? "",
    totalMoney: money(o.total_money),
    totalTaxMoney: money(o.total_tax_money),
    totalDiscountMoney: money(o.total_discount_money),
    totalServiceChargeMoney: money(o.total_service_charge_money),
    referenceId: o.reference_id ?? null,
    customerId: o.customer_id ?? null,
    createdAt: o.created_at ?? null,
    closedAt: o.closed_at ?? null,
    updatedAt: o.updated_at ?? null,
    lineItems: (o.line_items ?? []).map((li) => ({
      name: li.name ?? "",
      quantity: li.quantity ?? "0",
      catalogObjectId: li.catalog_object_id ?? null,
      grossSalesMoney: money(li.gross_sales_money),
    })),
    // Square leaves out a zero amount, often a tip. Its currency comes from
    // the amount beside it, so a missing one never reads as USD in another
    // currency's store.
    netAmountDueMoney: money(o.net_amount_due_money ?? { currency: o.total_money?.currency }),
    tenders: (o.tenders ?? []).map((t) => ({
      id: t.id ?? "",
      type: t.type ?? "",
      paymentId: t.payment_id ?? null,
      amountMoney: money(t.amount_money),
      tipMoney: money(t.tip_money ?? { currency: t.amount_money?.currency }),
    })),
  };
}

/** `pricing_options` in Square's wire shape. Shared by {@link createOrder} and
 *  {@link calculateOrder} so a previewed total cannot be computed under
 *  different rules from the one that is charged—the single thing a preview
 *  exists to guarantee. `undefined` when unset, so the key is omitted from the
 *  body rather than sent as null. */
function pricingOptionsBody(pricing: SquarePricingOptions | undefined) {
  if (!pricing) return undefined;
  return {
    auto_apply_taxes: pricing.autoApplyTaxes,
    auto_apply_discounts: pricing.autoApplyDiscounts,
  };
}

function serviceChargeBody(sc: SquareServiceCharge) {
  return {
    name: sc.name,
    amount_money: { amount: sc.amountMoney.amount, currency: sc.amountMoney.currency },
    calculation_phase: sc.calculationPhase ?? "SUBTOTAL_PHASE",
    taxable: sc.taxable ?? false,
  };
}

function recipientBody(r: SquareFulfillmentRecipient) {
  return {
    display_name: r.displayName,
    ...(r.phone ? { phone_number: r.phone } : {}),
    ...(r.email ? { email_address: r.email } : {}),
  };
}

/** An ASAP pickup's prep time as the ISO 8601 duration Square wants. Refuses a
 *  value it would otherwise have to round or clamp—that would change the ready
 *  time the customer is shown without anyone noticing. */
function prepDuration(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new RangeError(`prepMinutes must be a whole number ≥ 1, got ${minutes}`);
  }
  return `PT${minutes}M`;
}

function fulfillmentBody(f: SquareFulfillment) {
  // Square rejects a note over 500 chars with a 400 on the whole order, after
  // the customer has entered a card. Trimming here is the kinder failure.
  const note = f.note?.slice(0, 500);
  if (f.type === "shipment") {
    const a = f.recipient.address;
    return {
      type: "SHIPMENT",
      state: "PROPOSED",
      shipment_details: {
        recipient: {
          ...recipientBody(f.recipient),
          address: {
            address_line_1: a.line1,
            ...(a.line2 ? { address_line_2: a.line2 } : {}),
            locality: a.locality,
            administrative_district_level_1: a.administrativeDistrictLevel1,
            postal_code: a.postalCode,
            country: a.country,
          },
        },
        ...(note ? { shipping_note: note } : {}),
      },
    };
  }
  return {
    type: "PICKUP",
    state: "PROPOSED",
    pickup_details: {
      recipient: recipientBody(f.recipient),
      ...(f.schedule.type === "asap"
        ? { schedule_type: "ASAP", prep_time_duration: prepDuration(f.schedule.prepMinutes) }
        : { schedule_type: "SCHEDULED", pickup_at: f.schedule.pickupAt }),
      ...(note ? { note } : {}),
    },
  };
}

/**
 * The pricing-relevant half of an order—everything Square actually computes
 * a total from. Shared VERBATIM by {@link createOrder} and
 * {@link calculateOrder} so a quoted total cannot be computed under different
 * rules than the one charged. That is the single thing a preview exists to
 * guarantee, and why this is one function rather than two similar literals.
 *
 * Deliberately excludes `reference_id` and `fulfillments`: neither is a pricing
 * input, and a preview typically runs while the customer is still typing their
 * address—a half-filled SHIPMENT fulfillment would fail validation on a call
 * whose only job is to quote a number.
 */
function orderPricingBody(input: {
  locationId: string;
  lineItems: SquareOrderLineItem[];
  customerId?: string;
  serviceCharges?: SquareServiceCharge[];
  pricingOptions?: SquarePricingOptions;
}) {
  return {
    location_id: input.locationId,
    customer_id: input.customerId,
    line_items: input.lineItems.map(orderLineItemBody),
    ...(input.serviceCharges?.length
      ? { service_charges: input.serviceCharges.map(serviceChargeBody) }
      : {}),
    // Nested inside `order`, never at the request root, where Square would
    // ignore it silently.
    pricing_options: pricingOptionsBody(input.pricingOptions),
  };
}

export async function createOrder(
  config: SquareConfig,
  input: {
    locationId: string;
    lineItems: SquareOrderLineItem[];
    customerId?: string;
    referenceId?: string;
    idempotencyKey?: string;
    /** Taxes and discounts are opt-in—see {@link SquarePricingOptions}.
     *  Omitting this charges exactly the line-item prices, pre-tax. */
    pricingOptions?: SquarePricingOptions;
    /** Order-level charges (shipping). Pass the same list to
     *  {@link calculateOrder} or the preview total will be short by exactly
     *  this much. */
    serviceCharges?: SquareServiceCharge[];
    /** How the order reaches the customer. Not a pricing input, so
     *  {@link calculateOrder} does not take it. */
    fulfillments?: SquareFulfillment[];
    /** `"DRAFT"` makes an order template: a subscription phase names it (see
     *  `createSubscription`), and each billing cycle copies it, line items and
     *  fulfillment included, into the order Square bills. A draft can't be paid
     *  or fulfilled itself. Omit it for an order to charge now. */
    state?: "DRAFT";
  },
): Promise<SquareOrder> {
  const res = await sqPost<{ order?: RawOrder }>(config, "/v2/orders", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    order: {
      ...orderPricingBody(input),
      reference_id: input.referenceId,
      ...(input.state ? { state: input.state } : {}),
      ...(input.fulfillments?.length
        ? { fulfillments: input.fulfillments.map(fulfillmentBody) }
        : {}),
    },
  });
  if (!res.order) throw new Error("Square order creation returned no order");
  return mapOrder(res.order);
}

/**
 * Retrieve one order. GET /v2/orders/{id}.
 *
 * To see whether an order was paid, read it here rather than from a
 * {@link createOrder} replayed under its idempotency key, which can answer
 * with the order as it was first created, before any tender.
 */
export async function retrieveOrder(config: SquareConfig, orderId: string): Promise<SquareOrder> {
  const res = await sqGet<{ order?: RawOrder }>(
    config,
    `/v2/orders/${encodeURIComponent(orderId)}`,
  );
  if (!res.order) throw new Error(`Square order ${orderId} not found`);
  return mapOrder(res.order);
}

/**
 * Square's hard ceiling on `location_ids` in one `/v2/orders/search` call.
 * Documented, not discovered: an eleventh id is a 400, not a truncation.
 */
const SEARCH_ORDERS_LOCATION_LIMIT = 10;

function chunkLocationIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += SEARCH_ORDERS_LOCATION_LIMIT) {
    chunks.push(ids.slice(i, i + SEARCH_ORDERS_LOCATION_LIMIT));
  }
  return chunks;
}

/** Re-establish a global order over results Square only sorted per response. */
function sortOrdersBy(
  orders: SquareOrder[],
  dateField: "closedAt" | "createdAt" | "updatedAt",
  sortOrder: "ASC" | "DESC",
): SquareOrder[] {
  const direction = sortOrder === "ASC" ? 1 : -1;
  return [...orders].sort((a, b) => {
    const x = a[dateField];
    const y = b[dateField];
    // Nulls last in both directions—an order with no timestamp on the axis
    // you asked about (an OPEN order has no `closed_at`) is not the newest
    // thing that happened, which is where it would land unguarded.
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? -direction : direction;
  });
}

/**
 * Search orders for a customer (account order history). Returns full orders,
 * newest first. POST /v2/orders/search.
 */
export async function searchOrdersByCustomer(
  config: SquareConfig,
  input: { locationIds: string[]; customerId: string; limit?: number },
): Promise<SquareOrder[]> {
  const limit = input.limit ?? 50;
  const orders: SquareOrder[] = [];
  // Same endpoint, same 10-location ceiling. It bites later here than in
  // `searchOrders`—an account history is usually asked for one location at a
  // time—but a multi-location portal asking "everywhere she's shopped" is
  // exactly the request that trips it.
  for (const locationIds of chunkLocationIds(input.locationIds)) {
    const res = await sqPost<{ orders?: RawOrder[] }>(config, "/v2/orders/search", {
      location_ids: locationIds,
      return_entries: false,
      limit,
      query: {
        filter: { customer_filter: { customer_ids: [input.customerId] } },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
      },
    });
    orders.push(...(res.orders ?? []).map(mapOrder));
  }
  // `limit` is per request, so N chunks can return N×limit. Re-sort and trim so
  // the caller gets the newest `limit` orders overall, which is what they asked
  // for—not the newest `limit` from each arbitrary group of ten.
  if (input.locationIds.length <= SEARCH_ORDERS_LOCATION_LIMIT) return orders;
  return sortOrdersBy(orders, "createdAt", "DESC").slice(0, limit);
}

/**
 * Search orders across locations and a date range, following the cursor.
 * POST /v2/orders/search. The reporting rail: best-sellers, per-merchant sales
 * totals, reorder suggestions.
 *
 * Defaults to `COMPLETED` only. That matters for money questions—leaving the
 * state filter open counts `OPEN` (unpaid) and `CANCELED` orders as revenue,
 * which quietly inflates every downstream report.
 *
 * `closedAt` is the right axis for accounting (when money settled); `createdAt`
 * for funnel questions (when the order was raised). They differ for anything not
 * paid immediately, so the caller picks rather than inheriting a guess.
 */
export async function searchOrders(
  config: SquareConfig,
  input: {
    locationIds: string[];
    /** RFC 3339, inclusive. */
    startAt?: string;
    /** RFC 3339, exclusive. */
    endAt?: string;
    /** Defaults to ["COMPLETED"]. Pass [] to disable state filtering entirely. */
    states?: string[];
    /** Which timestamp the range and sort apply to. Defaults to "closedAt". */
    dateField?: "closedAt" | "createdAt" | "updatedAt";
    sortOrder?: "ASC" | "DESC";
    /** Page size (Square caps at 1000). Defaults to 500. */
    limit?: number;
    /** Safety bound on cursor pages, applied PER location chunk. Defaults to 20. */
    maxPages?: number;
  },
): Promise<SquareOrder[]> {
  // An empty list would be a caller bug that Square answers with a 400 and a
  // message about `location_ids`, several layers from where it was introduced.
  // Refusing here names it. (Not returning []—a reporting call that silently
  // yields no rows reads as "no sales", which is worse than an error.)
  if (input.locationIds.length === 0) {
    throw new Error("Square searchOrders needs at least one location id");
  }
  const states = input.states ?? ["COMPLETED"];
  const sortField = (
    { closedAt: "CLOSED_AT", createdAt: "CREATED_AT", updatedAt: "UPDATED_AT" } as const
  )[input.dateField ?? "closedAt"];
  const range =
    input.startAt || input.endAt
      ? {
          [sortField === "CLOSED_AT"
            ? "closed_at"
            : sortField === "CREATED_AT"
              ? "created_at"
              : "updated_at"]: {
            ...(input.startAt ? { start_at: input.startAt } : {}),
            ...(input.endAt ? { end_at: input.endAt } : {}),
          },
        }
      : undefined;

  const orders: SquareOrder[] = [];
  // Sequentially, not in parallel: a 300-location account is 30 searches, and
  // firing them at once is the surest way to meet the 429 this client only
  // retries when asked to.
  for (const locationIds of chunkLocationIds(input.locationIds)) {
    let cursor: string | undefined;
    for (let page = 0; page < (input.maxPages ?? 20); page++) {
      const res = await sqPost<{ orders?: RawOrder[]; cursor?: string }>(
        config,
        "/v2/orders/search",
        {
          location_ids: locationIds,
          return_entries: false,
          limit: input.limit ?? 500,
          ...(cursor ? { cursor } : {}),
          query: {
            filter: {
              ...(states.length ? { state_filter: { states } } : {}),
              ...(range ? { date_time_filter: range } : {}),
            },
            // Square requires the sort field to match the date filter's field.
            sort: { sort_field: sortField, sort_order: input.sortOrder ?? "DESC" },
          },
        },
      );
      orders.push(...(res.orders ?? []).map(mapOrder));
      cursor = res.cursor;
      if (!cursor) break;
    }
  }
  // Square sorts within a response, not across our chunks. Above 10 locations
  // the concatenation is ordered per chunk and unordered overall, which looks
  // fine in a spot check and puts the wrong rows in any "top N" or "most
  // recent" that trusts the order.
  return input.locationIds.length > SEARCH_ORDERS_LOCATION_LIMIT
    ? sortOrdersBy(orders, input.dateField ?? "closedAt", input.sortOrder ?? "DESC")
    : orders;
}

/**
 * Preview an order's totals without creating one. POST /v2/orders/calculate.
 *
 * The order is never persisted, so this is the honest way to show a cart total
 * that matches what checkout will charge: the same pricing engine, no order to
 * clean up if the customer walks away.
 *
 * Pass the SAME `pricingOptions` you will pass to {@link createOrder}. Taxes
 * are not applied by default here either, so a preview that omits them while
 * the charge applies them is the exact mismatch this call exists to prevent.
 */
export async function calculateOrder(
  config: SquareConfig,
  input: {
    locationId: string;
    lineItems: SquareOrderLineItem[];
    customerId?: string;
    /** Must match what {@link createOrder} will be given, or the previewed
     *  total is not the total that gets charged. */
    pricingOptions?: SquarePricingOptions;
    /** Likewise—the same list {@link createOrder} will be given. */
    serviceCharges?: SquareServiceCharge[];
  },
): Promise<SquareOrder> {
  const res = await sqPost<{ order?: RawOrder }>(config, "/v2/orders/calculate", {
    order: orderPricingBody(input),
  });
  if (!res.order) throw new Error("Square order calculation returned no order");
  return mapOrder(res.order);
}
