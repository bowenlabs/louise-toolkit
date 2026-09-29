// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/commerce—the checkout-session ID a stored cart sends with its
// checkout, where the server scopes the payment's idempotency key to it.
//
// A cart that persists (in localStorage, say) needs an ID that persists with
// it. An ID held in page memory changes on every reload while the cart doesn't,
// so a customer whose paid checkout lost its response (a dropped connection, a
// force-quit app) reloads, retries the same cart under a new key, and pays
// twice.
//
// The ID is stored with a fingerprint of the cart it was minted for. Asked for
// the ID of a different cart, the session mints a new one, so an edited cart is
// a new attempt, whichever tab or screen edited it. Fingerprint what the
// customer chose (items, add-ons, quantities), not prices: a price repair after
// a lost response is still the same attempt, and must keep the same key.
//
// An ID also retires after `idleMs` unused, so a cart left over from a lost
// response yesterday places a new order today instead of finding yesterday's.

import { type CartLine, cartLineIdentity } from "./cart.js";

/** The slice of the Web Storage API a session uses. */
export interface CheckoutSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CheckoutSessionOptions {
  /** The storage key the ID lives under. One per cart, so two carts on one
   *  origin never share an attempt. */
  storageKey: string;
  /**
   * How long an unused ID stays current, in milliseconds. Each call to `id()`
   * restarts it, up to `maxAgeMs`. No default: how long a leftover cart stays
   * the same order is the shop's call.
   */
  idleMs: number;
  /**
   * The longest an ID lives from when it was minted, in milliseconds, however
   * often it's used. At least `idleMs`. Keep the server's record of an
   * attempt's outcome longer than this, so every retry the client still calls
   * this attempt finds that record. Without a cap, a retry every hour would
   * keep the ID past any record's TTL.
   */
  maxAgeMs: number;
  /** Where the ID persists. Defaults to `globalThis.localStorage`, read on each
   *  call. */
  storage?: CheckoutSessionStorage;
}

export interface CheckoutSession {
  /**
   * The ID for the cart `fingerprint` describes: the stored one while it was
   * minted for that fingerprint and used within `idleMs`, otherwise a new one,
   * stored before it's returned.
   */
  id(fingerprint: string, now?: number): string;
  /** Retire the ID, so the next checkout is a new attempt: after an order is
   *  placed, or after a definite decline, when nothing was charged. */
  rotate(): void;
}

interface StoredSession {
  id: string;
  bag: string;
  /** Epoch milliseconds the ID was minted. */
  mintedAt: number;
  /** Epoch milliseconds the ID was last handed out. */
  usedAt: number;
}

const isStoredSession = (value: unknown): value is StoredSession => {
  const v = value as Partial<StoredSession> | null;
  return (
    typeof v?.id === "string" &&
    v.id.length > 0 &&
    typeof v.bag === "string" &&
    typeof v.mintedAt === "number" &&
    typeof v.usedAt === "number"
  );
};

/**
 * A v4 UUID. `crypto.randomUUID` exists only in a secure context, so a page on
 * plain `http://` (a LAN dev server, an embedded web view on a custom scheme)
 * builds one from `crypto.getRandomValues`, which exists everywhere.
 */
function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A checkout-session ID that persists beside a stored cart and changes only
 * when the cart does, after `idleMs` unused, or on `rotate()`.
 *
 * Send `session.id(cartFingerprint(lines))` with each checkout, call
 * `rotate()` once an order is placed and after a definite decline, and derive
 * the server's payment idempotency key from the ID and the lines as chosen,
 * never from prices or a tip.
 *
 * Storage that throws (private browsing, a full quota) moves the ID to page
 * memory for the rest of the page's life, where a reload starts a new attempt.
 * While storage works, it alone is the truth, so another tab's `rotate()`
 * retires the ID here too. Storage has no compare-and-set, so this narrows
 * the window without closing it: two tabs that mint an ID for the same cart
 * at the same moment can still send different ones.
 *
 * A browser primitive. On a server, where there's no `document`, memory is
 * shared by every request, so without a `storage` option a session keeps
 * nothing between calls: two customers with the same cart must never share an
 * ID, or the second one's payment is deduplicated into the first one's.
 */
export function checkoutSession(options: CheckoutSessionOptions): CheckoutSession {
  const { storageKey, idleMs, maxAgeMs } = options;
  if (!storageKey) throw new RangeError("storageKey must be a non-empty string");
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    throw new RangeError(`idleMs must be a positive number of milliseconds, got ${idleMs}`);
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < idleMs) {
    throw new RangeError(
      `maxAgeMs must be a number of milliseconds of at least idleMs, got ${maxAgeMs}`,
    );
  }

  let memory: StoredSession | null = null;
  let storageFailed = false;
  // Page memory is one customer's only in a page. Where there's no document
  // and no storage was passed (a server), keep nothing between calls.
  const shared = options.storage === undefined && typeof document === "undefined";
  // Where there's no localStorage, the first access throws a TypeError, and
  // the catch below moves the ID to page memory like any other failure.
  const storage = (): CheckoutSessionStorage => options.storage ?? globalThis.localStorage;

  const read = (): StoredSession | null => {
    if (storageFailed) return memory;
    if (shared) return null;
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
    if (shared) return;
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
      // A stamp ahead of `now` (a clock moved backward) doesn't count, or the
      // windows would never apply.
      const current =
        stored &&
        stored.bag === fingerprint &&
        now >= stored.usedAt &&
        now - stored.usedAt < idleMs &&
        now >= stored.mintedAt &&
        now - stored.mintedAt < maxAgeMs;
      const session: StoredSession = current
        ? { ...stored, usedAt: now }
        : { id: randomId(), bag: fingerprint, mintedAt: now, usedAt: now };
      write(session);
      return session.id;
    },
    rotate() {
      memory = null;
      if (shared || storageFailed) return;
      try {
        storage().removeItem(storageKey);
      } catch {
        storageFailed = true;
      }
    },
  };
}

/**
 * What makes two carts the same order, for {@link checkoutSession}: how many of
 * each variant-and-add-ons combination they hold. Prices are left out, so a
 * price repair keeps the attempt. Line order, add-on order, and how the
 * quantity is split across lines don't matter.
 */
export function cartFingerprint(
  lines: readonly Pick<CartLine, "variantId" | "quantity" | "modifiers">[],
): string {
  const quantities = new Map<string, number>();
  for (const line of lines) {
    const identity = cartLineIdentity(line);
    quantities.set(identity, (quantities.get(identity) ?? 0) + line.quantity);
  }
  return JSON.stringify([...quantities].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
