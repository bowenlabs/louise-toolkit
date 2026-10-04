import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { causeParts } from "../../src/core/degraded.js";
import {
  LouiseContentError,
  LouiseError,
  onDegraded,
  reportDegraded,
} from "../../src/core/errors.js";
import { buildIncidentReport, redactMessage } from "../../src/core/incidents/report.js";
import { UpstreamError } from "../../src/core/security/upstream.js";
import {
  isQueryError,
  loggableError,
  queryErrorParts,
  redactQueryText,
} from "../../src/core/query-error.js";

// drizzle-orm's DrizzleQueryError puts a query's bound values in its message.
// Every way a report leaves the Worker has to drop them.

/** Bound values a site writes: personal data that no log may keep. */
const PII = [
  "Avery Example",
  "avery@example.com",
  "1 Example Lane",
  "Leave it with the neighbor",
  "CUST-7Q2X",
];

const SQL =
  'insert into "inquiries" ("id", "name", "email", "address", "note", "customer_id") values (null, ?, ?, ?, ?, ?)';

/** A failed insert as drizzle-orm's D1 driver throws it. */
function failedInsert(): DrizzleQueryError {
  const driver = new Error(
    "D1_ERROR: UNIQUE constraint failed: inquiries.email: SQLITE_CONSTRAINT\n    at D1Database.run",
  );
  return new DrizzleQueryError(SQL, [...PII], driver);
}

function expectNoPii(text: string): void {
  for (const value of PII) expect(text).not.toContain(value);
  expect(text).not.toContain("params:");
}

describe("isQueryError", () => {
  it("recognizes drizzle-orm's error, whose name reads Error", () => {
    const error = failedInsert();
    expect(error.name).toBe("Error");
    expect(isQueryError(error)).toBe(true);
  });

  it("recognizes the message's shape on an error of another class", () => {
    expect(isQueryError(new Error("Failed query: select 1\nparams: "))).toBe(true);
  });

  it("leaves other errors and non-errors alone", () => {
    expect(isQueryError(new Error("row 4 not found"))).toBe(false);
    expect(isQueryError("Failed query: select 1")).toBe(false);
    expect(isQueryError(undefined)).toBe(false);
  });
});

describe("queryErrorParts", () => {
  it("keeps the statement, the table, and the driver's first line", () => {
    expect(queryErrorParts(failedInsert())).toEqual({
      name: "DrizzleQueryError",
      message:
        "Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email: SQLITE_CONSTRAINT",
    });
  });

  it("names each statement kind and its table", () => {
    const summary = (sql: string) =>
      queryErrorParts(new DrizzleQueryError(sql, ["Avery Example"])).message;
    expect(summary('update "orders" set "note" = ? where "id" = ?')).toBe(
      "Failed query: update orders",
    );
    expect(summary('delete from "sessions" where "token" = ?')).toBe(
      "Failed query: delete from sessions",
    );
    expect(summary('select "id" from "products" where "slug" = ?')).toBe(
      "Failed query: select from products",
    );
    expect(summary("with recent as (select 1) select * from recent")).toBe("Failed query: with");
    expect(summary("'Avery Example' is not SQL")).toBe("Failed query: query");
  });

  it("drops a table name that isn't name-shaped", () => {
    expect(
      queryErrorParts(new DrizzleQueryError('select * from "Avery Example"', [])).message,
    ).toBe("Failed query: select");
  });

  it("replaces the values a driver quotes in its error", () => {
    const typeError = new DrizzleQueryError(
      SQL,
      [...PII],
      new Error("D1_TYPE_ERROR: Type 'object' not supported for value 'Avery Example'"),
    );
    expect(queryErrorParts(typeError).message).toBe(
      "Failed query: insert into inquiries. Cause: D1_TYPE_ERROR: Type <value>",
    );
    const cause = (text: string) =>
      queryErrorParts(new DrizzleQueryError(SQL, [], new Error(text))).message;
    expect(cause("D1_TYPE_ERROR: Type 'string' not supported for value 'O'Brien'")).not.toContain(
      "Brien",
    );
    expect(cause('SQLITE_ERROR: near "Avery Example": syntax error')).toBe(
      "Failed query: insert into inquiries. Cause: SQLITE_ERROR: near <value>",
    );
    // A value with a line break leaves an unclosed quote on the first line.
    expect(cause("D1_TYPE_ERROR: Type 'x' not supported for value 'Avery\nExample'")).toBe(
      "Failed query: insert into inquiries. Cause: D1_TYPE_ERROR: Type <value>",
    );
    expect(cause("D1_ERROR: can't open the table: SQLITE_CANTOPEN")).toBe(
      "Failed query: insert into inquiries. Cause: D1_ERROR: can't open the table: SQLITE_CANTOPEN",
    );
  });

  it("reduces a query error nested in the cause", () => {
    const inner = new DrizzleQueryError('select * from "people"', ["Avery Example"]);
    const outer = new DrizzleQueryError('insert into "log" values (?)', ["CUST-7Q2X"], inner);
    expect(queryErrorParts(outer).message).toBe(
      "Failed query: insert into log. Cause: Failed query: select from people",
    );
  });

  it("never throws, whatever the error holds", () => {
    const hostile = new DrizzleQueryError("select 1", []);
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("no");
      },
    });
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error("no");
      },
    });
    expect(queryErrorParts(hostile)).toEqual({
      name: "DrizzleQueryError",
      message: "Failed query: query",
    });
  });
});

describe("redactQueryText", () => {
  it("reduces a query error quoted in a longer message", () => {
    const text = `Save failed: ${failedInsert().message}`;
    expect(redactQueryText(text)).toBe("Save failed: Failed query: insert into inquiries");
  });

  it("reduces it after the message was flattened to one line", () => {
    const text = failedInsert().message.replace(/\n/g, " ");
    expect(redactQueryText(text)).toBe("Failed query: insert into inquiries");
  });

  it("reduces quoted SQL that lost its params marker", () => {
    expect(
      redactQueryText(
        "Save failed: Failed query: select * from users where name = 'Avery Example'",
      ),
    ).toBe("Save failed: Failed query: select from users");
    // The first line of drizzle-orm's message, as a log that keeps one line has it.
    expect(redactQueryText(failedInsert().message.split("\n")[0]!)).toBe(
      "Failed query: insert into inquiries",
    );
    expect(
      redactQueryText("Failed query: insert into t. Cause: D1_TYPE_ERROR: Type 'x' 'Avery'"),
    ).toBe("Failed query: insert into t. Cause: D1_TYPE_ERROR: Type <value>");
  });

  it("changes nothing the second time, or without the params marker", () => {
    const once = redactQueryText(failedInsert().message);
    expect(redactQueryText(once)).toBe(once);
    expect(redactQueryText("Failed query: insert into inquiries. Cause: D1_ERROR")).toBe(
      "Failed query: insert into inquiries. Cause: D1_ERROR",
    );
    expect(redactQueryText("row 4 not found")).toBe("row 4 not found");
    const nested = queryErrorParts(
      new DrizzleQueryError('insert into "log" values (?)', [], failedInsert()),
    ).message;
    expect(redactQueryText(nested)).toBe(nested);
    expect(redactMessage(redactMessage(nested))).toBe(redactMessage(nested));
  });
});

describe("redactMessage", () => {
  it("drops a query's bound values from a message", () => {
    const line = redactMessage(failedInsert().message);
    expect(line).toBe("Failed query: insert into inquiries");
    expectNoPii(line);
  });
});

describe("a query error in a report", () => {
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
  });

  it("keeps its values out of reportDegraded's log line and event", () => {
    const events: string[] = [];
    const off = onDegraded((event) => events.push(event.message));
    try {
      reportDegraded("forms.inquiry", failedInsert(), { form: "contact" });
    } finally {
      off();
    }
    const line = error.mock.calls[0]![0] as string;
    expect(line).toBe(
      '[louise] degraded forms.inquiry: DrizzleQueryError: Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email: SQLITE_CONSTRAINT {"form":"contact"}',
    );
    expectNoPii(line);
    expect(events).toHaveLength(1);
    expectNoPii(events[0]!);
  });

  it("keeps its values out of an incident report", () => {
    const report = buildIncidentReport({ kind: "fetch", cause: failedInsert() });
    expect(report.name).toBe("DrizzleQueryError");
    expect(report.message).toBe(
      "Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email: SQLITE_CONSTRAINT",
    );
    expectNoPii(JSON.stringify(report));
  });

  it("keeps a value the driver quoted out of the log line and the report", () => {
    const typeError = new DrizzleQueryError(
      SQL,
      [...PII],
      new Error("D1_TYPE_ERROR: Type 'object' not supported for value 'Avery Example'"),
    );
    reportDegraded("forms.inquiry", typeError);
    expectNoPii(error.mock.calls[0]![0] as string);
    expectNoPii(JSON.stringify(buildIncidentReport({ kind: "fetch", cause: typeError })));
  });

  it("reduces a failed query an upstream provider quoted", () => {
    const upstream = new UpstreamError("Example API", 500, {
      operation: "POST /orders",
      detail: failedInsert().message,
    });
    const parts = causeParts(upstream);
    expect(parts.message).toBe("Example API POST /orders 500: Failed query: insert into inquiries");
    expectNoPii(JSON.stringify(buildIncidentReport({ kind: "fetch", cause: upstream })));
  });

  it("keeps a quoted query's values out of a wrapping error's report", () => {
    const wrapped = new Error(`Save failed: ${failedInsert().message}`);
    expectNoPii(JSON.stringify(buildIncidentReport({ kind: "fetch", cause: wrapped })));
    expectNoPii(causeParts(`Save failed: ${failedInsert().message}`).message);
  });

  it("fingerprints repeats with different values as one incident", () => {
    const other = new DrizzleQueryError(SQL, ["Blair Example"], new Error("D1_ERROR: UNIQUE"));
    const first = new DrizzleQueryError(SQL, [...PII], new Error("D1_ERROR: UNIQUE"));
    expect(buildIncidentReport({ kind: "fetch", cause: other }).fingerprint).toBe(
      buildIncidentReport({ kind: "fetch", cause: first }).fingerprint,
    );
  });
});

describe("loggableError", () => {
  it("returns its own copy as it was", () => {
    const copy = loggableError(failedInsert());
    expect(loggableError(copy)).toBe(copy);
  });

  it("returns any other value as it was", () => {
    const plain = new TypeError("fetch failed");
    expect(loggableError(plain)).toBe(plain);
    expect(loggableError("text")).toBe("text");
    expect(loggableError(undefined)).toBeUndefined();
  });

  it("copies a query error with its frames and none of its values", () => {
    const original = failedInsert();
    const copy = loggableError(original) as Error;
    expect(copy).not.toBe(original);
    // The same class and name as the original, which drizzle-orm leaves as Error.
    expect(copy).toBeInstanceOf(DrizzleQueryError);
    expect(copy.name).toBe(original.name);
    expect(copy.message).toMatch(/^Failed query: insert into inquiries\. Cause: D1_ERROR/);
    expect(copy.stack).toMatch(/^DrizzleQueryError: Failed query: insert into inquiries/);
    expect(copy.stack).toMatch(/\n\s+at /);
    expectNoPii(copy.stack!);
    expect((copy.cause as Error).message).toMatch(/^D1_ERROR: UNIQUE constraint failed/);
  });

  it("keeps a value shaped like a frame out of the copy's stack", () => {
    const sneaky = new DrizzleQueryError(SQL, ["x\n    at Avery Example (1 Example Lane)"]);
    expectNoPii((loggableError(sneaky) as Error).stack!);
  });

  it("keeps no frames when it can't find a query error's message in its stack", () => {
    const changed = new DrizzleQueryError(SQL, ["x\n    at Avery Example (1 Example Lane)"]);
    // V8 formats a stack when it's first read, so read it before the change.
    expect(changed.stack).toContain("Avery Example");
    changed.message = "Failed query: insert into inquiries";
    const copy = loggableError(changed) as Error;
    expect(copy.stack).toBe("DrizzleQueryError: Failed query: insert into inquiries");

    const unreadable = new DrizzleQueryError(SQL, ["x\n    at Avery Example (1 Example Lane)"]);
    Object.defineProperty(unreadable, "message", {
      get() {
        throw new Error("no");
      },
    });
    expectNoPii((loggableError(unreadable) as Error).stack!);
  });

  it("drops a chain past its depth limit rather than keep it unchecked", () => {
    let chain: Error = failedInsert();
    for (let i = 0; i < 12; i++) chain = new Error(`step ${i}`, { cause: chain });
    const copy = loggableError(chain) as Error;
    expect(copy).not.toBe(chain);
    const texts: string[] = [];
    for (let link: unknown = copy; link instanceof Error; link = link.cause) {
      texts.push(link.message, link.stack ?? "");
    }
    expect(texts.length).toBeLessThan(26);
    expectNoPii(texts.join("\n"));
  });

  it("reduces a string that quotes a failed query, on its own or as a cause", () => {
    const text = failedInsert().message;
    expect(loggableError(text)).toBe("Failed query: insert into inquiries");
    const copy = loggableError(new Error("save failed", { cause: text })) as Error;
    expect(copy.message).toBe("save failed");
    expect(copy.cause).toBe("Failed query: insert into inquiries");
  });

  it("keeps each error's class and own fields, but never a query's SQL or values", () => {
    const wrapper = new LouiseContentError("Write failed", failedInsert());
    const violations = [{ path: "email" }];
    Object.assign(wrapper, { status: 409, violations });
    const copy = loggableError(wrapper) as LouiseContentError & {
      status?: number;
      violations?: unknown;
    };
    expect(copy).not.toBe(wrapper);
    expect(copy).toBeInstanceOf(LouiseContentError);
    expect(copy).toBeInstanceOf(LouiseError);
    expect(copy).toBeInstanceOf(Error);
    expect(copy.name).toBe("LouiseContentError");
    expect(copy.code).toBe("CONTENT_ERROR");
    expect(copy.status).toBe(409);
    expect(copy.violations).toBe(violations);
    expect(Object.keys(copy).sort()).toEqual(Object.keys(wrapper).sort());
    const cause = copy.cause as DrizzleQueryError;
    expect(cause).toBeInstanceOf(DrizzleQueryError);
    expect(Object.hasOwn(cause, "query")).toBe(false);
    expect(Object.hasOwn(cause, "params")).toBe(false);
  });

  it("reports a copied wrapper with the original's code and fingerprint", () => {
    const wrapper = new LouiseContentError(
      'Write failed for collection "inquiries"',
      failedInsert(),
    );
    const original = buildIncidentReport({ kind: "fetch", cause: wrapper, now: 1 });
    const copied = buildIncidentReport({ kind: "fetch", cause: loggableError(wrapper), now: 1 });
    expect(copied).toEqual(original);
    expect(copied.code).toBe("CONTENT_ERROR");
  });

  it("copies a chain that holds a query error further down", () => {
    const wrapper = new LouiseContentError(
      'Write failed for collection "inquiries"',
      failedInsert(),
    );
    const copy = loggableError(wrapper) as Error;
    expect(copy.name).toBe("LouiseContentError");
    expect(copy.message).toBe('Write failed for collection "inquiries"');
    const cause = copy.cause as Error;
    expect(cause).toBeInstanceOf(DrizzleQueryError);
    const all = [copy.stack, cause.stack, cause.message, (cause.cause as Error).message].join("\n");
    expectNoPii(all);
  });

  it("reduces a query quoted in another error's message", () => {
    const copy = loggableError(new Error(`Save failed: ${failedInsert().message}`)) as Error;
    expect(copy.message).toBe("Save failed: Failed query: insert into inquiries");
    expectNoPii(copy.stack!);
  });
});
