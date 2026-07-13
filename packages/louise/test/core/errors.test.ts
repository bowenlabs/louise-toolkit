import { describe, expect, it } from "vitest";
import {
  LouiseApiError,
  LouiseAccessDeniedError,
  LouiseContentError,
  LouiseEmailError,
  LouiseError,
  LouiseQueueError,
  LouiseValidationError,
} from "../../src/core/errors.js";

describe("LouiseError", () => {
  it("is an Error carrying a code and message", () => {
    const err = new LouiseError("boom", "TEST_ERROR");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(err.code).toBe("TEST_ERROR");
    expect(err.name).toBe("LouiseError");
  });

  it("preserves the underlying cause", () => {
    const cause = new Error("root");
    const err = new LouiseError("wrap", "TEST_ERROR", cause);
    expect(err.cause).toBe(cause);
  });
});

describe("typed subclasses", () => {
  it("set a fixed code + name and stay instanceof LouiseError", () => {
    const q = new LouiseQueueError("q down");
    expect(q).toBeInstanceOf(LouiseError);
    expect(q.name).toBe("LouiseQueueError");
    expect(q.code).toBe("QUEUE_ERROR");

    const e = new LouiseEmailError("no send");
    expect(e.code).toBe("EMAIL_ERROR");
  });

  it("LouiseAccessDeniedError is a LouiseContentError (so 403 mapping works by instanceof)", () => {
    const denied = new LouiseAccessDeniedError("nope");
    expect(denied).toBeInstanceOf(LouiseContentError);
    expect(denied).toBeInstanceOf(LouiseError);
    expect(denied.code).toBe("CONTENT_ERROR");
  });

  it("LouiseValidationError carries structured violations", () => {
    const v = new LouiseValidationError("bad", [
      { path: "slug", message: "is required", severity: "error" },
    ]);
    expect(v).toBeInstanceOf(LouiseContentError);
    expect(v.violations).toHaveLength(1);
    expect(v.violations[0]?.path).toBe("slug");
  });

  it("LouiseApiError carries the HTTP status and parsed body", () => {
    const a = new LouiseApiError("forbidden", 403, { error: "denied" });
    expect(a.status).toBe(403);
    expect(a.body).toEqual({ error: "denied" });
    expect(a.code).toBe("API_ERROR");
  });
});
