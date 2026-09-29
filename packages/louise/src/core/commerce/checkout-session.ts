// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce—the checkout-session id a stored cart sends with its
// checkout, where the server scopes the payment's idempotency key to it.
//
// A cart that persists (in localStorage, say) needs an id that persists with
// it. An id held in page memory changes on every reload while the cart doesn't,
// so a customer whose paid checkout lost its response (a dropped connection, a
// force-quit app) reloads, retries the same cart under a new key, and pays
// twice.
//
// The id is stored with a fingerprint of the cart it was minted for. Asked for
// the id of a different cart, the session mints a new one, so an edited cart is
// a new attempt, whichever tab or screen edited it. Fingerprint what the
// customer chose (items, add-ons, quantities), not prices: a price repair after
// a lost response is still the same attempt, and must keep the same key.
//
// An id also retires after `idleMs` unused, so a cart left over from a lost
// response yesterday places a new order today instead of finding yesterday's.

import type { CartLine } from "./cart.js";

/** The slice of the Web Storage API a session uses. */
export interface CheckoutSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CheckoutSessionOptions {
  /** The storage key the id lives under. One per cart, so two carts on one
   *  origin never share an attempt. */
  storageKey: string;
  /**
   * How long an unused id stays current, in milliseconds. Each call to `id()`
   * restarts it. Keep it shorter than the server keeps its record of an
   * attempt's outcome, so a retry the client still calls this attempt finds
   * that record. No default: how long a leftover cart stays the same order is
   * the shop's call.
   */
  idleMs: number;
  /** Where the id persists. Defaults to `globalThis.localStorage`, read on each
   *  call, so a session made where there's no storage (on a server, say) falls
   *  back to page memory instead of throwing. */
  storage?: CheckoutSessionStorage;
}

export interface CheckoutSession {
  /**
   * The id for the cart `fingerprint` describes: the stored one while it was
   * minted for that fingerprint and used within `idleMs`, otherwise a new one,
   * stored before it's returned.
   */
  id(fingerprint: string, now?: number): string;
  /** Retire the id, so the next checkout is a new attempt: after an order is
   *  placed, or after a definite decline, when nothing was charged. */
  rotate(): void;
}

interface StoredSession {
  id: string;
  bag: string;
  /** Epoch milliseconds the id was last handed out. */
  usedAt: number;
}

const isStoredSession = (value: unknown): value is StoredSession => {
  const v = value as Partial<StoredSession> | null;
  return (
    typeof v?.id === "string" &&
    v.id.length > 0 &&
    typeof v.bag === "string" &&
    typeof v.usedAt === "number"
  );
};

/**
 * A checkout-session id that persists beside a stored cart and changes only
 * when the cart does, after `idleMs` unused, or on `rotate()`.
 *
 * Send `session.id(cartFingerprint(lines))` with each checkout, call
 * `rotate()` once an order is placed and after a definite decline, and derive
 * the server's payment idempotency key from the id and the lines as chosen,
 * never from prices or a tip.
 *
 * Storage that throws (private browsing, a full quota) moves the id to page
 * memory for the rest of the page's life, where a reload starts a new attempt.
 * While storage works, it alone is the truth, so another tab's `rotate()`
 * retires the id here too.
 */
export function checkoutSession(options: CheckoutSessionOptions): CheckoutSession {
  const { storageKey, idleMs } = options;
  if (!storageKey) throw new RangeError("storageKey must be a non-empty string");
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    throw new RangeError(`idleMs must be a positive number of milliseconds, got ${idleMs}`);
  }

  let memory: StoredSession | null = null;
  let storageFailed = false;
  // Where there's no localStorage, the first access throws a TypeError, and
  // the catch below moves the id to page memory like any other failure.
  const storage = (): CheckoutSessionStorage => options.storage ?? globalThis.localStorage;

  const read = (): StoredSession | null => {
    if (storageFailed) return memory;
    try {
      const raw = storage().getItem(storageKey);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isStoredSession(parsed) ? parsed : null;
    } catch {
      storageFailed = true;
      return memory;
    }
  };

  const write = (session: StoredSession) => {
    memory = session;
    if (storageFailed) return;
    try {
      storage().setItem(storageKey, JSON.stringify(session));
    } catch {
      storageFailed = true;
    }
  };

  return {
    id(fingerprint, now = Date.now()) {
      const stored = read();
      const current = stored && stored.bag === fingerprint && now - stored.usedAt < idleMs;
      const session = {
        id: current ? stored.id : crypto.randomUUID(),
        bag: fingerprint,
        usedAt: now,
      };
      write(session);
      return session.id;
    },
    rotate() {
      memory = null;
      if (storageFailed) return;
      try {
        storage().removeItem(storageKey);
      } catch {
        storageFailed = true;
      }
    },
  };
}

/**
 * What makes two carts the same order, for {@link checkoutSession}: each line's
 * variant, quantity, and add-on ids. Prices are left out, so a price repair
 * keeps the attempt. Line order and add-on order don't matter.
 */
export function cartFingerprint(
  lines: readonly Pick<CartLine, "variantId" | "quantity" | "modifiers">[],
): string {
  return JSON.stringify(
    lines
      .map((l) => {
        const modifiers = (l.modifiers ?? []).map((m) => m.id).sort();
        return `${l.variantId}:${l.quantity}:${modifiers.join(",")}`;
      })
      .sort(),
  );
}
