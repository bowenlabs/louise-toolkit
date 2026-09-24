// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/worker — a read-through KV cache for a lookup that runs on
// every request (a tenant by hostname, a settings row, a feature flag).
// `withEdgeCache` caches whole responses; this caches one value.

/** The subset of a KV namespace this uses. */
export interface KvCacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Stored for a cached miss. Not valid JSON, so it can't collide with a value. */
const MISS = "\u0000miss";

/** KV's floor for `expirationTtl`. A lower value is a KV error, not a short cache. */
const KV_MIN_TTL_SECONDS = 60;

export interface KvCachedOptions {
  /** How long a value (and a miss) stays cached. At least 60 — KV's minimum. */
  ttlSeconds: number;
  /**
   * Cache `null` results too. Default `true`: a lookup keyed by something a
   * visitor controls (a hostname, a slug) otherwise costs one database read
   * per garbage request — this makes it one read per key per TTL.
   */
  cacheMisses?: boolean;
}

/**
 * Read `key` from KV, or run `load` and store what it returns (JSON). `null`
 * from `load` means "not found" and is cached too, unless `cacheMisses: false`.
 *
 * Fails open: a KV read or write that throws is ignored and `load` runs, so a
 * cache outage costs speed, never correctness. A value that no longer parses
 * is treated as a miss. `kv` may be `undefined` (unbound in dev) — then this
 * is just `load()`.
 *
 * After a write to the underlying data, call {@link kvBust} for the key, or
 * readers see the old value for up to `ttlSeconds`.
 */
export async function kvCached<T>(
  kv: KvCacheStore | undefined,
  key: string,
  load: () => Promise<T | null>,
  options: KvCachedOptions,
): Promise<T | null> {
  if (!(options.ttlSeconds >= KV_MIN_TTL_SECONDS)) {
    throw new RangeError(
      `kvCached ttlSeconds must be at least ${KV_MIN_TTL_SECONDS} (KV's minimum)`,
    );
  }
  const raw = kv ? await kv.get(key).catch(() => null) : null;
  if (raw === MISS) return null;
  if (raw !== null) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Unparseable (a different format from an older deploy): reload.
    }
  }
  const value = await load();
  if (kv && (value !== null || options.cacheMisses !== false)) {
    await kv
      .put(key, value === null ? MISS : JSON.stringify(value), {
        expirationTtl: options.ttlSeconds,
      })
      .catch(() => {});
  }
  return value;
}

/** Drop a cached key after the data behind it changes. Fails open, like the read. */
export async function kvBust(kv: KvCacheStore | undefined, key: string): Promise<void> {
  await kv?.delete(key).catch(() => {});
}
