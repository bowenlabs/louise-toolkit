// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce/square: cards on file, which subscriptions charge.

import type { SquareConfig } from "./client.js";
import { orNotFound, sqGet, sqPost } from "./request.js";

export interface SquareCard {
  id: string;
  last4: string | null;
  cardBrand: string | null;
  expMonth: number | null;
  expYear: number | null;
  /** The customer the card is on file for, when Square says. */
  customerId?: string | null;
  /** `false` once disabled. */
  enabled?: boolean;
}

interface RawCard {
  id?: string;
  last_4?: string;
  card_brand?: string;
  exp_month?: number;
  exp_year?: number;
  customer_id?: string;
  enabled?: boolean;
}

function mapCard(c: RawCard): SquareCard {
  return {
    id: c.id ?? "",
    last4: c.last_4 ?? null,
    cardBrand: c.card_brand ?? null,
    expMonth: c.exp_month ?? null,
    expYear: c.exp_year ?? null,
    customerId: c.customer_id ?? null,
    enabled: c.enabled !== false,
  };
}

/**
 * Save a card on file from a Web Payments token, attached to a customer—the
 * card id then seeds a subscription. POST /v2/cards.
 */
export async function createCard(
  config: SquareConfig,
  input: {
    sourceId: string;
    customerId: string;
    idempotencyKey?: string;
    verificationToken?: string;
  },
): Promise<SquareCard> {
  const res = await sqPost<{ card?: RawCard }>(config, "/v2/cards", {
    idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    source_id: input.sourceId,
    verification_token: input.verificationToken,
    card: { customer_id: input.customerId },
  });
  if (!res.card) throw new Error("Square card creation returned no card");
  return mapCard(res.card);
}

/**
 * A customer's cards on file, following the cursor. GET /v2/cards. Enabled
 * cards only unless `includeDisabled`.
 */
export async function listCards(
  config: SquareConfig,
  input: { customerId: string; includeDisabled?: boolean; maxPages?: number },
): Promise<SquareCard[]> {
  const cards: SquareCard[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < (input.maxPages ?? 10); page++) {
    const q = new URLSearchParams({
      customer_id: input.customerId,
      include_disabled: String(input.includeDisabled ?? false),
    });
    if (cursor) q.set("cursor", cursor);
    const res = await sqGet<{ cards?: RawCard[]; cursor?: string }>(config, `/v2/cards?${q}`);
    cards.push(...(res.cards ?? []).map(mapCard));
    cursor = res.cursor;
    if (!cursor) break;
  }
  return cards;
}

/**
 * Disable (remove) a card on file—but only if it is on file for
 * `customerId`. Returns `false`, without disabling anything, when the card
 * doesn't exist or belongs to someone else, so a guessed card id from one
 * signed-in customer can't remove another's. POST /v2/cards/{id}/disable.
 */
export async function disableCard(
  config: SquareConfig,
  cardId: string,
  input: { customerId: string },
): Promise<boolean> {
  const id = encodeURIComponent(cardId);
  const card = await orNotFound(() => sqGet<{ card?: RawCard }>(config, `/v2/cards/${id}`));
  if (!card?.card || card.card.customer_id !== input.customerId) return false;
  await sqPost(config, `/v2/cards/${id}/disable`, {});
  return true;
}
