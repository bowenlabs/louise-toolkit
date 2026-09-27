import { describe, expect, it } from "vitest";
import { LouiseDbError, type DegradedEvent } from "../../src/core/errors.js";
import {
  buildIncidentReport,
  fingerprintFailure,
  incidentFromDegraded,
  MAX_INCIDENT_MESSAGE,
  redactMessage,
} from "../../src/core/incidents/index.js";
import { UpstreamError } from "../../src/core/security/upstream.js";

const NOW = 1_700_000_000_000;

describe("fingerprintFailure", () => {
  const base = { kind: "fetch", name: "LouiseDbError", code: "DB_ERROR" } as const;

  it("is 16 hex characters, and the same for the same failure", () => {
    const one = fingerprintFailure({ ...base, message: "row not found" });
    expect(one).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintFailure({ ...base, message: "row not found" })).toBe(one);
  });

  it("ignores the variable parts of a message", () => {
    const pairs = [
      ["row 41 not found", "row 97 not found"],
      [
        "page 0f8fad5b-d9cb-469f-a165-70867728950e missing",
        "page 7c9e6679-7425-40de-944b-e07fc1f90ae7 missing",
      ],
      ['no collection "pages"', 'no collection "posts"'],
      ["unknown key 'title'", "unknown key 'slug'"],
      ["blob deadbeefcafe missing", "blob 0123456789ab missing"],
      ["no user alex@example.com", "no user kai@example.org"],
    ];
    for (const [a, b] of pairs) {
      expect(fingerprintFailure({ ...base, message: a! })).toBe(
        fingerprintFailure({ ...base, message: b! }),
      );
    }
  });

  it("keeps an apostrophe from swallowing the rest of the message", () => {
    const a = fingerprintFailure({ ...base, message: "can't reach the database" });
    const b = fingerprintFailure({ ...base, message: "can't reach the bucket" });
    expect(a).not.toBe(b);
  });

  it("tells failures apart by kind, name, code, and message", () => {
    const one = fingerprintFailure({ ...base, message: "timeout" });
    expect(fingerprintFailure({ ...base, kind: "queue", message: "timeout" })).not.toBe(one);
    expect(fingerprintFailure({ ...base, name: "TypeError", message: "timeout" })).not.toBe(one);
    expect(fingerprintFailure({ ...base, code: "CACHE_ERROR", message: "timeout" })).not.toBe(one);
    expect(fingerprintFailure({ ...base, message: "reset" })).not.toBe(one);
  });

  it("gives the same answer for a raw message and its stored form", () => {
    const raw = `send to alex@example.com failed\n  token ${"a1".repeat(20)}`;
    const report = buildIncidentReport({ kind: "fetch", cause: new Error(raw), now: NOW });
    expect(fingerprintFailure({ kind: "fetch", name: "Error", message: raw })).toBe(
      report.fingerprint,
    );
    expect(fingerprintFailure(report)).toBe(report.fingerprint);
  });
});

describe("redactMessage", () => {
  it("replaces email addresses", () => {
    expect(redactMessage("no account for quinn@example.com (retry)")).toBe(
      "no account for [email] (retry)",
    );
  });

  it("replaces long runs of token characters that include a digit", () => {
    expect(redactMessage(`bad token tok_${"a1b2".repeat(7)}`)).toBe("bad token [redacted]");
    expect(redactMessage("/unsubscribe/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA")).toBe(
      "/unsubscribe/[redacted]",
    );
  });

  it("leaves paths, long names, and short IDs alone", () => {
    const kept = [
      "/api/louise/content/pages/about",
      "commerce-fourthwall-product-sync failed",
      "order 12345 not found",
    ];
    for (const text of kept) expect(redactMessage(text)).toBe(text);
  });
});

describe("buildIncidentReport", () => {
  it("reads the name, message, and code from a LouiseError", () => {
    const report = buildIncidentReport({
      kind: "fetch",
      cause: new LouiseDbError("connection reset"),
      now: NOW,
    });
    expect(report).toEqual({
      kind: "fetch",
      fingerprint: fingerprintFailure({
        kind: "fetch",
        name: "LouiseDbError",
        code: "DB_ERROR",
        message: "connection reset",
      }),
      name: "LouiseDbError",
      code: "DB_ERROR",
      message: "connection reset",
      critical: false,
      at: NOW,
    });
    // Survives a queue boundary.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("keeps the pathname and host, never the query string", () => {
    const request = new Request(
      "https://preview.example.workers.dev/cart?token=abc123&email=alex%40example.com",
    );
    const report = buildIncidentReport({
      kind: "fetch",
      cause: new TypeError("fetch failed"),
      request,
      now: NOW,
    });
    expect(report.path).toBe("/cart");
    expect(report.host).toBe("preview.example.workers.dev");
    expect(JSON.stringify(report)).not.toContain("token");
  });

  it("redacts a token in the path", () => {
    const request = new Request("https://example.com/unsubscribe/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA");
    expect(buildIncidentReport({ kind: "fetch", cause: new Error("x"), request }).path).toBe(
      "/unsubscribe/[redacted]",
    );
  });

  it("takes a path when there's no request, such as a queue's name", () => {
    const report = buildIncidentReport({
      kind: "queue",
      cause: new Error("x"),
      path: "commerce-events",
    });
    expect(report.path).toBe("commerce-events");
    expect(report).not.toHaveProperty("host");
  });

  it("carries the release and the critical flag", () => {
    const report = buildIncidentReport({
      kind: "scheduled",
      cause: new Error("x"),
      release: "v1.4.0",
      critical: true,
    });
    expect(report.release).toBe("v1.4.0");
    expect(report.critical).toBe(true);
  });

  it("reads an upstream failure's operation and what the provider said", () => {
    const cause = new UpstreamError("Fourthwall", 401, {
      operation: "GET /products",
      detail: "bad token",
    });
    const report = buildIncidentReport({ kind: "fetch", cause });
    expect(report.name).toBe("UpstreamError");
    expect(report.message).toBe("Fourthwall GET /products 401: bad token");
  });

  it("names a thrown value that isn't an Error", () => {
    const report = buildIncidentReport({ kind: "fetch", cause: "boom" });
    expect(report.name).toBe("Error");
    expect(report.message).toBe("boom");
  });

  it("flattens, redacts, and clips the message", () => {
    const long = `line one\n  line two for alex@example.com ${"x".repeat(1000)}`;
    const report = buildIncidentReport({ kind: "fetch", cause: new Error(long) });
    expect(report.message).not.toContain("\n");
    expect(report.message).toContain("[email]");
    expect(report.message).toHaveLength(MAX_INCIDENT_MESSAGE);
    expect(report.message.endsWith("…")).toBe(true);
  });

  it("never throws, whatever the cause holds", () => {
    const hostile = new Proxy(new Error("x"), {
      get() {
        throw new Error("trap");
      },
      getPrototypeOf() {
        throw new Error("trap");
      },
    });
    const report = buildIncidentReport({
      kind: "fetch",
      cause: hostile,
      request: { url: "not a url" } as Request,
    });
    expect(report.name).toBe("Error");
    expect(report).not.toHaveProperty("path");
  });

  it("defaults the time to now", () => {
    const before = Date.now();
    const { at } = buildIncidentReport({ kind: "fetch", cause: new Error("x") });
    expect(at).toBeGreaterThanOrEqual(before);
  });
});

describe("incidentFromDegraded", () => {
  it("names the report for the fallback that fired, with the cause's code", () => {
    const event: DegradedEvent = {
      name: "content.read",
      message: "LouiseDbError: connection reset",
      cause: new LouiseDbError("connection reset"),
      details: { collection: "pages" },
    };
    const report = incidentFromDegraded(event, { release: "v2", now: NOW });
    expect(report).toMatchObject({
      kind: "degraded",
      name: "content.read",
      code: "DB_ERROR",
      message: "LouiseDbError: connection reset",
      release: "v2",
      critical: false,
      at: NOW,
    });
    // Details stay in the log line; the report doesn't carry them.
    expect(report).not.toHaveProperty("details");
  });

  it("groups repeats of the same fallback into one fingerprint", () => {
    const event = (id: number): DegradedEvent => ({
      name: "commerce.products",
      message: `TypeError: product ${id} fetch failed`,
      cause: undefined,
      details: undefined,
    });
    expect(incidentFromDegraded(event(1)).fingerprint).toBe(
      incidentFromDegraded(event(2)).fingerprint,
    );
  });
});
