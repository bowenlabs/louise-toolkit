import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  DEGRADED_LOG_PREFIX,
  LouiseDbError,
  onDegraded,
  reportDegraded,
  type DegradedEvent,
} from "../../src/core/errors.js";
import { UpstreamError } from "../../src/core/security/upstream.js";

let error: MockInstance<typeof console.error>;

beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  error.mockRestore();
});

/** The one line reportDegraded logged. */
function logged(): string {
  expect(error).toHaveBeenCalledTimes(1);
  const args = error.mock.calls[0];
  expect(args).toHaveLength(1);
  return args[0] as string;
}

describe("reportDegraded", () => {
  it("logs one line: the marker, the name, the cause, and the details", () => {
    reportDegraded("content.read", new TypeError("fetch failed"), { collection: "pages" });
    expect(logged()).toBe(
      '[louise] degraded content.read: TypeError: fetch failed {"collection":"pages"}',
    );
  });

  it("starts every line with the exported prefix", () => {
    reportDegraded("x", new Error("y"));
    expect(logged().startsWith(`${DEGRADED_LOG_PREFIX} x: `)).toBe(true);
  });

  it("names a Louise error by its class", () => {
    reportDegraded("db.read", new LouiseDbError("D1 unavailable"));
    expect(logged()).toBe("[louise] degraded db.read: LouiseDbError: D1 unavailable");
  });

  it("logs an upstream failure's operation and what the provider said", () => {
    reportDegraded(
      "commerce.products",
      new UpstreamError("Fourthwall", 401, { operation: "GET /products", detail: "bad token" }),
    );
    expect(logged()).toBe(
      "[louise] degraded commerce.products: UpstreamError: Fourthwall GET /products 401: bad token",
    );
  });

  it("leaves the details off when there are none", () => {
    reportDegraded("a", new Error("b"), {});
    expect(logged()).toBe("[louise] degraded a: Error: b");
  });

  it("keeps a multi-line cause on one line", () => {
    reportDegraded("a", new Error("first\nsecond\r\n  third"));
    expect(logged()).toBe("[louise] degraded a: Error: first second third");
  });

  it("cuts a very long cause message", () => {
    reportDegraded("a", "x".repeat(2000));
    expect(logged().length).toBeLessThan(600);
    expect(logged().endsWith("…")).toBe(true);
  });

  it("returns undefined", () => {
    expect(reportDegraded("a", new Error("b"))).toBeUndefined();
  });

  describe("never throws, whatever it's handed", () => {
    const hostile: [string, unknown, string][] = [
      ["a string", "quota exceeded", "quota exceeded"],
      ["undefined", undefined, "no cause given"],
      ["null", null, "null"],
      ["a number", 42, "42"],
      ["a symbol", Symbol("s"), "Symbol(s)"],
      ["an object with no prototype", Object.create(null), "unprintable cause"],
      [
        "an object whose toString throws",
        {
          toString() {
            throw new Error("nope");
          },
        },
        "unprintable cause",
      ],
      [
        "an Error whose message getter throws",
        Object.defineProperty(new Error("hidden"), "message", {
          get() {
            throw new Error("getter");
          },
        }),
        "Error",
      ],
      [
        "a proxy that throws on every trap",
        new Proxy(
          {},
          {
            get() {
              throw new Error("get");
            },
            getPrototypeOf() {
              throw new Error("proto");
            },
          },
        ),
        "unprintable cause",
      ],
    ];

    for (const [label, cause, expected] of hostile) {
      it(`as the cause: ${label}`, () => {
        expect(() => reportDegraded("hostile", cause)).not.toThrow();
        expect(logged()).toBe(`[louise] degraded hostile: ${expected}`);
      });
    }

    it("as details: a circular object", () => {
      const details: Record<string, unknown> = {};
      details.self = details;
      expect(() => reportDegraded("a", new Error("b"), details)).not.toThrow();
      expect(logged()).toBe("[louise] degraded a: Error: b [details not serializable]");
    });

    it("as details: a BigInt, or a getter that throws", () => {
      const details = {
        n: 1n,
        get boom() {
          throw new Error("getter");
        },
      };
      expect(() => reportDegraded("a", new Error("b"), details)).not.toThrow();
      expect(logged()).toBe("[louise] degraded a: Error: b [details not serializable]");
    });

    it("as the name: something that isn't a string", () => {
      expect(() => reportDegraded(undefined as never, new Error("b"))).not.toThrow();
      expect(logged()).toBe("[louise] degraded undefined: Error: b");
    });

    it("when console.error itself throws", () => {
      error.mockImplementation(() => {
        throw new Error("console gone");
      });
      expect(() => reportDegraded("a", new Error("b"))).not.toThrow();
    });
  });
});

describe("onDegraded", () => {
  it("hands each listener the event, and stops once removed", () => {
    const events: DegradedEvent[] = [];
    const off = onDegraded((event) => events.push(event));
    const cause = new Error("b");
    reportDegraded("a", cause, { id: 7 });
    off();
    reportDegraded("c", cause);
    expect(events).toEqual([{ name: "a", message: "Error: b", cause, details: { id: 7 } }]);
    expect(events[0]!.cause).toBe(cause);
  });

  it("ignores a listener that throws, and still runs the rest", () => {
    const seen: string[] = [];
    const offBad = onDegraded(() => {
      throw new Error("listener broke");
    });
    const offGood = onDegraded((event) => seen.push(event.name));
    expect(() => reportDegraded("a", new Error("b"))).not.toThrow();
    offBad();
    offGood();
    expect(seen).toEqual(["a"]);
    expect(logged()).toBe("[louise] degraded a: Error: b");
  });
});
