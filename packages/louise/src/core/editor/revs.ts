// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—field revisions for draft saves (#572).
//
// A draft save used to merge over the freshest pending work with no idea what
// the client last saw, so two tabs, or an agent saving while an owner types,
// overwrote each other field by field and nobody was told. A field revision is
// a short hash of a field's stored value. The server hands one out for every
// field it shows or stores; a save sends back the revisions it started from,
// and a field whose stored value has moved since then is a conflict (an
// optimistic offline lock, per field, so a second surface saving other fields
// still layers on).
//
// Content hashes rather than timestamps, so one rule covers every merge base:
// the KV buffer, a D1 draft, and the live row all compare the same way.

/** The body key a draft save carries its base revisions under, beside the fields. */
export const DRAFT_BASE_KEY = "$base";

/** One field a draft save couldn't apply, because someone else changed it. */
export interface DraftConflict {
  /** The field key. */
  field: string;
  /** The value stored now, which the save would have overwritten. */
  value: unknown;
  /** Its revision, to send as the base when the owner keeps their own edit. */
  rev: string;
}

/**
 * A field value's revision: the first 16 hex characters of the SHA-256 of its
 * JSON. `undefined` hashes as `null`. Stable across a store and a read, because
 * a JSON round trip keeps key order.
 */
export async function fieldRev(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value ?? null));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const byte of digest.subarray(0, 8)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** The revisions of `keys` in `data`, as a field → revision map. */
export async function fieldRevs(
  data: Record<string, unknown>,
  keys: Iterable<string>,
): Promise<Record<string, string>> {
  const revs: Record<string, string> = {};
  for (const key of keys) revs[key] = await fieldRev(data[key]);
  return revs;
}

/** `value` as a field → revision map, or `undefined` when it isn't one. */
export function parseDraftBase(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const base: Record<string, string> = {};
  for (const [key, rev] of Object.entries(value)) {
    if (typeof rev === "string") base[key] = rev;
  }
  return base;
}
