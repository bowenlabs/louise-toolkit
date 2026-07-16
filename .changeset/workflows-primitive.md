---
"louise-toolkit": minor
---

Add `louise-toolkit/workflows` (#88) — a thin wrapper over Cloudflare Workflows for durable, multi-step pipelines, the sibling of `louise-toolkit/queues`. Where Queues is fire-and-forget, Workflows persists each step's result and owns per-step retries/backoff, so a flow (publish: OG → warm cache → reindex → notify webhook; commerce fulfillment) resumes mid-way after a failure instead of replaying from the top.

- `startWorkflow(workflow, params, options?)` — the producer (mirrors `enqueue`); wraps a `create` failure in `LouiseWorkflowError`, and takes an optional idempotency `id`.
- `defineWorkflow(steps, initialState?)` — turns an ordered list of named steps into a `WorkflowEntrypoint.run` body (mirrors `processBatch`): each step runs inside `step.do` (durable, retried per its `config`) and returns a patch merged into a shared, typed `State` that later steps read.

The site owns the `WorkflowEntrypoint` subclass + the wrangler `[[workflows]]` binding (it imports `cloudflare:workers`), exactly as it owns the Queues `queue()` export. Queues-vs-Workflows guidance is in the docs, and louisetoolkit.com wires the real publish path onto a `PublishWorkflow` (reindex → warm the OG card → notify webhook), with graceful fallback to the reindex Queue when no Workflow is bound.
