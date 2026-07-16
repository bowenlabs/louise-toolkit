// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/workflows
//
// Thin wrapper over Cloudflare Workflows — the durable, multi-step sibling of
// louise-toolkit/queues. Where Queues is fire-and-forget (`enqueue` + a
// `processBatch` ack/retry loop), Workflows persists each step's result and owns
// per-step retries/backoff, so a flow can resume mid-way after a failure instead
// of replaying from the top. Reach for this when a job is inherently several steps
// that must each survive (publish: OG → warm cache → reindex → notify webhook;
// commerce fulfillment); reach for Queues when it's a single deferred side-effect.
//
// Producer side is a single `startWorkflow()` call. Consumer side is
// `defineWorkflow()`, which turns an ordered list of named steps into a
// `WorkflowEntrypoint.run` body — each step runs inside `step.do` (so its result
// is persisted and skipped on resume). The site owns the `WorkflowEntrypoint`
// subclass + the wrangler `[[workflows]]` binding (it imports `cloudflare:workers`),
// exactly as it owns the Queues `queue()` export — this module stays runtime-glue.

import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { LouiseWorkflowError } from "../errors.js";

/**
 * Start a new Workflow instance. Mirrors {@link import("../queues/index.js").enqueue}:
 * the producer is one call, and a create failure is wrapped in
 * {@link LouiseWorkflowError}. `Workflow`/`WorkflowInstance` are the ambient
 * Cloudflare binding types. Pass `id` for idempotency (creating with an existing
 * id throws) — e.g. `publish:pages:42` so a double-publish coalesces.
 */
export async function startWorkflow<P>(
  workflow: Workflow<P>,
  params: P,
  options?: { id?: string },
): Promise<WorkflowInstance> {
  try {
    return await workflow.create({ id: options?.id, params });
  } catch (cause) {
    throw new LouiseWorkflowError("Failed to start workflow", cause);
  }
}

/**
 * One durable step in a Louise workflow pipeline. `run` does the work and returns
 * a patch merged into the shared `state` for later steps; the patch is the value
 * `step.do` persists, so on a retry/resume the stored patch is reused rather than
 * `run` being called again. Keep `name` stable — Workflows keys the persisted
 * result by it.
 */
export interface WorkflowPipelineStep<Env, Params, State extends object> {
  /** Durable step name — stable across deploys (the persisted-result key). */
  name: string;
  /** Per-step retries/backoff/timeout (Cloudflare's `WorkflowStepConfig`). */
  config?: WorkflowStepConfig;
  /** The work: receives the runtime `env`, the event `payload`, and the state
   *  accumulated from prior steps; returns a patch merged into that state. */
  run: (ctx: {
    env: Env;
    payload: Readonly<Params>;
    state: Readonly<State>;
  }) => Promise<Partial<State> | void> | Partial<State> | void;
}

// `step.do`'s real signature constrains its result to `Rpc.Serializable`. Our
// patches are plain JSON state, so bridge the constraint with one contained,
// permissive local shape rather than leaking it into the public API.
type StepDo = {
  (name: string, config: WorkflowStepConfig, callback: () => Promise<unknown>): Promise<unknown>;
  (name: string, callback: () => Promise<unknown>): Promise<unknown>;
};

/**
 * Build a `WorkflowEntrypoint.run` body from an ordered list of steps. Mirrors
 * {@link import("../queues/index.js").processBatch}: it encapsulates the durable
 * loop so a site's Workflow collapses to composing steps. Each step runs inside
 * `step.do` (durable + retried per its `config`); its returned patch is merged
 * into a shared `State` that later steps read and the run resolves to.
 *
 * ```ts
 * // site worker (imports `cloudflare:workers`, owns the class + wrangler binding):
 * const runPublish = defineWorkflow<Env, PublishParams, PublishState>([
 *   { name: "og",      run: ({ env, payload }) => ({ ogKey: … }) },
 *   { name: "cache",   run: ({ env, state }) => { … } },
 *   { name: "reindex", config: { retries: { limit: 5, delay: "10 seconds" } }, run: … },
 *   { name: "webhook", run: … },
 * ]);
 * export class PublishWorkflow extends WorkflowEntrypoint<Env, PublishParams> {
 *   run(event, step) { return runPublish(this.env, event, step); }
 * }
 * ```
 */
export function defineWorkflow<Env, Params, State extends object = Record<string, unknown>>(
  steps: WorkflowPipelineStep<Env, Params, State>[],
  initialState?: State,
): (env: Env, event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) => Promise<State> {
  return async (env, event, step) => {
    const doStep = step.do.bind(step) as unknown as StepDo;
    let state = { ...(initialState ?? ({} as State)) } as State;
    for (const s of steps) {
      const work = () =>
        Promise.resolve(s.run({ env, payload: event.payload, state })).then((patch) => patch ?? {});
      const patch = (await (s.config
        ? doStep(s.name, s.config, work)
        : doStep(s.name, work))) as Partial<State>;
      state = { ...state, ...patch } as State;
    }
    return state;
  };
}
