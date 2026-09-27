---
"louise-toolkit": minor
---

Webhooks carry a delivery ID, and `deliverWebhook` gives any webhook the checked delivery path (#579).

- **Delivery IDs:** `createWebhookHook` fixes a `deliveryId` on each message when it's enqueued, and `deliverWebhookMessage` sends it as `X-Louise-Delivery` and as `deliveryId` in the signed body. A retry carries the same ID, so a receiver can drop the repeat.
- **`deliverWebhook(url, payload, { secret?, deliveryId?, policy? })`** is the checked path on its own: `fetchPublicUrl` with its timeout, the optional signature, and a throw on a non-2xx status. Use it from a publish Workflow's notify step instead of a bare `fetch`, so a receiver that answers 500 fails the step and it retries.
- **Workflow steps get `instanceId`:** `defineWorkflow` passes the run's instance ID to each step. It's the same on every retry, so it's the delivery ID for a step's webhook.

**Upgrading:** nothing is required. A message enqueued before you deploy has no `deliveryId`, so it's delivered without the header, as before. The workflows reference's publish example now uses `deliverWebhook`; if you copied its bare `fetch`, switch to it.
