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
 * A deterministic idempotency key for a cart.
 *
 * Providers dedupe on this, so the same key must mean the same charge: it's
 * derived from the verified lines and the total, not from a random value or a
 * timestamp. A customer double-clicking Pay sends the same key twice and is
 * charged once; a customer who changes their cart and pays again sends a
 * different key and is charged correctly.
 */
export async function checkoutIdempotencyKey(
  verified: { lines: VerifiedLine[]; subtotalCents: number },
  scope: string,
): Promise<string> {
  const canonical = JSON.stringify({
    scope,
    total: verified.subtotalCents,
    lines: verified.lines.map((l) => `${l.variantId}:${l.quantity}:${l.unitPriceCents}`).sort(),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}
