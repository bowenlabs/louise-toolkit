import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  type AiFailureReason,
  type AiRunner,
  classifyAiError,
  generateAltText,
  rewriteText,
  runAi,
  suggestSeo,
} from "../../src/core/ai/index.js";
import { type DegradedEvent, onDegraded } from "../../src/core/errors.js";
import type { IncidentReport } from "../../src/core/incidents/index.js";
import { composeWorker } from "../../src/core/worker/index.js";

const returning = (output: unknown): AiRunner => ({ run: async () => output });
const throwing = (err: unknown): AiRunner => ({
  run: async () => {
    throw err;
  },
});

/** Run `work`, and return the degrades it reported. */
async function degrades(work: () => Promise<unknown>): Promise<DegradedEvent[]> {
  const events: DegradedEvent[] = [];
  const off = onDegraded((event) => events.push(event));
  try {
    await work();
  } finally {
    off();
  }
  return events;
}

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  error.mockRestore();
});

describe("classifyAiError", () => {
  it.each([
    ["5007: No such model @cf/meta/llama-3.1-8b-instruct or task", "model-retired"],
    ["InferenceUpstreamError: 3042: Invalid model ID", "model-retired"],
    ["This model is deprecated", "model-retired"],
    ["3040: Capacity temporarily exceeded, please try again.", "rate-limited"],
    ["3036: Daily free allocation exceeded", "rate-limited"],
    ["Too many requests", "rate-limited"],
    ["3023: Service unavailable for account", "unavailable"],
    ["5018: Account not allowed to access this model", "unavailable"],
    ["3007: Request timeout", "unavailable"],
    ["something else went wrong", "error"],
  ] as const)("reads %j as %s", (message, reason) => {
    expect(classifyAiError(new Error(message))).toBe(reason);
  });

  it("counts a 429 status as rate-limited", () => {
    expect(classifyAiError(Object.assign(new Error("upstream said no"), { status: 429 }))).toBe(
      "rate-limited",
    );
  });

  it("reads a thrown value that isn't an Error, and never throws", () => {
    expect(classifyAiError("5007: No such model")).toBe("model-retired");
    expect(classifyAiError(undefined)).toBe("error");
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    expect(classifyAiError(hostile)).toBe("error");
  });

  it("doesn't read a code inside a longer number", () => {
    expect(classifyAiError(new Error("request 150073 failed"))).toBe("error");
  });
});

describe("runAi degrades carry the reason in their name", () => {
  it("reports a retired model as ai.run.model-retired", async () => {
    const events = await degrades(() =>
      runAi(throwing(new Error("5007: No such model @cf/old/model or task")), "@cf/old/model", {}),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "ai.run.model-retired",
      details: { model: "@cf/old/model", reason: "model-retired" },
    });
  });

  it("still returns null", async () => {
    expect(await runAi(throwing(new Error("boom")), "m", {})).toBeNull();
  });
});

describe("the helpers tell onFailure why they returned null", () => {
  const cases: [string, AiRunner | undefined, AiFailureReason][] = [
    ["no runner", undefined, "unavailable"],
    ["a retired model", throwing(new Error("5007: No such model")), "model-retired"],
    ["capacity", throwing(new Error("3040: Capacity temporarily exceeded")), "rate-limited"],
    [
      "a cut-off answer",
      returning({ response: "The first", finish_reason: "length" }),
      "truncated",
    ],
    ["no text", returning({ nope: true }), "invalid-output"],
  ];

  it.each(cases)("rewriteText: %s", async (_label, runner, reason) => {
    const onFailure = vi.fn();
    expect(await rewriteText(runner, "a passage", { onFailure })).toBeNull();
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it.each(cases)("generateAltText: %s", async (_label, runner, reason) => {
    const onFailure = vi.fn();
    expect(await generateAltText(runner, new Uint8Array([1, 2, 3]), { onFailure })).toBeNull();
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it("rewriteText: a reply that's only a preamble is invalid output", async () => {
    const onFailure = vi.fn();
    const events = await degrades(() =>
      rewriteText(returning({ response: "Here is the rewrite:" }), "a passage", { onFailure }),
    );
    expect(onFailure).toHaveBeenCalledExactlyOnceWith("invalid-output");
    expect(events.map((e) => e.name)).toEqual(["ai.invalid-output"]);
  });

  it("suggestSeo: a reply that isn't JSON, or has neither field, is invalid output", async () => {
    for (const response of ["not json", '{"title":"","description":" "}']) {
      const onFailure = vi.fn();
      const events = await degrades(() =>
        suggestSeo(returning({ response }), "a page", { onFailure }),
      );
      expect(onFailure).toHaveBeenCalledExactlyOnceWith("invalid-output");
      expect(events.map((e) => e.name)).toEqual(["ai.invalid-output"]);
    }
  });

  it("suggestSeo: a cut-off reply is truncated", async () => {
    const onFailure = vi.fn();
    const runner = returning({
      response: '{"title":"T","description":"D"}',
      finish_reason: "length",
    });
    expect(await suggestSeo(runner, "a page", { onFailure })).toBeNull();
    expect(onFailure).toHaveBeenCalledExactlyOnceWith("truncated");
  });

  it("doesn't call onFailure for blank input or a success", async () => {
    const onFailure = vi.fn();
    expect(await rewriteText(returning({ response: "x" }), "   ", { onFailure })).toBeNull();
    expect(await rewriteText(returning({ response: "Tighter." }), "wordy", { onFailure })).toBe(
      "Tighter.",
    );
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("keeps its never-throws contract when onFailure throws", async () => {
    const onFailure = () => {
      throw new Error("listener broke");
    };
    await expect(rewriteText(undefined, "a passage", { onFailure })).resolves.toBeNull();
  });
});

describe("a retired model is its own incident (ADR 0022's done-when)", () => {
  it("reports ai.run.model-retired through capture, apart from other AI failures", async () => {
    const reports: IncidentReport[] = [];
    const retired = throwing(new Error("5007: No such model @cf/old/model or task"));
    const busy = throwing(new Error("3040: Capacity temporarily exceeded"));
    const worker = composeWorker({
      fetch: async (request) => {
        const runner = new URL(request.url).pathname === "/busy" ? busy : retired;
        const text = await rewriteText(runner, "a passage", { model: "@cf/old/model" });
        return new Response(text ?? "fallback");
      },
      onIncident: (report) => {
        reports.push(report);
      },
    });
    type IncomingRequest = Parameters<NonNullable<ExportedHandler["fetch"]>>[0];
    for (const path of ["/", "/", "/busy"]) {
      const pending: Promise<unknown>[] = [];
      const ctx = {
        waitUntil: (p: Promise<unknown>) => pending.push(p),
        passThroughOnException() {},
      };
      const res = await worker.fetch!(
        new Request(`https://site.example${path}`) as unknown as IncomingRequest,
        {},
        ctx as unknown as ExecutionContext,
      );
      expect(await res.text()).toBe("fallback");
      await Promise.all(pending);
    }
    expect(reports.map((r) => r.name)).toEqual([
      "ai.run.model-retired",
      "ai.run.model-retired",
      "ai.run.rate-limited",
    ]);
    expect(reports[0]!.fingerprint).toBe(reports[1]!.fingerprint);
    expect(reports[0]!.fingerprint).not.toBe(reports[2]!.fingerprint);
  });
});
