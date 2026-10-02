// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: subscriptions, a customer's standing
// agreement to be billed for a plan variation (see subscription-plans.ts).
// Square bills the card on file each cadence; a change to the agreement is an
// action that takes effect on a date, so a cancel or a pause asked for today
// shows up under `actions` until it does.

import type { SquareConfig } from "./client.js";
import type { SquareMoney } from "./money.js";
import { orNotFound, sqGet, sqPost, sqPut } from "./request.js";

export interface SquareSubscription {
  id: string;
  /** `PENDING`, `ACTIVE`, `PAUSED`, `CANCELED`, `DEACTIVATED`, or `COMPLETED`.
   *  A cancel leaves it `ACTIVE` until `canceledDate`. */
  status: string;
  planVariationId: string | null;
  customerId: string | null;
  cardId: string | null;
  locationId: string | null;
  /** `YYYY-MM-DD`: when billing started, or starts. */
  startDate: string | null;
  /** `YYYY-MM-DD`: when billing stops, once a cancel is scheduled. */
  canceledDate: string | null;
  /** `YYYY-MM-DD`: paid through here; the next bill comes the day after. */
  chargedThroughDate: string | null;
  /** The invoices Square raised, newest first. */
  invoiceIds: string[];
  /** Each phase's order template, when the subscription bills by template. */
  phases: SquareSubscriptionPhaseRef[];
  /** Scheduled changes that haven't taken effect yet. */
  actions: SquareSubscriptionAction[];
  /** For `updateSubscription`'s optimistic concurrency. */
  version: number | null;
  createdAt: string | null;
}

export interface SquareSubscriptionPhaseRef {
  uid: string | null;
  ordinal: number;
  orderTemplateId: string | null;
  planPhaseUid: string | null;
}

/** A pending `CANCEL`, `PAUSE`, `RESUME`, or `SWAP_PLAN`. */
export interface SquareSubscriptionAction {
  id: string;
  type: string;
  effectiveDate: string | null;
  newPlanVariationId: string | null;
}

interface RawAction {
  id?: string;
  type?: string;
  effective_date?: string;
  new_plan_variation_id?: string;
}

interface RawSubscription {
  id?: string;
  status?: string;
  plan_variation_id?: string;
  customer_id?: string;
  card_id?: string;
  location_id?: string;
  start_date?: string;
  canceled_date?: string;
  charged_through_date?: string;
  invoice_ids?: string[];
  phases?: {
    uid?: string;
    ordinal?: number;
    order_template_id?: string;
    plan_phase_uid?: string;
  }[];
  actions?: RawAction[];
  version?: number;
  created_at?: string;
}

/** A subscription plus the actions a lifecycle call scheduled. */
export interface SquareSubscriptionChange {
  subscription: SquareSubscription;
  actions: SquareSubscriptionAction[];
}

interface RawChange {
  subscription?: RawSubscription;
  actions?: RawAction[];
}

function mapAction(a: RawAction): SquareSubscriptionAction {
  return {
    id: a.id ?? "",
    type: a.type ?? "",
    effectiveDate: a.effective_date ?? null,
    newPlanVariationId: a.new_plan_variation_id ?? null,
  };
}

function mapSubscription(sub: RawSubscription): SquareSubscription {
  return {
    id: sub.id ?? "",
    status: sub.status ?? "",
    planVariationId: sub.plan_variation_id ?? null,
    customerId: sub.customer_id ?? null,
    cardId: sub.card_id ?? null,
    locationId: sub.location_id ?? null,
    startDate: sub.start_date ?? null,
    canceledDate: sub.canceled_date ?? null,
    chargedThroughDate: sub.charged_through_date ?? null,
    invoiceIds: sub.invoice_ids ?? [],
    phases: (sub.phases ?? []).map((p, i) => ({
      uid: p.uid ?? null,
      ordinal: p.ordinal ?? i,
      orderTemplateId: p.order_template_id ?? null,
      planPhaseUid: p.plan_phase_uid ?? null,
    })),
    actions: (sub.actions ?? []).map(mapAction),
    version: sub.version ?? null,
    createdAt: sub.created_at ?? null,
  };
}

function mapChange(res: RawChange, what: string): SquareSubscriptionChange {
  if (!res.subscription) throw new Error(`Square subscription ${what} returned no subscription`);
  return {
    subscription: mapSubscription(res.subscription),
    actions: (res.actions ?? []).map(mapAction),
  };
}

/** Active/past subscriptions for a customer. POST /v2/subscriptions/search. */
export async function searchSubscriptionsByCustomer(
  config: SquareConfig,
  input: { customerId: string; locationIds?: string[] },
): Promise<SquareSubscription[]> {
  const res = await sqPost<{ subscriptions?: RawSubscription[] }>(
    config,
    "/v2/subscriptions/search",
    {
      query: {
        filter: {
          customer_ids: [input.customerId],
          ...(input.locationIds ? { location_ids: input.locationIds } : {}),
        },
      },
    },
  );
  return (res.subscriptions ?? []).map(mapSubscription);
}

/** One subscription with its pending actions, or `null` when there's none by
 *  that id. GET /v2/subscriptions/{id}. */
export async function retrieveSubscription(
  config: SquareConfig,
  subscriptionId: string,
): Promise<SquareSubscription | null> {
  return orNotFound(async () => {
    const res = await sqGet<{ subscription?: RawSubscription }>(
      config,
      `/v2/subscriptions/${encodeURIComponent(subscriptionId)}?include=actions`,
    );
    if (!res.subscription) throw new Error(`Square subscription ${subscriptionId} not found`);
    return mapSubscription(res.subscription);
  });
}

/**
 * Enroll a customer in a subscription plan variation, billed to a saved card.
 * POST /v2/subscriptions.
 *
 * A variation whose phase prices `RELATIVE` bills an order template instead of
 * a fixed amount: pass one `phases` entry per plan phase, naming a `DRAFT`
 * order from `createOrder` as its template. Each cycle copies that order,
 * fulfillment included, so a shipment's address goes on the template.
 */
export async function createSubscription(
  config: SquareConfig,
  input: {
    locationId: string;
    planVariationId: string;
    customerId: string;
    cardId: string;
    idempotencyKey?: string;
    /** `YYYY-MM-DD`; defaults to today. */
    startDate?: string;
    /** The order template for each plan phase, by the phase's ordinal. */
    phases?: { ordinal: number; orderTemplateId: string }[];
    /** Replaces a `STATIC` phase price for this one customer. */
    priceOverride?: SquareMoney;
    /** Tax rate as a decimal string without `%`, for example "8.5". */
    taxPercentage?: string;
    /** IANA zone the billing dates are read in; defaults to the location's. */
    timezone?: string;
  },
): Promise<SquareSubscription> {
  const res = await sqPost<{ subscription?: RawSubscription }>(config, "/v2/subscriptions", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    location_id: input.locationId,
    plan_variation_id: input.planVariationId,
    customer_id: input.customerId,
    card_id: input.cardId,
    ...(input.startDate ? { start_date: input.startDate } : {}),
    ...(input.phases?.length
      ? {
          phases: input.phases.map((p) => ({
            ordinal: p.ordinal,
            order_template_id: p.orderTemplateId,
          })),
        }
      : {}),
    ...(input.priceOverride ? { price_override_money: input.priceOverride } : {}),
    ...(input.taxPercentage ? { tax_percentage: input.taxPercentage } : {}),
    ...(input.timezone ? { timezone: input.timezone } : {}),
  });
  if (!res.subscription) throw new Error("Square subscription creation returned no subscription");
  return mapSubscription(res.subscription);
}

/**
 * Change a subscription. PUT /v2/subscriptions/{id}. Sparse: only the fields
 * you pass are sent. `canceledDate: null` undoes a scheduled cancel; a date
 * can't be set here, `cancelSubscription` does that. Pass the `version` you
 * read so a change made since makes Square refuse, rather than overwrite.
 */
export async function updateSubscription(
  config: SquareConfig,
  subscriptionId: string,
  input: {
    cardId?: string;
    canceledDate?: null;
    priceOverride?: SquareMoney | null;
    taxPercentage?: string | null;
    version?: number;
  },
): Promise<SquareSubscription> {
  const subscription: Record<string, unknown> = {};
  if (input.cardId !== undefined) subscription.card_id = input.cardId;
  if (input.canceledDate !== undefined) subscription.canceled_date = input.canceledDate;
  if (input.priceOverride !== undefined) subscription.price_override_money = input.priceOverride;
  if (input.taxPercentage !== undefined) subscription.tax_percentage = input.taxPercentage;
  if (input.version !== undefined) subscription.version = input.version;
  const res = await sqPut<{ subscription?: RawSubscription }>(
    config,
    `/v2/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { subscription },
  );
  if (!res.subscription) throw new Error("Square subscription update returned no subscription");
  return mapSubscription(res.subscription);
}

/**
 * Schedule a cancel for the end of the current billing period: `canceledDate`
 * is set, the status stays `ACTIVE` until then, and the customer keeps what
 * they paid for. POST /v2/subscriptions/{id}/cancel. Undo it with
 * `updateSubscription(id, { canceledDate: null })`.
 */
export async function cancelSubscription(
  config: SquareConfig,
  subscriptionId: string,
): Promise<SquareSubscriptionChange> {
  const res = await sqPost<RawChange>(
    config,
    `/v2/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {},
  );
  return mapChange(res, "cancel");
}

/**
 * Schedule a pause. POST /v2/subscriptions/{id}/pause. With no options it
 * pauses at the end of the current billing period, until resumed; give
 * `pauseCycles` to resume after that many skipped bills, or a
 * `resumeEffectiveDate`.
 */
export async function pauseSubscription(
  config: SquareConfig,
  subscriptionId: string,
  input: {
    /** `YYYY-MM-DD`; defaults to the end of the current billing period. */
    pauseEffectiveDate?: string;
    /** Billing cycles to skip before resuming on its own. */
    pauseCycles?: number;
    /** `YYYY-MM-DD` to resume on, instead of `pauseCycles`. */
    resumeEffectiveDate?: string;
    /** When the resume bills: `IMMEDIATE` or `END_OF_PERIOD`. */
    resumeChangeTiming?: "IMMEDIATE" | "END_OF_PERIOD";
    /** Shown in the Square Dashboard. */
    pauseReason?: string;
  } = {},
): Promise<SquareSubscriptionChange> {
  const res = await sqPost<RawChange>(
    config,
    `/v2/subscriptions/${encodeURIComponent(subscriptionId)}/pause`,
    {
      ...(input.pauseEffectiveDate ? { pause_effective_date: input.pauseEffectiveDate } : {}),
      ...(input.pauseCycles !== undefined ? { pause_cycle_duration: input.pauseCycles } : {}),
      ...(input.resumeEffectiveDate ? { resume_effective_date: input.resumeEffectiveDate } : {}),
      ...(input.resumeChangeTiming ? { resume_change_timing: input.resumeChangeTiming } : {}),
      ...(input.pauseReason ? { pause_reason: input.pauseReason } : {}),
    },
  );
  return mapChange(res, "pause");
}

/**
 * Schedule a resume of a paused or deactivated subscription.
 * POST /v2/subscriptions/{id}/resume. With no options it resumes now.
 */
export async function resumeSubscription(
  config: SquareConfig,
  subscriptionId: string,
  input: {
    /** `YYYY-MM-DD`; defaults to today. */
    resumeEffectiveDate?: string;
    /** When the first bill after the resume comes: `IMMEDIATE` or `END_OF_PERIOD`. */
    resumeChangeTiming?: "IMMEDIATE" | "END_OF_PERIOD";
  } = {},
): Promise<SquareSubscriptionChange> {
  const res = await sqPost<RawChange>(
    config,
    `/v2/subscriptions/${encodeURIComponent(subscriptionId)}/resume`,
    {
      ...(input.resumeEffectiveDate ? { resume_effective_date: input.resumeEffectiveDate } : {}),
      ...(input.resumeChangeTiming ? { resume_change_timing: input.resumeChangeTiming } : {}),
    },
  );
  return mapChange(res, "resume");
}
