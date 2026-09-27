// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/queues
//
// Thin wrapper over Cloudflare Queues' `Queue`/`MessageBatch` bindings.
// Producer side is a single `enqueue()` call; consumer side is a batch
// runner that acks each message on success and, on failure, logs the error
// and calls `retry()` with a delay that grows with the delivery attempt.
// Cloudflare Queues—not this module—owns redelivery and DLQ routing: once a
// message exceeds the queue's configured `max_retries`, CF routes it to that
// queue's `dead_letter_queue` automatically (set in wrangler.jsonc, not here).

import { LouiseQueueError } from "../errors.js";
import { emitIncident } from "../incidents/channel.js";

/**
 * A deferred post-write side-effect drained by a Worker's `queue()` consumer
 * (#77)—keeps the write path to just the DB mutation while derived work runs
 * async. An extensible discriminated union; match on `kind`. `reindex` (the
 * first member) re-syncs one collection row's FTS entry: it's enqueued by
 * `versionsRoute`'s `deferReindex` and drained with `reindexDoc`
 * (louise-toolkit/content), which upserts the row's index entry or removes it if
 * the row is gone.
 */
export type SideEffectJob = {
  kind: "reindex";
  /** Collection slug—the consumer maps it to a table + config. */
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

/** Options for {@link processBatch}. */
export interface ProcessBatchOptions {
  /**
   * Seconds to wait before Cloudflare redelivers a failed message, given its
   * 1-indexed delivery attempt. Defaults to {@link defaultRetryDelay}: 30
   * seconds, doubling each attempt, capped at 5 minutes. Return 0 to redeliver
   * with no delay.
   */
  retryDelay?: (attempts: number) => number;
  /**
   * The queue's `max_retries`, as set in `wrangler.jsonc`. Defaults to
   * {@link DEFAULT_MAX_RETRIES}, Cloudflare's own default. A message that
   * fails on delivery `maxRetries + 1`, its last, is reported as a `queue`
   * incident (ADR 0022 § 7); an earlier failure is only logged, because a
   * retry may still clear it.
   */
  maxRetries?: number;
}

/** Cloudflare Queues' default `max_retries`: 3 retries, so 4 deliveries. */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * The default backoff for a failed message: 30 seconds on the first
 * delivery, then a minute, then two, doubling up to a 5-minute cap.
 */
export function defaultRetryDelay(attempts: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Drains a `MessageBatch`, running `handler` once per message. Each
 * message is acked or retried independently—one failing message
 * doesn't block the rest of the batch from acking. Never throws itself;
 * a handler's own errors are caught and turned into a `retry()` so a
 * Worker's `queue()` export can call this directly as its entire body.
 *
 * Before each retry, `processBatch` logs the failure with `console.error`:
 * the queue name, the message id, and the delivery attempt, with the error
 * itself as the second argument. Without that line, a failure leaves no trace
 * in Workers Logs—once the queue's `max_retries` is spent, Cloudflare moves
 * the message to the dead-letter queue, or drops it if there's none, and logs
 * nothing.
 *
 * On a message's last delivery, the failure is also reported as a `queue`
 * incident, named for the error and pathed with the queue's name. It reaches
 * the sinks of `composeWorker`'s `onIncident` when the Worker's `queue`
 * handler finishes; without `onIncident`, the log line is the only trace.
 *
 * A retry waits before redelivery, by `options.retryDelay` or
 * {@link defaultRetryDelay}. A failure from an upstream rate limit or outage
 * rarely clears in the same second, so an immediate redelivery only spends a
 * try. Retries inside a handler multiply with queue redeliveries: a handler
 * that makes up to 4 calls per delivery, on a queue with `max_retries: 5`,
 * makes up to 24 calls for one message. Keep the in-handler retries few and
 * let the queue's backoff do the waiting.
 */
export async function processBatch<T>(
  batch: MessageBatch<T>,
  handler: QueueMessageHandler<T>,
  options: ProcessBatchOptions = {},
): Promise<void> {
  const retryDelay = options.retryDelay ?? defaultRetryDelay;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  for (const message of batch.messages) {
    try {
      await handler(message.body, { attempts: message.attempts });
      message.ack();
    } catch (err) {
      const last = message.attempts > maxRetries;
      console.error(
        `[louise] queue handler failed on ${batch.queue} (message ${message.id}, attempt ${message.attempts}); ${
          last
            ? "that was its last attempt, so it goes to the dead-letter queue, if the queue has one"
            : "marking it for retry"
        }`,
        err,
      );
      if (last) emitIncident({ kind: "queue", cause: err, path: batch.queue });
      message.retry({ delaySeconds: retryDelay(message.attempts) });
    }
  }
}
