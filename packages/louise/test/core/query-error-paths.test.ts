import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { runMigration } from "../../src/core/content/migrate.js";
import { runStatusChecks } from "../../src/core/editor/status.js";
import {
  LouiseContentError,
  LouiseDbError,
  loggableError,
  onDegraded,
  reportDegraded,
} from "../../src/core/errors.js";
import { deadLetterConsumer } from "../../src/core/incidents/dead-letters.js";
import {
  buildIncidentReport,
  incidentFromDegraded,
  type IncidentReport,
  redactMessage,
} from "../../src/core/incidents/report.js";
import { processBatch } from "../../src/core/queues/index.js";
import { composeWorker, describeFailure, reportIncident } from "../../src/core/worker/index.js";

// Every way the kit lets an error, or its text, leave the Worker, each checked
// against a failed query whose bound values are personal data and whose
// driver error quotes one of them. A value that shows up anywhere fails.

/** Bound values, and what the driver's own errors quote. */
const PII = [
  "Avery Example",
  "avery@example.com",
  "1 Example Lane",
  "Leave it with the neighbor",
  "CUST-7Q2X",
];

const SQL =
  'insert into "inquiries" ("name", "email", "address", "note", "customer_id") values (?, ?, ?, ?, ?)';

/** A failed insert whose driver error quotes a bound value, as D1's type error
 *  does, and carries more of them in its own fields and its own cause. */
function failedQuery(): DrizzleQueryError {
  const driver = Object.assign(
    new Error("D1_TYPE_ERROR: Type 'object' not supported for value 'Avery Example'", {
      cause: new Error("bind failed for 'Leave it with the neighbor'"),
    }),
    { code: "D1_TYPE_ERROR", detail: "value 'CUST-7Q2X' at 1 Example Lane", index: 0 },
  );
  return new DrizzleQueryError(SQL, [...PII], driver);
}

/** The shapes a failed query reaches reporting in. */
const shapes: [string, () => unknown][] = [
  ["a query error", failedQuery],
  [
    "a LouiseError that wraps one",
    () => new LouiseContentError('Write failed for collection "inquiries"', failedQuery()),
  ],
  [
    "an AggregateError that holds one",
    () => new AggregateError([new Error("row 4 not found"), failedQuery()], "batch failed"),
  ],
  [
    "an error that holds one in an own field",
    () => Object.assign(new Error("checkout failed"), { originalError: failedQuery() }),
  ],
  [
    "a LouiseDbError around a wrapper around one",
    () =>
      new LouiseDbError(
        "Write failed",
        new Error(`Save failed: ${failedQuery().message}`, { cause: failedQuery() }),
      ),
  ],
];

/** Every way the value could be printed or sent: the inspector a runtime's
 *  console uses (non-enumerable fields, `cause` and `errors` included),
 *  `String`, `JSON.stringify`, and each error's message and stack. */
function everything(value: unknown): string {
  const parts = [inspect(value, { depth: Infinity, showHidden: true })];
  try {
    parts.push(String(value));
  } catch {
    // Not every value has a string form.
  }
  try {
    parts.push(JSON.stringify(value) ?? "");
  } catch {
    // Not every value has a JSON form.
  }
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (typeof node !== "object" || node === null || seen.has(node)) return;
    seen.add(node);
    if (node instanceof Error) parts.push(node.message, node.stack ?? "");
    for (const key of Reflect.ownKeys(node)) {
      walk((node as Record<PropertyKey, unknown>)[key]);
    }
  };
  walk(value);
  return parts.join("\n");
}

function expectClean(value: unknown): void {
  const text = everything(value);
  for (const pii of PII) expect(text).not.toContain(pii);
  expect(text).not.toContain("params:");
}

let error: MockInstance<typeof console.error>;
let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  error.mockRestore();
  warn.mockRestore();
});

/** Everything the kit wrote to the console in this test. */
const consoleOutput = () => [...error.mock.calls, ...warn.mock.calls];

type Env = Record<string, never>;
type IncomingRequest = Parameters<NonNullable<ExportedHandler["fetch"]>>[0];

/** A Worker with a sink that keeps what an error tracker would send. */
function worker(handlers: ExportedHandler<Env>) {
  const sent: { report: IncidentReport; cause: unknown }[] = [];
  const composed = composeWorker<Env>({
    fetch: handlers.fetch ?? (async () => new Response("ok")),
    ...(handlers.queue ? { queue: handlers.queue } : {}),
    ...(handlers.scheduled ? { scheduled: handlers.scheduled } : {}),
    onIncident: (report, context) => {
      sent.push({ report, cause: context.cause });
    },
  });
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return { composed, sent, ctx, settled: () => Promise.all(pending) };
}

const request = () => new Request("https://site.example/contact") as unknown as IncomingRequest;

describe.each(shapes)("a failed query as %s", (_label, make) => {
  it("prints, serializes, and walks clean once loggableError copies it", () => {
    expectClean(loggableError(make()));
  });

  it("stays out of reportDegraded's log line and its onDegraded event", () => {
    const events: unknown[] = [];
    const off = onDegraded((event) => events.push(event));
    try {
      reportDegraded("forms.inquiry", make(), { form: "contact" });
    } finally {
      off();
    }
    expectClean(consoleOutput());
    expect(events).toHaveLength(1);
    expectClean(events);
  });

  it("stays out of the re-thrown value, the sink's report and cause, and the log, from fetch", async () => {
    const { composed, sent, ctx, settled } = worker({
      fetch: async () => {
        throw make();
      },
    });
    const thrown = await Promise.resolve(composed.fetch!(request(), {}, ctx)).then(
      () => undefined,
      (err: unknown) => err,
    );
    await settled();
    expect(thrown).toBeDefined();
    expectClean(thrown);
    expect(sent).toHaveLength(1);
    expectClean(sent);
    expectClean(consoleOutput());
  });

  it("stays out of the re-thrown value and the sink from queue and scheduled", async () => {
    const { composed, sent, ctx, settled } = worker({
      queue: async () => {
        throw make();
      },
      scheduled: async () => {
        throw make();
      },
    });
    const batch = { queue: "jobs", messages: [] } as unknown as MessageBatch;
    const thrownQueue = await Promise.resolve(composed.queue!(batch, {}, ctx)).then(
      () => undefined,
      (err: unknown) => err,
    );
    const controller = { cron: "0 * * * *" } as ScheduledController;
    const thrownScheduled = await Promise.resolve(composed.scheduled!(controller, {}, ctx)).then(
      () => undefined,
      (err: unknown) => err,
    );
    await settled();
    expectClean([thrownQueue, thrownScheduled]);
    expect(sent).toHaveLength(2);
    expectClean(sent);
  });

  it("stays out of a degrade and a reportIncident call, through capture's buffer", async () => {
    const { composed, sent, ctx, settled } = worker({
      fetch: async () => {
        reportDegraded("forms.inquiry", make());
        reportIncident({ kind: "fetch", cause: make(), request: request() as unknown as Request });
        return new Response("ok");
      },
    });
    await composed.fetch!(request(), {}, ctx);
    await settled();
    expect(sent).toHaveLength(2);
    expectClean(sent);
    expectClean(consoleOutput());
  });

  it("stays out of the log when a sink throws it", async () => {
    const composed = composeWorker<Env>({
      fetch: async () => {
        throw new Error("boom");
      },
      onIncident: () => {
        throw make();
      },
    });
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext;
    await expect(composed.fetch!(request(), {}, ctx)).rejects.toThrow("boom");
    await Promise.all(pending);
    expect(error).toHaveBeenCalled();
    expectClean(consoleOutput());
  });

  it("stays out of processBatch's log and its last-attempt incident", async () => {
    const { composed, sent, ctx, settled } = worker({
      queue: async (batch) => {
        await processBatch(batch, async () => {
          throw make();
        });
      },
    });
    const message = {
      body: { name: "Avery Example" },
      attempts: 99,
      id: "msg-1",
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = { queue: "jobs", messages: [message] } as unknown as MessageBatch;
    await composed.queue!(batch, {}, ctx);
    await settled();
    expect(error).toHaveBeenCalled();
    expectClean(consoleOutput());
    expect(sent).toHaveLength(1);
    expectClean(sent);
  });

  it("stays out of a status check's log", async () => {
    await runStatusChecks(
      {},
      {
        db: () => {
          throw make();
        },
      },
    );
    expect(error).toHaveBeenCalled();
    expectClean(consoleOutput());
  });

  it("stays out of a migration's errors", async () => {
    const api = {
      find: async () => [{ id: 1, title: "Hello" }],
      update: async () => {
        throw make();
      },
    };
    const result = await runMigration(
      { name: "retitle", document: (doc) => ({ ...doc, title: "Hi" }) },
      { api: api as never, context: {} },
    );
    expect(result.errors).toHaveLength(1);
    expectClean(result.errors);
  });

  it("stays out of every field of an incident report", () => {
    const cause = make();
    expectClean(buildIncidentReport({ kind: "fetch", cause, request: request() as never }));
    expectClean(
      incidentFromDegraded({
        name: "forms.inquiry",
        message: "",
        cause,
        details: undefined,
      }),
    );
    expectClean(redactMessage(everything(cause).split("\n")[0]!));
  });
});

describe("a failed write the dead-letter consumer couldn't keep", () => {
  it("stays out of its log, though drizzle-orm binds the message body", async () => {
    // A D1 binding that rejects every statement the way D1's type check does.
    const rejecting = () => {
      const fail = async () => {
        throw new Error("D1_TYPE_ERROR: Type 'object' not supported for value 'Avery Example'");
      };
      const statement = { all: fail, run: fail, raw: fail, first: fail };
      return { ...statement, bind: () => statement };
    };
    const d1 = { prepare: rejecting } as unknown as D1Database;
    const message = {
      body: { name: "Avery Example", note: "Leave it with the neighbor" },
      attempts: 5,
      id: "msg-1",
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const consume = deadLetterConsumer(() => d1);
    await consume(
      { queue: "jobs-dlq", messages: [message] } as unknown as MessageBatch,
      {},
      {} as ExecutionContext,
    );
    expect(message.retry).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    expectClean(consoleOutput());
  });
});

describe("a healed failure's report", () => {
  it("carries no value from a failed query under the error", () => {
    const report = describeFailure({
      request: request() as unknown as Request,
      env: {},
      ctx: {} as ExecutionContext,
      error: new LouiseDbError(`Read failed: ${failedQuery().message}`, failedQuery()),
      code: "DB_ERROR",
      attempts: 2,
    });
    expectClean(report);
  });
});

describe("the kit's own console calls", () => {
  // A console call that passes an error as it was would log its message, its
  // stack, and its cause chain. Every server-side call goes through
  // loggableError, or passes text the kit wrote itself.
  const root = new URL("../../src/core/", import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
    });

  /** The text of each argument after the first, for every console call. */
  function consoleArguments(source: string): string[] {
    const found: string[] = [];
    const call = /console\.(?:error|warn|log|info|debug)\(/g;
    for (let match = call.exec(source); match; match = call.exec(source)) {
      let depth = 1;
      let i = match.index + match[0].length;
      const start = i;
      let quote: string | null = null;
      for (; i < source.length && depth > 0; i++) {
        const ch = source[i]!;
        if (quote) {
          if (ch === "\\") i++;
          else if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") quote = ch;
        else if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      found.push(source.slice(start, i - 1).trim());
    }
    return found;
  }

  // The one call that logs a value it was handed: a sent email's log line, in
  // development, which is text the kit built.
  const allowed = new Set(["email/index.ts"]);

  it("never log a caught value as it was", () => {
    const offenders: string[] = [];
    for (const file of files(root)) {
      const path = relative(root, file);
      if (allowed.has(path)) continue;
      for (const args of consoleArguments(readFileSync(file, "utf8"))) {
        // A bare name among the arguments is a value logged as it was.
        if (/(?:^|,)\s*[A-Za-z_$][\w$]*\s*,?\s*$/.test(args) && !/loggableError\(/.test(args)) {
          offenders.push(`${path}: console(${args.replace(/\s+/g, " ").slice(0, 80)})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
