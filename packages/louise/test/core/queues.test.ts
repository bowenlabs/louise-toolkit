import { afterEach, describe, expect, it, vi } from "vitest";
import { LouiseQueueError } from "../../src/core/errors.js";
import { enqueue, processBatch } from "../../src/core/queues/index.js";

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
});
