import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { causeParts } from "../../src/core/degraded.js";
import { LouiseContentError, onDegraded, reportDegraded } from "../../src/core/errors.js";
import { buildIncidentReport, redactMessage } from "../../src/core/incidents/report.js";
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

  it("changes nothing the second time, or without the params marker", () => {
    const once = redactQueryText(failedInsert().message);
    expect(redactQueryText(once)).toBe(once);
    expect(redactQueryText("Failed query: insert into inquiries. Cause: D1_ERROR")).toBe(
      "Failed query: insert into inquiries. Cause: D1_ERROR",
    );
    expect(redactQueryText("row 4 not found")).toBe("row 4 not found");
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
    expect(copy.name).toBe("DrizzleQueryError");
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

  it("copies a chain that holds a query error further down", () => {
    const wrapper = new LouiseContentError(
      'Write failed for collection "inquiries"',
      failedInsert(),
    );
    const copy = loggableError(wrapper) as Error;
    expect(copy.name).toBe("LouiseContentError");
    expect(copy.message).toBe('Write failed for collection "inquiries"');
    const cause = copy.cause as Error;
    expect(cause.name).toBe("DrizzleQueryError");
    const all = [copy.stack, cause.stack, cause.message, (cause.cause as Error).message].join("\n");
    expectNoPii(all);
  });

  it("reduces a query quoted in another error's message", () => {
    const copy = loggableError(new Error(`Save failed: ${failedInsert().message}`)) as Error;
    expect(copy.message).toBe("Save failed: Failed query: insert into inquiries");
    expectNoPii(copy.stack!);
  });
});
