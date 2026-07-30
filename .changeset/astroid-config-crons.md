---
"astroidjs": minor
---

**`AstroidConfig.crons` — more than two scheduled triggers.**

`astroidCrons()` returned exactly two expressions and the generated `scheduled`
handler dispatched on those two literals, so a project needing a third had two bad
options: add it in the Cloudflare dashboard, where it drifts from the
`wrangler.jsonc` that is supposed to describe the deploy; or add it to
`triggers.crons`, where the generated dispatch never matches it and Cloudflare
fires an invocation that does nothing, with no error anywhere.

```ts
crons: [
  { expression: "*/15 * * * *", message: { kind: "inventory_pull" } },
  { expression: "30 3 * * *", message: { kind: "nightly_reconcile" } },
],
```

Each entry is emitted into **both** `triggers.crons` and the dispatch, from the
same list, so the two cannot drift. `scripts/ci/checks/crons-dispatched.mjs`
already enforces that agreement against a real scaffold; there is now a unit test
asserting the same invariant.

The message is **enqueued, never run inline**, so the work takes the same retry
and DLQ path as everything else and a slow job can't hold the scheduled handler
open. It is typed `unknown` because the consumer owns the message vocabulary —
whatever you put there arrives at your `handleQueueMessage`'s `onMessage`.

**Two config-time refusals**, both for failures that are otherwise silent:

- **A duplicate expression.** One handler dispatches on `controller.cron` in
  order, so a cron colliding with the health scan, the catalog re-sync, or another
  entry never reaches its own branch — the first wins, and the config reads as
  though both are live. This is the exact unreachable-trigger failure the feature
  exists to prevent, so it refuses rather than reproduces it.
- **Crons without the queue consumer.** A cron's work is enqueued, so without one
  the generated handler would `send` to a binding the project never creates.
