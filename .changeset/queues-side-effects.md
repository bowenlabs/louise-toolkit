---
"louise-toolkit": minor
---

Move FTS reindex off the write path onto Cloudflare Queues (#77) — publish returns as soon as the row is written; the search index syncs asynchronously.

- `createLocalApi` / `createVersionedLocalApi` accept a `LocalApiOptions.deferReindex` callback. When set, create/update/publish/delete hand the changed row's id to it **instead of** syncing the FTS index inline; unset keeps the inline sync, so nothing changes for callers without a queue.
- `reindexDoc(db, table, config, id)` — the deferred counterpart: re-reads the row (upsert its index entry, or remove it if the row is gone). Call it from a queue consumer to drain a job. No-op for a collection without `config.search`.
- `versionsRoute` gains a `deferReindex?: (env) => DeferReindex | undefined` option (given the runtime env so it can reach a queue binding); returning `undefined` falls back to inline sync.
- `louise-toolkit/queues` adds the `SideEffectJob` message type (an extensible `kind: "reindex"` union) to pair with the existing `enqueue` / `processBatch` primitives.

Site: bind a `QUEUE` producer + a `queue()` consumer (batches of 10 / 5s, 3 retries, then a dead-letter queue) that drains reindex jobs via `reindexDoc`. Provision `wrangler queues create louisetoolkit-side-effects{,-dlq}` before deploying.
