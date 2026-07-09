---
title: queues
description: "louisecms/queues — Cloudflare Queues producer and batch consumer."
sidebar:
  order: 6
---

```ts
import { enqueue, processBatch, type QueueMessageHandler } from "louisecms/queues";
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

## `processBatch(batch, handler)`

```ts
function processBatch<T>(batch: MessageBatch<T>, handler: QueueMessageHandler<T>): Promise<void>;

type QueueMessageHandler<T> = (message: T, context: { attempts: number }) => void | Promise<void>;
```

Drains a batch, running `handler` once per message. Each message is **acked or
retried independently** — one failing message doesn't block the rest from
acking. `processBatch` never throws: a handler's own error is caught and turned
into a `retry()`, so a Worker's `queue()` export can be the whole body.

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

:::note[Cloudflare owns redelivery]
Backoff, `max_retries`, and dead-letter routing are configured in
`wrangler.jsonc`, not here — once a message exceeds `max_retries`, Cloudflare
routes it to that queue's `dead_letter_queue` automatically. `context.attempts`
is the 1-indexed delivery count so your handler can behave differently on the
final try.
:::
