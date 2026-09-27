---
title: queues
description: "louise-toolkit/queues—Cloudflare Queues producer and batch consumer."
sidebar:
  order: 6
---

```ts
import {
  DEFAULT_MAX_RETRIES,
  defaultRetryDelay,
  enqueue,
  processBatch,
  type ProcessBatchOptions,
  type QueueMessageHandler,
} from "louise-toolkit/queues";
```

A thin wrapper over Cloudflare Queues. No peers.

## `enqueue(queue, message)`

```ts
function enqueue<T>(queue: Queue<T>, message: T): Promise<void>;
```

Sends one message onto a queue binding. A send failure is wrapped in
[`LouiseQueueError`](/reference/errors/) (original as `cause`).

```ts
await enqueue(env.COMMERCE_QUEUE, { type: "order.created", id });
```

## `processBatch(batch, handler, options?)`

```ts
function processBatch<T>(
  batch: MessageBatch<T>,
  handler: QueueMessageHandler<T>,
  options?: ProcessBatchOptions,
): Promise<void>;

type QueueMessageHandler<T> = (message: T, context: { attempts: number }) => void | Promise<void>;

interface ProcessBatchOptions {
  retryDelay?: (attempts: number) => number; // seconds; default defaultRetryDelay
  maxRetries?: number; // the queue's max_retries; default DEFAULT_MAX_RETRIES (3)
}
```

Drains a batch, running `handler` once per message. Each message is **acked or
retried independently**—one failing message doesn't block the rest from
acking. `processBatch` never throws: a handler's own error is caught and turned
into a `retry()`, so a Worker's `queue()` export can be the whole body.

Before each retry, `processBatch` logs the failure with `console.error`: the
queue name, the message id, and the delivery attempt, with the error itself as
the second argument. The line lands in Workers Logs, so a message that
exhausts its retries leaves a trace before Cloudflare moves it to the
dead-letter queue. To surface a failure, throw from the handler: a handler
that returns without throwing acks the message, and `processBatch` logs
nothing.

A failure on a message's last delivery is also an incident (ADR 0022 § 7).
`maxRetries` is the queue's `max_retries` from `wrangler.jsonc`, 3 by default,
as Cloudflare's is; delivery `maxRetries + 1` is the last. That failure is
reported as a `queue` incident named for the error, with the queue's name as its
`path`, and reaches [`composeWorker`'s `onIncident`](/reference/worker/#incident-capture-onincident)
sinks when the Worker's `queue` handler finishes. An earlier failure is only
logged, because a retry may still clear it. Without `onIncident`, the log line
is the only trace. To keep what dead-letters, give the dead-letter queue a
[consumer](/reference/incidents/#deadletterconsumerdatabase-table).

```ts
export default {
  async queue(batch: MessageBatch, env: Env) {
    await processBatch(batch, async (msg, { attempts }) => {
      // Throwing marks THIS message for retry; returning acks it.
      await handleEvent(msg, env);
    });
  },
};
```

### Retry delay

A failed message waits before Cloudflare redelivers it. The default,
`defaultRetryDelay(attempts)`, is 30 seconds on the first delivery, then a
minute, then two, doubling up to a 5-minute cap. A failure from a rate limit or
an upstream outage rarely clears within the same second, so an immediate
redelivery only spends a try. Pass `retryDelay` to change it, or return `0` to
redeliver at once:

```ts
await processBatch(batch, handle, { retryDelay: (attempts) => attempts * 60 });
```

Retries inside a handler multiply with the queue's redeliveries. A handler that
calls a provider with three retries of its own makes up to four calls per
delivery; on a queue with `max_retries: 5`, that's six deliveries and up to 24
calls for one message. Keep the handler's own retries few and let the queue's
backoff do the waiting.

:::note[Cloudflare owns redelivery]
`max_retries` and dead-letter routing are configured in `wrangler.jsonc`, not
here—once a message exceeds `max_retries`, Cloudflare routes it to that queue's
`dead_letter_queue` automatically. `processBatch` sets each retry's
`delaySeconds`, which overrides the queue's `retry_delay`. `context.attempts` is
the 1-indexed delivery count so your handler can behave differently on the
final try.
:::
