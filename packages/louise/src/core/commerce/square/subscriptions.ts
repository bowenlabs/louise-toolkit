// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: subscriptions.

import type { SquareConfig } from "./client.js";
import { sqPost } from "./request.js";

export interface SquareSubscription {
  id: string;
  status: string;
  planVariationId: string | null;
  customerId: string | null;
  cardId: string | null;
  startDate: string | null;
  chargedThroughDate: string | null;
}

interface RawSubscription {
  id?: string;
  status?: string;
  plan_variation_id?: string;
  customer_id?: string;
  card_id?: string;
  start_date?: string;
  charged_through_date?: string;
}

function mapSubscription(sub: RawSubscription): SquareSubscription {
  return {
    id: sub.id ?? "",
    status: sub.status ?? "",
    planVariationId: sub.plan_variation_id ?? null,
    customerId: sub.customer_id ?? null,
    cardId: sub.card_id ?? null,
    startDate: sub.start_date ?? null,
    chargedThroughDate: sub.charged_through_date ?? null,
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

/**
 * Enroll a customer in a subscription plan variation, billed to a saved card.
 * POST /v2/subscriptions.
 */
export async function createSubscription(
  config: SquareConfig,
  input: {
    locationId: string;
    planVariationId: string;
    customerId: string;
    cardId: string;
    idempotencyKey?: string;
  },
): Promise<SquareSubscription> {
  const res = await sqPost<{ subscription?: RawSubscription }>(config, "/v2/subscriptions", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    location_id: input.locationId,
    plan_variation_id: input.planVariationId,
    customer_id: input.customerId,
    card_id: input.cardId,
  });
  if (!res.subscription) throw new Error("Square subscription creation returned no subscription");
  return mapSubscription(res.subscription);
}
