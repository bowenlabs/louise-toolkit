// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Server-authoritative checkout.
//
// A cart arrives from the browser, so every number in it is a claim, not a fact.
// The rule this encodes — taken from coracle.coffee's working checkout — is that
// the client's price is a **staleness check**, never an input to the charge:
// look the price up server-side, and if it disagrees with what the customer was
// shown, refuse rather than silently charging a different amount. Refusing is
// the customer-friendly branch too; being charged more than the page said is
// worse than being asked to review the cart.
//
// The failure this prevents is not exotic. Accept `unitPrice` from the request
// body and anyone can buy anything for a penny.

import { AstroidUsageError } from "../errors.js";

/** One line as the CLIENT sent it. Every field is untrusted. */
export interface ClientLine {
  /** Provider id of the variant/item being bought. */
  variantId: string;
  quantity: number;
  /**
   * The unit price, in minor units, that the customer was SHOWN. Compared
   * against the server's price; never used to compute the charge.
   */
  unitPriceCents: number;
}

/** A line after the server has re-priced it. */
export interface VerifiedLine {
  variantId: string;
  quantity: number;
  /** The server's price. This is what gets charged. */
  unitPriceCents: number;
  subtotalCents: number;
}

export type CheckoutVerification =
  | { ok: true; lines: VerifiedLine[]; subtotalCents: number }
  | { ok: false; reason: "empty" | "unavailable" | "price-changed" | "invalid"; message: string };

/** Look up current prices, in minor units, keyed by variant id. Anything the
 *  map omits is treated as no longer purchasable. */
export type PriceLookup = (variantIds: string[]) => Promise<Map<string, number>>;

const MAX_QUANTITY = 999;

/**
 * Re-price a cart against the provider and decide whether it may proceed.
 *
 * ```ts
 * const check = await verifyCheckout(body.lines, (ids) => serverPrices(env, ids));
 * if (!check.ok) return json({ error: check.message }, 409);
 * await charge(check.subtotalCents);   // the SERVER's number
 * ```
 */
export async function verifyCheckout(
  lines: unknown,
  lookup: PriceLookup,
): Promise<CheckoutVerification> {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, reason: "empty", message: "Your cart is empty." };
  }

  const parsed: ClientLine[] = [];
  for (const raw of lines) {
    const l = raw as Partial<ClientLine>;
    // A non-integer or negative quantity is the other half of the price
    // exploit: a quantity of -1 turns a charge into a refund on some providers.
    if (
      typeof l?.variantId !== "string" ||
      !l.variantId ||
      typeof l.quantity !== "number" ||
      !Number.isInteger(l.quantity) ||
      l.quantity < 1 ||
      l.quantity > MAX_QUANTITY ||
      typeof l.unitPriceCents !== "number" ||
      !Number.isFinite(l.unitPriceCents)
    ) {
      return { ok: false, reason: "invalid", message: "That cart isn't valid." };
    }
    parsed.push({ variantId: l.variantId, quantity: l.quantity, unitPriceCents: l.unitPriceCents });
  }

  const prices = await lookup([...new Set(parsed.map((l) => l.variantId))]);

  const verified: VerifiedLine[] = [];
  let subtotalCents = 0;
  for (const line of parsed) {
    const serverPrice = prices.get(line.variantId);
    if (serverPrice === undefined) {
      return {
        ok: false,
        reason: "unavailable",
        message: "An item in your cart is no longer available.",
      };
    }
    if (serverPrice !== line.unitPriceCents) {
      return {
        ok: false,
        reason: "price-changed",
        message: "Prices changed — please review your cart.",
      };
    }
    const lineSubtotal = serverPrice * line.quantity;
    verified.push({
      variantId: line.variantId,
      quantity: line.quantity,
      unitPriceCents: serverPrice,
      subtotalCents: lineSubtotal,
    });
    subtotalCents += lineSubtotal;
  }

  return { ok: true, lines: verified, subtotalCents };
}

/**
 * A deterministic idempotency key for one buyer's checkout attempt.
 *
 * Providers dedupe on this, so the same key must mean the same charge — which
 * cuts both ways, and the second direction is the one that costs money. It is
 * derived from the verified cart *and* `identity`, not from a random value or a
 * timestamp: a customer double-clicking Pay sends the same key twice and is
 * charged once, while a customer who changes their cart pays under a different
 * key and is charged correctly.
 *
 * **`identity` is required, and it is what makes the key safe.** Without it the
 * key was a pure function of the cart contents, so two DIFFERENT customers
 * buying the same thing for the same price produced byte-identical keys. Stripe
 * and Square scope idempotency keys per account and retain them for ~24h, so the
 * provider replayed the first customer's PaymentIntent instead of creating the
 * second's: the second buyer was never charged, no second order existed, and the
 * site reported success. On a single-SKU storefront that is ordinary traffic,
 * not an edge case.
 *
 * Pass something stable across a retry of THIS attempt and distinct between
 * buyers — a cart id, a checkout-session id, or a portal user id. Do not pass a
 * value that varies per request (a fresh uuid defeats the dedupe and a
 * double-click charges twice), and do not pass a constant.
 *
 * `scope` remains the OPERATION — `"order"` vs `"refund"` — so the two can never
 * collide for one buyer. It is not an identity and never was.
 */
export async function checkoutIdempotencyKey(
  verified: { lines: VerifiedLine[]; subtotalCents: number },
  scope: string,
  identity: string,
): Promise<string> {
  // Empty is rejected rather than defaulted: a falsy identity would silently
  // restore the collision this parameter exists to close, and a charge that
  // goes missing is not something the caller finds out about.
  if (typeof identity !== "string" || identity.trim().length === 0) {
    throw new AstroidUsageError(
      "checkoutIdempotencyKey requires a non-empty `identity` (a cart id, checkout-session id, " +
        "or user id). Without it the key is a function of the cart alone, so two customers " +
        "buying the same items collide and the second is never charged.",
    );
  }
  const canonical = JSON.stringify({
    scope,
    identity,
    total: verified.subtotalCents,
    lines: verified.lines.map((l) => `${l.variantId}:${l.quantity}:${l.unitPriceCents}`).sort(),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}
