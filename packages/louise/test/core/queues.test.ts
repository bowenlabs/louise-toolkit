import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LouiseQueueError } from "../../src/core/errors.js";
import type { IncidentInput } from "../../src/core/incidents/index.js";
import { onIncidentEmitted } from "../../src/core/incidents/channel.js";
import {
  DEFAULT_MAX_RETRIES,
  defaultRetryDelay,
  enqueue,
  processBatch,
} from "../../src/core/queues/index.js";

function fakeMessage<T>(body: T, attempts = 1, id = "msg") {
  return {
    body,
    attempts,
    id,
    timestamp: new Date(),
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function fakeBatch<T>(messages: ReturnType<typeof fakeMessage<T>>[], queue = "example-queue") {
  return { queue, messages } as unknown as MessageBatch<T>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueue", () => {
  it("sends the message onto the queue binding", async () => {
    const queue = { send: vi.fn().mockResolvedValue(undefined) };
    await enqueue(queue as unknown as Queue<{ hello: string }>, {
      hello: "world",
    });
    expect(queue.send).toHaveBeenCalledWith({ hello: "world" });
  });

  it("wraps a send failure in LouiseQueueError", async () => {
    const queue = { send: vi.fn().mockRejectedValue(new Error("down")) };
    await expect(enqueue(queue as unknown as Queue<number>, 1)).rejects.toBeInstanceOf(
      LouiseQueueError,
    );
  });
});

describe("processBatch", () => {
  it("acks every message the handler resolves", async () => {
    const a = fakeMessage("a");
    const b = fakeMessage("b");
    await processBatch(fakeBatch([a, b]), async () => {});
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.ack).toHaveBeenCalledOnce();
    expect(a.retry).not.toHaveBeenCalled();
  });

  it("retries only the failing message, still acking the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const good = fakeMessage("good");
    const bad = fakeMessage("bad");
    await processBatch(fakeBatch([good, bad]), async (body) => {
      if (body === "bad") throw new Error("handler blew up");
    });
    expect(good.ack).toHaveBeenCalledOnce();
    expect(bad.retry).toHaveBeenCalledOnce();
    expect(bad.ack).not.toHaveBeenCalled();
  });

  it("logs a failed query without its bound values", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = new DrizzleQueryError('insert into "orders" ("note") values (?)', [
      "Leave it with the neighbor",
    ]);
    await processBatch(fakeBatch([fakeMessage("order")]), async () => {
      throw failed;
    });
    const logged = error.mock.calls[0]![1] as Error;
    expect(logged.message).toBe("Failed query: insert into orders");
    expect(`${logged.message}\n${logged.stack}`).not.toContain("neighbor");
  });

  it("logs each failure with the queue, message id, and attempt before retrying", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = fakeMessage("first", 2, "msg-1");
    const second = fakeMessage("second", 3, "msg-2");
    const cause = new Error("handler blew up");
    await processBatch(fakeBatch([first, second], "side-effects"), async () => {
      throw cause;
    });
    expect(error).toHaveBeenCalledTimes(2);
    const [line, logged] = error.mock.calls[0]!;
    expect(line).toContain("side-effects");
    expect(line).toContain("msg-1");
    expect(line).toContain("attempt 2");
    expect(logged).toBe(cause);
    expect(error.mock.calls[1]![0]).toContain("msg-2");
    expect(error.mock.calls[1]![0]).toContain("attempt 3");
    // Logged before the retry, so the line lands even if `retry()` throws.
    expect(error.mock.invocationCallOrder[0]).toBeLessThan(
      first.retry.mock.invocationCallOrder[0]!,
    );
  });

  it("logs a thrown non-Error value as it is", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = fakeMessage("x");
    await processBatch(fakeBatch([m]), () => {
      throw "plain string";
    });
    expect(error).toHaveBeenCalledWith(expect.any(String), "plain string");
    expect(m.retry).toHaveBeenCalledOnce();
  });

  it("logs nothing when every message succeeds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await processBatch(fakeBatch([fakeMessage("a"), fakeMessage("b")]), async () => {});
    expect(error).not.toHaveBeenCalled();
  });

  it("passes the 1-indexed delivery count to the handler", async () => {
    const m = fakeMessage("x", 3);
    const handler = vi.fn();
    await processBatch(fakeBatch([m]), handler);
    expect(handler).toHaveBeenCalledWith("x", { attempts: 3 });
  });

  it("retries with a delay that grows with the attempt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const messages = [1, 2, 3, 5, 9].map((attempts) => fakeMessage("x", attempts));
    await processBatch(fakeBatch(messages), () => {
      throw new Error("rate limited");
    });
    expect(messages.map((m) => m.retry.mock.calls[0]![0])).toEqual([
      { delaySeconds: 30 },
      { delaySeconds: 60 },
      { delaySeconds: 120 },
      { delaySeconds: 300 },
      { delaySeconds: 300 },
    ]);
  });

  it("takes the retry delay from options.retryDelay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = fakeMessage("x", 4);
    const retryDelay = vi.fn((attempts: number) => attempts * 10);
    await processBatch(
      fakeBatch([m]),
      () => {
        throw new Error("down");
      },
      { retryDelay },
    );
    expect(retryDelay).toHaveBeenCalledWith(4);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 40 });
  });
});

describe("defaultRetryDelay", () => {
  it("starts at 30 seconds, doubles, and caps at 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 20].map(defaultRetryDelay)).toEqual([30, 60, 120, 240, 300, 300]);
  });

  it("treats an attempt below 1 as the first", () => {
    expect(defaultRetryDelay(0)).toBe(30);
  });
});

describe("processBatch incidents", () => {
  /** Collect what processBatch emits while `run` runs. */
  async function emitted(run: () => Promise<void>): Promise<IncidentInput[]> {
    const inputs: IncidentInput[] = [];
    const stop = onIncidentEmitted((input) => inputs.push(input));
    try {
      await run();
    } finally {
      stop();
    }
    return inputs;
  }

  it("reports a failure on the message's last delivery, and only then", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("upstream down");
    const early = fakeMessage("early", DEFAULT_MAX_RETRIES, "msg-early");
    const last = fakeMessage("last", DEFAULT_MAX_RETRIES + 1, "msg-last");
    const inputs = await emitted(() =>
      processBatch(fakeBatch([early, last], "side-effects"), async () => {
        throw cause;
      }),
    );
    expect(inputs).toEqual([{ kind: "queue", cause, path: "side-effects" }]);
    // Both are still handed back to Cloudflare, which moves the last one on.
    expect(early.retry).toHaveBeenCalledOnce();
    expect(last.retry).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]![0]).toContain("marking it for retry");
    expect(error.mock.calls[1]![0]).toContain("that was its last attempt");
  });

  it("reads the last delivery from maxRetries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const second = fakeMessage("x", 2);
    const inputs = await emitted(() =>
      processBatch(
        fakeBatch([second]),
        async () => {
          throw new Error("x");
        },
        { maxRetries: 1 },
      ),
    );
    expect(inputs).toHaveLength(1);
  });

  it("reports nothing when the message succeeds on its last delivery", async () => {
    const m = fakeMessage("x", DEFAULT_MAX_RETRIES + 1);
    const inputs = await emitted(() => processBatch(fakeBatch([m]), async () => {}));
    expect(inputs).toEqual([]);
    expect(m.ack).toHaveBeenCalledOnce();
  });
});
