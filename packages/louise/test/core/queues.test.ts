import { describe, expect, it, vi } from "vitest";
import { LouiseQueueError } from "../../src/core/errors.js";
import { enqueue, processBatch } from "../../src/core/queues/index.js";

function fakeMessage<T>(body: T, attempts = 1) {
  return {
    body,
    attempts,
    id: "msg",
    timestamp: new Date(),
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

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
    await processBatch({ messages: [a, b] } as unknown as MessageBatch<string>, async () => {});
    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.ack).toHaveBeenCalledOnce();
    expect(a.retry).not.toHaveBeenCalled();
  });

  it("retries only the failing message, still acking the rest", async () => {
    const good = fakeMessage("good");
    const bad = fakeMessage("bad");
    await processBatch(
      { messages: [good, bad] } as unknown as MessageBatch<string>,
      async (body) => {
        if (body === "bad") throw new Error("handler blew up");
      },
    );
    expect(good.ack).toHaveBeenCalledOnce();
    expect(bad.retry).toHaveBeenCalledOnce();
    expect(bad.ack).not.toHaveBeenCalled();
  });

  it("passes the 1-indexed delivery count to the handler", async () => {
    const m = fakeMessage("x", 3);
    const handler = vi.fn();
    await processBatch({ messages: [m] } as unknown as MessageBatch<string>, handler);
    expect(handler).toHaveBeenCalledWith("x", { attempts: 3 });
  });
});
