---
title: workflows
description: "louise-toolkit/workflows — durable multi-step pipelines over Cloudflare Workflows."
sidebar:
  order: 6.5
---

```ts
import { startWorkflow, defineWorkflow, type WorkflowPipelineStep } from "louise-toolkit/workflows";
```

A thin wrapper over [Cloudflare Workflows](https://developers.cloudflare.com/workflows/) — the
**durable, multi-step** sibling of [`queues`](/reference/queues/). Each step's result is persisted and
its retries/backoff are owned per-step, so a flow resumes mid-way after a failure instead of replaying
from the top.

:::tip[Queues vs Workflows]
Reach for **Queues** when the deferred work is a single fire-and-forget side-effect (the FTS reindex on
publish). Reach for **Workflows** when a job is inherently several steps that must each survive —
publish (OG → warm cache → reindex → notify webhook), or commerce fulfillment (verified webhook →
email → inventory write). Queues replays the whole message on retry; Workflows skips already-completed
steps.
:::

## `startWorkflow(workflow, params, options?)`

```ts
function startWorkflow<P>(
  workflow: Workflow<P>,
  params: P,
  options?: { id?: string },
): Promise<WorkflowInstance>;
```

Starts a new Workflow instance (the producer, mirroring `enqueue`). A `create` failure is wrapped in
[`LouiseWorkflowError`](/reference/errors/) (original as `cause`). Pass `id` for idempotency — creating
with an existing id throws, so a stable key coalesces a double-trigger:

```ts
await startWorkflow(env.PUBLISH_WORKFLOW, { collection: "pages", id }, { id: `publish:pages:${id}` });
```

## `defineWorkflow(steps, initialState?)`

```ts
function defineWorkflow<Env, Params, State extends object>(
  steps: WorkflowPipelineStep<Env, Params, State>[],
  initialState?: State,
): (env: Env, event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) => Promise<State>;

interface WorkflowPipelineStep<Env, Params, State extends object> {
  name: string;                 // stable — Workflows keys the persisted result by it
  config?: WorkflowStepConfig;  // per-step retries / backoff / timeout
  run: (ctx: { env: Env; payload: Readonly<Params>; state: Readonly<State> })
    => Promise<Partial<State> | void> | Partial<State> | void;
}
```

Turns an ordered list of named steps into a `WorkflowEntrypoint.run` body (mirroring `processBatch`).
Each step runs inside `step.do` — durable, retried per its `config` — and returns a patch merged into a
shared `State` that later steps read and the run resolves to. Because the patch **is** the value
`step.do` persists, a retry/resume reuses it rather than re-running the step.

## The publish pipeline as a Workflow

The site owns the `WorkflowEntrypoint` subclass and the wrangler binding (it imports
`cloudflare:workers`), exactly as it owns the Queues `queue()` export — `louise-toolkit/workflows` stays
runtime glue.

```ts
// workers/site/src/workflows/publish.ts
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { defineWorkflow } from "louise-toolkit/workflows";
import { reindexDoc } from "louise-toolkit/content";

interface PublishParams { collection: string; id: number }
interface PublishState { ogKey?: string; reindexed?: boolean; notified?: boolean }

const runPublish = defineWorkflow<Env, PublishParams, PublishState>([
  { name: "og",      run: ({ env, payload }) => ({ ogKey: renderAndStoreOg(env, payload) }) },
  { name: "cache",   run: ({ env, state }) => { void warmCache(env, state.ogKey); } },
  { name: "reindex", config: { retries: { limit: 5, delay: "10 seconds" } },
                     run: async ({ env, payload }) => {
                       await reindexDoc(db(env.DB), pages, pagesCollection, payload.id);
                       return { reindexed: true };
                     } },
  { name: "webhook", run: async ({ env, payload }) => {
                       await fetch(env.PUBLISH_WEBHOOK, { method: "POST", body: JSON.stringify(payload) });
                       return { notified: true };
                     } },
]);

export class PublishWorkflow extends WorkflowEntrypoint<Env, PublishParams> {
  run(event: Readonly<WorkflowEvent<PublishParams>>, step: WorkflowStep) {
    return runPublish(this.env, event, step);
  }
}
```

Trigger it from the publish route with `startWorkflow(env.PUBLISH_WORKFLOW, { collection, id })`, and
bind it in `wrangler.jsonc`:

```jsonc
"workflows": [
  { "binding": "PUBLISH_WORKFLOW", "name": "louise-publish", "class_name": "PublishWorkflow" }
]
```

:::note[Cloudflare owns durability]
Retry limits, backoff, and step persistence are Workflows' job — configure retries per step via
`config.retries`. A step's own throw surfaces as-is so Workflows can retry it; only failing to *start*
an instance raises `LouiseWorkflowError`.
:::
