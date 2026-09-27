import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { onIncidentEmitted } from "../../src/core/incidents/channel.js";
import {
  d1Incidents,
  deadLetterConsumer,
  type IncidentInput,
  listDeadLetters,
  listIncidents,
  replayDeadLetter,
} from "../../src/core/incidents/index.js";
import { processBatch } from "../../src/core/queues/index.js";
import { composeWorker } from "../../src/core/worker/index.js";

// Both tables as drizzle-kit generates them from their columns.
const DDL = `CREATE TABLE dead_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  queue TEXT NOT NULL,
  message_id TEXT NOT NULL,
  body TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX dead_letters_queue ON dead_letters (queue);
CREATE TABLE incidents (
  fingerprint TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  message TEXT NOT NULL,
  path TEXT,
  host TEXT,
  release TEXT,
  critical INTEGER DEFAULT false NOT NULL,
  count INTEGER DEFAULT 1 NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  resolved_at INTEGER,
  reopened_at INTEGER
);`;

/** A D1 double over in-memory SQLite: drizzle reads a select through `raw()`
 *  and everything else through `all()` or `run()`. `fail` makes every write
 *  throw, for the path where a dead letter can't be kept. */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(DDL);
  const state = { fail: false };
  const guard = (sql: string) => {
    if (state.fail && /^\s*(insert|update|delete)/i.test(sql)) throw new Error("D1 unavailable");
  };
  const statement = (sql: string, binds: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    all: async () => {
      guard(sql);
      return { results: sqlite.prepare(sql).all(...binds), success: true, meta: {} };
    },
    raw: async () => {
      guard(sql);
      const prepared = sqlite.prepare(sql);
      prepared.setReturnArrays(true);
      return prepared.all(...binds);
    },
    first: async () => sqlite.prepare(sql).get(...binds) ?? null,
    run: async () => {
      guard(sql);
      return {
        success: true,
        meta: { changes: Number(sqlite.prepare(sql).run(...binds).changes) },
      };
    },
  });
  return { state, db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database };
}

function fakeMessage<T>(body: T, attempts = 1, id = "msg") {
  return { body, attempts, id, timestamp: new Date(), ack: vi.fn(), retry: vi.fn() };
}

function fakeBatch<T>(messages: ReturnType<typeof fakeMessage<T>>[], queue: string) {
  return { queue, messages } as unknown as MessageBatch<T>;
}

function makeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
    settled: () => Promise.all(pending),
  };
}

type Env = { DB: D1Database };

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  error.mockRestore();
});

describe("deadLetterConsumer", () => {
  it("keeps each message, reports it, and acks it", async () => {
    const { db } = sqliteD1();
    const consume = deadLetterConsumer((env: Env) => env.DB);
    const a = fakeMessage({ kind: "reindex", id: 7 }, 1, "m-a");
    const b = fakeMessage({ kind: "reindex", id: 8 }, 2, "m-b");
    const inputs: IncidentInput[] = [];
    const stop = onIncidentEmitted((input) => inputs.push(input));
    await consume(fakeBatch([a, b], "side-effects-dlq"), { DB: db }, makeCtx().ctx);
    stop();

    expect(a.ack).toHaveBeenCalledOnce();
    expect(b.ack).toHaveBeenCalledOnce();
    const rows = await listDeadLetters(db);
    expect(rows.map((r) => [r.messageId, JSON.parse(r.body), r.attempts, r.queue])).toEqual([
      ["m-b", { kind: "reindex", id: 8 }, 2, "side-effects-dlq"],
      ["m-a", { kind: "reindex", id: 7 }, 1, "side-effects-dlq"],
    ]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      kind: "queue",
      name: "DeadLetter",
      path: "side-effects-dlq",
    });
  });

  it("retries a message it can't keep, and reports nothing for it", async () => {
    const { db, state } = sqliteD1();
    state.fail = true;
    const m = fakeMessage("x");
    const inputs: IncidentInput[] = [];
    const stop = onIncidentEmitted((input) => inputs.push(input));
    await deadLetterConsumer((env: Env) => env.DB)(
      fakeBatch([m], "dlq"),
      { DB: db },
      makeCtx().ctx,
    );
    stop();
    expect(m.retry).toHaveBeenCalledOnce();
    expect(m.ack).not.toHaveBeenCalled();
    expect(inputs).toEqual([]);
    expect(String(error.mock.calls[0]![0])).toContain("couldn't keep dead letter");
  });

  it("keeps a body JSON can't hold as its string form", async () => {
    const { db } = sqliteD1();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const consume = deadLetterConsumer((env: Env) => env.DB);
    await consume(
      fakeBatch([fakeMessage<unknown>(cyclic), fakeMessage<unknown>(10n)], "dlq"),
      { DB: db },
      makeCtx().ctx,
    );
    const bodies = (await listDeadLetters(db)).map((r) => JSON.parse(r.body));
    expect(bodies).toEqual(["10", "[object Object]"]);
  });
});

describe("listDeadLetters and replayDeadLetter", () => {
  it("filters by queue and limits", async () => {
    const { db } = sqliteD1();
    const consume = deadLetterConsumer((env: Env) => env.DB);
    await consume(fakeBatch([fakeMessage(1), fakeMessage(2)], "a-dlq"), { DB: db }, makeCtx().ctx);
    await consume(fakeBatch([fakeMessage(3)], "b-dlq"), { DB: db }, makeCtx().ctx);
    expect(await listDeadLetters(db, { queue: "a-dlq" })).toHaveLength(2);
    expect(await listDeadLetters(db, { limit: 1 })).toHaveLength(1);
  });

  it("sends a kept message back and deletes it", async () => {
    const { db } = sqliteD1();
    await deadLetterConsumer((env: Env) => env.DB)(
      fakeBatch([fakeMessage({ kind: "reindex", id: 7 })], "dlq"),
      { DB: db },
      makeCtx().ctx,
    );
    const [row] = await listDeadLetters(db);
    const queue = { send: vi.fn().mockResolvedValue(undefined) };
    expect(await replayDeadLetter(db, row!.id, queue as unknown as Queue)).toBe(true);
    expect(queue.send).toHaveBeenCalledWith({ kind: "reindex", id: 7 });
    expect(await listDeadLetters(db)).toEqual([]);
    expect(await replayDeadLetter(db, row!.id, queue as unknown as Queue)).toBe(false);
  });

  it("keeps the row when the send fails", async () => {
    const { db } = sqliteD1();
    await deadLetterConsumer((env: Env) => env.DB)(
      fakeBatch([fakeMessage("x")], "dlq"),
      { DB: db },
      makeCtx().ctx,
    );
    const [row] = await listDeadLetters(db);
    const queue = { send: vi.fn().mockRejectedValue(new Error("queue down")) };
    await expect(replayDeadLetter(db, row!.id, queue as unknown as Queue)).rejects.toThrow(
      "queue down",
    );
    expect(await listDeadLetters(db)).toHaveLength(1);
  });
});

describe("queue incidents through composeWorker", () => {
  it("counts a last-attempt failure and each dead letter in the site's D1", async () => {
    const { db } = sqliteD1();
    const keep = deadLetterConsumer((env: Env) => env.DB);
    const worker = composeWorker<Env, unknown>({
      fetch: async () => new Response(),
      queue: (batch, env, ctx) =>
        batch.queue === "jobs-dlq"
          ? keep(batch, env, ctx)
          : processBatch(batch, async () => {
              throw new Error("upstream down");
            }),
      onIncident: [d1Incidents((env: Env) => env.DB)],
    });
    const env = { DB: db };

    // Two deliveries that aren't the last: logged, not counted.
    for (const attempts of [1, 2]) {
      const { ctx, settled } = makeCtx();
      await worker.queue!(fakeBatch([fakeMessage("job", attempts)], "jobs"), env, ctx);
      await settled();
    }
    expect(await listIncidents(db)).toEqual([]);

    // The last delivery fails, and the message dead-letters.
    for (const [queue, attempts] of [
      ["jobs", 4],
      ["jobs-dlq", 1],
    ] as const) {
      const { ctx, settled } = makeCtx();
      await worker.queue!(fakeBatch([fakeMessage("job", attempts)], queue), env, ctx);
      await settled();
    }
    const rows = await listIncidents(db);
    expect(
      rows
        .map((r) => [r.kind, r.name, r.path, r.count])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ).toEqual([
      ["queue", "DeadLetter", "jobs-dlq", 1],
      ["queue", "Error", "jobs", 1],
    ]);
    expect(await listDeadLetters(db)).toHaveLength(1);
  });
});
