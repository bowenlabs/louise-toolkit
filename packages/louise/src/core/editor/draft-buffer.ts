// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — a Workers KV write-buffer for high-frequency auto-save
// (#70). Auto-save fires a draft write on every idle pause; on a busy page that
// hammers D1 with a version row per debounce tick. This buffers the working
// draft in KV (fast, cheap, one key overwritten) and only *flushes* to D1 — the
// source of truth — on a boundary: the first write of a session, an interval
// while editing, and on publish. Resume reads prefer the buffer (it's the
// freshest work); publish clears it.
//
// Consistency model (deliberately simple): the buffer is only ever *ahead of or
// equal to* the D1 draft — every auto-save writes the buffer, D1 is flushed
// periodically — and it's deleted on publish. So "the freshest pending draft" is
// `buffer ?? D1 draft`, with no timestamp reconciliation needed. KV is
// eventually consistent and caps ~1 sustained write/sec per key, which is why it
// is a scratch buffer and D1 stays authoritative.

/** The KV surface the buffer needs — structural so the real `KVNamespace` fits
 *  without a hard dependency. Unlike `security`'s `KVLike`, this also needs
 *  `delete` (to clear a buffer on publish). */
export interface DraftBufferKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A page's buffered working draft. `data` is the full field snapshot (the same
 *  shape a version's `versionData` holds). */
export interface BufferedDraft {
  data: Record<string, unknown>;
  /** Last buffer write (ms epoch). */
  updatedAt: number;
  /** Last flush to D1 (ms epoch); `0` when never flushed. */
  flushedAt: number;
}

/** Default self-expiry for an abandoned buffer: 7 days. */
export const DRAFT_BUFFER_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Default flush cadence: coalesce D1 writes to at most one per 10s while a burst
 *  of edits continues. */
export const DEFAULT_FLUSH_MS = 10_000;

/** KV key for a collection row's draft buffer. */
export function draftBufferKey(collection: string, id: number | string): string {
  return `draft:${collection}:${id}`;
}

/** Read + parse a page's buffer, or `null` when absent/corrupt. */
export async function readDraftBuffer(
  kv: DraftBufferKV,
  key: string,
): Promise<BufferedDraft | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BufferedDraft;
    return parsed && typeof parsed === "object" && parsed.data ? parsed : null;
  } catch {
    return null;
  }
}

/** Write a page's buffer with a self-expiry TTL. */
export async function writeDraftBuffer(
  kv: DraftBufferKV,
  key: string,
  draft: BufferedDraft,
  ttlSeconds: number = DRAFT_BUFFER_TTL_SECONDS,
): Promise<void> {
  await kv.put(key, JSON.stringify(draft), { expirationTtl: ttlSeconds });
}

/** Delete a page's buffer (on publish, or when discarding pending work). */
export async function clearDraftBuffer(kv: DraftBufferKV, key: string): Promise<void> {
  await kv.delete(key);
}

/**
 * Should this auto-save flush to D1, or just update the buffer? Flush when there
 * is no buffer yet (establish the D1 draft row so `hasDraft` + resume work even
 * if the buffer later expires) or when at least `flushMs` has elapsed since the
 * last flush. Otherwise the write is absorbed by the buffer alone.
 */
export function shouldFlushBuffer(
  buffer: BufferedDraft | null,
  now: number,
  flushMs: number,
): boolean {
  if (!buffer) return true;
  return now - buffer.flushedAt >= flushMs;
}
