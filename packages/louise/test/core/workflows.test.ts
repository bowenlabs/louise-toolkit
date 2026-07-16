import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { LouiseWorkflowError } from "../../src/core/errors.js";
import {
  defineWorkflow,
  startWorkflow,
  type WorkflowPipelineStep,
} from "../../src/core/workflows/index.js";

interface PublishParams {
  collection: string;
  id: number;
}
interface PublishState {
  ogKey?: string;
  cached?: boolean;
  reindexed?: boolean;
  notified?: boolean;
}

const event = (payload: PublishParams): Readonly<WorkflowEvent<PublishParams>> =>
  ({
    payload,
    timestamp: new Date(),
    instanceId: "i",
    workflowName: "publish",
  }) as WorkflowEvent<PublishParams>;

// A fake `step` whose `do(name, config?, cb)` just records the call and runs the
// callback synchronously — enough to exercise the runner without a real Workflows
// runtime (there is no in-repo Workflows harness; live execution needs wrangler).
function fakeStep() {
  const calls: { name: string; config?: WorkflowStepConfig }[] = [];
  const step = {
    async do(name: string, a: unknown, b?: unknown) {
      const [config, cb] = typeof a === "function" ? [undefined, a] : [a as WorkflowStepConfig, b];
      calls.push({ name, config });
      return await (cb as () => Promise<unknown>)();
    },
    sleep: vi.fn(),
    sleepUntil: vi.fn(),
    waitForEvent: vi.fn(),
  };
  return { step: step as unknown as WorkflowStep, calls };
}

describe("defineWorkflow", () => {
  it("runs steps in order and threads state into later steps", async () => {
    const seen: Record<string, unknown> = {};
    const steps: WorkflowPipelineStep<Record<never, never>, PublishParams, PublishState>[] = [
      { name: "og", run: ({ payload }) => ({ ogKey: `og/${payload.collection}/${payload.id}` }) },
      {
        name: "cache",
        run: ({ state }) => {
          seen.cacheSawOgKey = state.ogKey;
          return { cached: true };
        },
      },
      {
        name: "reindex",
        config: { retries: { limit: 5, delay: "10 seconds" } },
        run: () => ({ reindexed: true }),
      },
      {
        name: "webhook",
        run: ({ state }) => {
          seen.webhookSawCached = state.cached;
          return { notified: true };
        },
      },
    ];
    const { step, calls } = fakeStep();
    const result = await defineWorkflow(steps)({}, event({ collection: "pages", id: 42 }), step);

    expect(calls.map((c) => c.name)).toEqual(["og", "cache", "reindex", "webhook"]);
    expect(seen.cacheSawOgKey).toBe("og/pages/42");
    expect(seen.webhookSawCached).toBe(true);
    expect(result).toEqual({
      ogKey: "og/pages/42",
      cached: true,
      reindexed: true,
      notified: true,
    });
  });

  it("passes each step's retry config through to step.do", async () => {
    const config: WorkflowStepConfig = { retries: { limit: 5, delay: "10 seconds" } };
    const { step, calls } = fakeStep();
    await defineWorkflow<Record<never, never>, PublishParams, PublishState>([
      { name: "reindex", config, run: () => ({}) },
    ])({}, event({ collection: "pages", id: 1 }), step);
    expect(calls[0]).toEqual({ name: "reindex", config });
  });

  it("propagates a step failure so Workflows can retry it, stopping the pipeline", async () => {
    const { step, calls } = fakeStep();
    const run = defineWorkflow<Record<never, never>, PublishParams, PublishState>([
      { name: "og", run: () => ({ ogKey: "x" }) },
      {
        name: "reindex",
        run: () => {
          throw new Error("D1 down");
        },
      },
      { name: "webhook", run: () => ({ notified: true }) },
    ]);
    await expect(run({}, event({ collection: "pages", id: 1 }), step)).rejects.toThrow("D1 down");
    expect(calls.map((c) => c.name)).toEqual(["og", "reindex"]); // never reached webhook
  });

  it("tolerates a step that returns nothing (void patch)", async () => {
    const { step } = fakeStep();
    const result = await defineWorkflow<Record<never, never>, PublishParams, PublishState>([
      { name: "og", run: () => ({ ogKey: "x" }) },
      { name: "cache", run: () => {} },
    ])({}, event({ collection: "pages", id: 1 }), step);
    expect(result).toEqual({ ogKey: "x" });
  });

  it("passes env to each step", async () => {
    const { step } = fakeStep();
    const result = await defineWorkflow<{ token: string }, PublishParams, PublishState>([
      { name: "webhook", run: ({ env }) => ({ notified: env.token === "secret" }) },
    ])({ token: "secret" }, event({ collection: "pages", id: 1 }), step);
    expect(result.notified).toBe(true);
  });
});

describe("startWorkflow", () => {
  it("creates an instance with the id + params", async () => {
    const instance = { id: "abc" };
    const workflow = { create: vi.fn().mockResolvedValue(instance) };
    const out = await startWorkflow(
      workflow as unknown as Workflow<PublishParams>,
      { collection: "pages", id: 42 },
      { id: "publish:pages:42" },
    );
    expect(workflow.create).toHaveBeenCalledWith({
      id: "publish:pages:42",
      params: { collection: "pages", id: 42 },
    });
    expect(out).toBe(instance);
  });

  it("omits the id when not given", async () => {
    const workflow = { create: vi.fn().mockResolvedValue({}) };
    await startWorkflow(workflow as unknown as Workflow<number>, 7);
    expect(workflow.create).toHaveBeenCalledWith({ id: undefined, params: 7 });
  });

  it("wraps a create failure in LouiseWorkflowError", async () => {
    const workflow = { create: vi.fn().mockRejectedValue(new Error("no capacity")) };
    await expect(startWorkflow(workflow as unknown as Workflow<number>, 1)).rejects.toBeInstanceOf(
      LouiseWorkflowError,
    );
  });
});
