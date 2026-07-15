// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/queues
//
// Thin wrapper over Cloudflare Queues' `Queue`/`MessageBatch` bindings.
// Producer side is a single `enqueue()` call; consumer side is a batch
// runner that acks each message on success and calls `retry()` on
// failure. Cloudflare Queues — not this module — owns the actual
// redelivery/backoff schedule and DLQ routing: once a message exceeds the
// queue's configured `max_retries`, CF routes it to that queue's
// `dead_letter_queue` automatically (set in wrangler.jsonc, not here).

import { LouiseQueueError } from "../errors.js";

/**
 * A deferred post-write side-effect drained by a Worker's `queue()` consumer
 * (#77) — keeps the write path to just the DB mutation while derived work runs
 * async. An extensible discriminated union; match on `kind`. `reindex` (the
 * first member) re-syncs one collection row's FTS entry: it's enqueued by
 * `versionsRoute`'s `deferReindex` and drained with `reindexDoc`
 * (louise-toolkit/content), which upserts the row's index entry or removes it if
 * the row is gone.
 */
export type SideEffectJob = {
  kind: "reindex";
  /** Collection slug — the consumer maps it to a table + config. */
  collection: string;
  /** The changed row's id (the FTS rowid). */
  id: number;
};

/** Enqueues `message` onto `queue`. Throws LouiseQueueError on failure. */
export async function enqueue<T>(queue: Queue<T>, message: T): Promise<void> {
  try {
    await queue.send(message);
  } catch (cause) {
    throw new LouiseQueueError("Failed to enqueue message", cause);
  }
}

/**
 * Called once per message in a batch. Throwing marks that message for
 * retry; returning normally acks it. `attempts` is the 1-indexed delivery
 * count CF Queues reports on the message itself.
 */
export type QueueMessageHandler<T> = (
  message: T,
  context: { attempts: number },
) => void | Promise<void>;

/**
 * Drains a `MessageBatch`, running `handler` once per message. Each
 * message is acked or retried independently — one failing message
 * doesn't block the rest of the batch from acking. Never throws itself;
 * a handler's own errors are caught and turned into a `retry()` so a
 * Worker's `queue()` export can call this directly as its entire body.
 */
export async function processBatch<T>(
  batch: MessageBatch<T>,
  handler: QueueMessageHandler<T>,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handler(message.body, { attempts: message.attempts });
      message.ack();
    } catch {
      message.retry();
    }
  }
}
