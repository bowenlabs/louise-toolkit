import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { LouiseDbError, reportDegraded } from "../../src/core/errors.js";
import type { IncidentReport } from "../../src/core/incidents/index.js";
import { isCriticalIncident } from "../../src/core/incidents/index.js";
import { composeWorker, withIncidentCapture } from "../../src/core/worker/index.js";

// --- test doubles ----------------------------------------------------------

/** A fake ExecutionContext that keeps `waitUntil` work so a test can await it. */
function makeCtx(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(Promise.resolve(p));
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, settled: () => Promise.all(pending).then(() => undefined) };
}

type IncomingRequest = Parameters<NonNullable<ExportedHandler["fetch"]>>[0];
const req = (url = "https://site.example/cart?session=abc") =>
  new Request(url) as unknown as IncomingRequest;

/** A sink that records every report it gets. */
function recorder() {
  const reports: IncidentReport[] = [];
  const sink = (report: IncidentReport) => {
    reports.push(report);
  };
  return { reports, sink };
}

const batch = (queue: string) => ({ queue, messages: [] }) as unknown as MessageBatch<unknown>;
const controller = (cron: string) => ({ cron, scheduledTime: 0 }) as unknown as ScheduledController;

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  error.mockRestore();
});

// --- fetch -----------------------------------------------------------------

describe("composeWorker({ onIncident })", () => {
  it("reports a throw from the fallback, then re-throws it", async () => {
    const { reports, sink } = recorder();
    const boom = new LouiseDbError("connection reset");
    const worker = composeWorker({
      fetch: async () => {
        throw boom;
      },
      onIncident: sink,
    });
    const { ctx, settled } = makeCtx();

    await expect(worker.fetch!(req(), {}, ctx)).rejects.toBe(boom);
    await settled();

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      kind: "fetch",
      name: "LouiseDbError",
      code: "DB_ERROR",
      message: "connection reset",
      path: "/cart",
      host: "site.example",
      critical: false,
    });
  });

  it("reports a throw from a route", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      routes: [
        async () => {
          throw new TypeError("fetch failed");
        },
      ],
      fetch: async () => new Response("never"),
      onIncident: [sink],
    });
    const { ctx, settled } = makeCtx();
    await expect(worker.fetch!(req(), {}, ctx)).rejects.toThrow("fetch failed");
    await settled();
    expect(reports.map((r) => r.name)).toEqual(["TypeError"]);
  });

  it("changes nothing when the request succeeds", async () => {
    const sink = vi.fn();
    const worker = composeWorker({ fetch: async () => new Response("ok"), onIncident: sink });
    const { ctx, settled } = makeCtx();
    const res = await worker.fetch!(req(), {}, ctx);
    await settled();
    expect(await res.text()).toBe("ok");
    expect(sink).not.toHaveBeenCalled();
  });

  it("reports a degrade from the request that saw it", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async () => {
        reportDegraded("commerce.products", new TypeError("fetch failed"), { source: "seed" });
        return new Response("seed content");
      },
      onIncident: sink,
    });
    const { ctx, settled } = makeCtx();
    const res = await worker.fetch!(req(), {}, ctx);
    await settled();

    expect(await res.text()).toBe("seed content");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      kind: "degraded",
      name: "commerce.products",
      message: "TypeError: fetch failed",
    });
  });

  it("reports the throw and the degrades before it, once each", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async () => {
        reportDegraded("content.read", "stale");
        throw new Error("render failed");
      },
      onIncident: sink,
    });
    const { ctx, settled } = makeCtx();
    await expect(worker.fetch!(req(), {}, ctx)).rejects.toThrow("render failed");
    await settled();
    expect(reports.map((r) => r.kind)).toEqual(["fetch", "degraded"]);

    // The buffer is empty after a flush.
    const next = makeCtx();
    await expect(worker.fetch!(req(), {}, next.ctx)).rejects.toThrow("render failed");
    await next.settled();
    expect(reports).toHaveLength(4);
  });

  it("gives 100 identical throws one fingerprint", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async (request) => {
        throw new Error(`row ${new URL(request.url).searchParams.get("id")} not found`);
      },
      onIncident: sink,
    });
    for (let id = 0; id < 100; id++) {
      const { ctx, settled } = makeCtx();
      await expect(
        worker.fetch!(req(`https://site.example/p?id=${id}`), {}, ctx),
      ).rejects.toThrow();
      await settled();
    }
    expect(reports).toHaveLength(100);
    expect(new Set(reports.map((r) => r.fingerprint)).size).toBe(1);
  });

  it("marks a report critical by name or by path prefix", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async (request) => {
        if (new URL(request.url).pathname === "/about")
          reportDegraded("commerce.checkout.session", "down");
        throw new Error("x");
      },
      onIncident: { sinks: sink, critical: ["commerce.checkout", "/cart"] },
    });
    for (const url of ["https://site.example/cart/items", "https://site.example/about"]) {
      const { ctx, settled } = makeCtx();
      await expect(worker.fetch!(req(url), {}, ctx)).rejects.toThrow();
      await settled();
    }
    expect(reports.map((r) => [r.kind, r.path ?? null, r.critical])).toEqual([
      ["fetch", "/cart/items", true],
      ["fetch", "/about", false],
      ["degraded", null, true],
    ]);
  });

  it("reads the release from the Worker's bindings", async () => {
    const { reports, sink } = recorder();
    type Env = { VERSION?: { id: string } };
    const worker = composeWorker<Env>({
      fetch: async () => {
        throw new Error("x");
      },
      onIncident: { sinks: sink, release: (env) => env.VERSION?.id },
    });
    const { ctx, settled } = makeCtx();
    await expect(worker.fetch!(req(), { VERSION: { id: "v-123" } }, ctx)).rejects.toThrow();
    await settled();
    expect(reports[0]?.release).toBe("v-123");
  });

  it("reports without a release when reading it throws", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async () => {
        throw new Error("x");
      },
      onIncident: {
        sinks: sink,
        release: () => {
          throw new Error("no binding");
        },
      },
    });
    const { ctx, settled } = makeCtx();
    await expect(worker.fetch!(req(), {}, ctx)).rejects.toThrow("x");
    await settled();
    expect(reports).toHaveLength(1);
    expect(reports[0]).not.toHaveProperty("release");
  });

  it("logs a failing sink and still runs the others", async () => {
    const { reports, sink } = recorder();
    const throwing = () => {
      throw new Error("sink down");
    };
    const rejecting = async () => {
      throw new Error("sink rejected");
    };
    const worker = composeWorker({
      fetch: async () => new Response("ok"),
      routes: [
        async () => {
          reportDegraded("forms.notify.webhook", "timeout");
          return undefined;
        },
      ],
      onIncident: [throwing, rejecting, sink],
    });
    const { ctx, settled } = makeCtx();
    const res = await worker.fetch!(req(), {}, ctx);
    await settled();

    expect(await res.text()).toBe("ok");
    expect(reports).toHaveLength(1);
    const sinkLines = error.mock.calls.filter(([line]) =>
      String(line).startsWith("[louise] incident sink failed"),
    );
    expect(sinkLines).toHaveLength(2);
    // A failing sink logs; it doesn't degrade, or the next flush would fail the
    // same way. The one degrade line is the route's own.
    expect(
      error.mock.calls.filter(([line]) => String(line).startsWith("[louise] degraded")),
    ).toHaveLength(1);
  });

  it("keeps at most 100 degrades between flushes, and says how many it dropped", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async () => {
        for (let i = 0; i < 105; i++) reportDegraded("content.read", `miss ${i}`);
        return new Response("ok");
      },
      onIncident: sink,
    });
    const { ctx, settled } = makeCtx();
    await worker.fetch!(req(), {}, ctx);
    await settled();
    expect(reports).toHaveLength(100);
    expect(error.mock.calls.some(([line]) => String(line).includes("dropped 5 degrades"))).toBe(
      true,
    );
  });
});

// --- queue and scheduled ---------------------------------------------------

describe("capture on queue and scheduled", () => {
  it("reports a queue handler's throw with the queue's name, then re-throws", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async () => new Response(),
      queue: async () => {
        throw new Error("consumer failed");
      },
      onIncident: sink,
    });
    const { ctx, settled } = makeCtx();
    await expect(worker.queue!(batch("commerce-events"), {}, ctx)).rejects.toThrow(
      "consumer failed",
    );
    await settled();
    expect(reports[0]).toMatchObject({ kind: "queue", path: "commerce-events" });
  });

  it("reports a cron's throw with its expression, then re-throws", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async () => new Response(),
      scheduled: async () => {
        throw new Error("scan failed");
      },
      onIncident: sink,
    });
    const { ctx, settled } = makeCtx();
    await expect(worker.scheduled!(controller("0 4 * * *"), {}, ctx)).rejects.toThrow(
      "scan failed",
    );
    await settled();
    expect(reports[0]).toMatchObject({ kind: "scheduled", path: "0 4 * * *" });
  });

  it("flushes a cron's degrades when it succeeds", async () => {
    const { reports, sink } = recorder();
    const worker = composeWorker({
      fetch: async () => new Response(),
      scheduled: async () => {
        reportDegraded("health.summary", "kv write failed");
      },
      onIncident: sink,
    });
    const { ctx, settled } = makeCtx();
    await worker.scheduled!(controller("*/5 * * * *"), {}, ctx);
    await settled();
    expect(reports.map((r) => r.name)).toEqual(["health.summary"]);
  });

  it("leaves a handler the Worker doesn't have absent", () => {
    const worker = composeWorker({ fetch: async () => new Response(), onIncident: () => {} });
    expect(worker.queue).toBeUndefined();
    expect(worker.scheduled).toBeUndefined();
  });
});

describe("withIncidentCapture", () => {
  it("wraps a handler composed by hand", async () => {
    const { reports, sink } = recorder();
    const handler = withIncidentCapture<unknown, unknown>(
      {
        async fetch() {
          throw new Error("hand-rolled");
        },
      },
      { sinks: [sink] },
    );
    const { ctx, settled } = makeCtx();
    await expect(handler.fetch!(req(), {}, ctx)).rejects.toThrow("hand-rolled");
    await settled();
    expect(reports.map((r) => r.message)).toEqual(["hand-rolled"]);
  });
});

describe("isCriticalIncident", () => {
  const list = ["commerce.checkout", "/cart", "/admin/"];
  it.each([
    [{ name: "commerce.checkout" }, true],
    [{ name: "commerce.checkout.session" }, true],
    [{ name: "commerce.checkoutx" }, false],
    [{ name: "Error", path: "/cart" }, true],
    [{ name: "Error", path: "/cart/items" }, true],
    [{ name: "Error", path: "/cartoon" }, false],
    [{ name: "Error", path: "/admin/users" }, true],
    [{ name: "Error" }, false],
  ])("%o is %s", (report, expected) => {
    expect(isCriticalIncident(report, list)).toBe(expected);
  });

  it("ignores an empty entry", () => {
    expect(isCriticalIncident({ name: "Error", path: "/" }, [""])).toBe(false);
  });
});
