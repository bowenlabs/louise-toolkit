import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inquiries, inquiriesForm } from "../../src/core/db/index.js";
import { formRoute } from "../../src/core/editor/index.js";
import {
  coerceFormValue,
  columnName,
  defineForm,
  tanstackFormValidators,
  validateSubmission,
  verifyTurnstileToken,
} from "../../src/core/forms/index.js";

const ctx = {} as ExecutionContext;

// --- defineForm / column derivation ----------------------------------------

describe("defineForm", () => {
  it("derives columns, a table, and review columns from the fields", () => {
    const form = defineForm({
      name: "signups",
      fields: {
        email: { type: "email", label: "Email", required: true },
        wantsUpdates: { type: "checkbox", label: "Updates?" },
        seats: { type: "number", label: "Seats" },
      },
    });
    const { name, columns } = getTableConfig(form.table);
    expect(name).toBe("signups");
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));
    // camelCase key → snake_case column, required → notNull, types mapped.
    expect(byName.email?.notNull).toBe(true);
    expect(byName.wants_updates?.getSQLType()).toBe("integer"); // checkbox → boolean integer
    expect(byName.seats?.getSQLType()).toBe("real"); // number → real
    expect(byName.created_at).toBeTruthy();
    expect(form.reviewColumns).toEqual([
      { key: "email", label: "Email", type: "email" },
      { key: "wantsUpdates", label: "Updates?", type: "checkbox" },
      { key: "seats", label: "Seats", type: "number" },
    ]);
  });

  it("rejects a non-identifier form name", () => {
    expect(() => defineForm({ name: "a b", fields: {} })).toThrow(/Invalid form name/);
  });
});

describe("columnName", () => {
  it("converts camelCase to snake_case", () => {
    expect(columnName("firstName")).toBe("first_name");
    expect(columnName("email")).toBe("email");
  });
});

// The fold: `inquiries` is now derived from `inquiriesForm` — assert its shape
// still matches the framework's long-standing table so no base migration is
// forced (email + message NOT NULL, the rest nullable, id pk + created_at).
describe("inquiriesForm (built-in default form)", () => {
  it("derives the historical inquiries table shape", () => {
    const { name, columns } = getTableConfig(inquiries);
    expect(name).toBe("inquiries");
    const byName = Object.fromEntries(
      columns.map((c) => [c.name, { notNull: c.notNull, pk: c.primary }]),
    );
    expect(Object.keys(byName).sort()).toEqual(
      ["created_at", "email", "first_name", "id", "last_name", "message", "regarding"].sort(),
    );
    expect(byName.id?.pk).toBe(true);
    expect(byName.email?.notNull).toBe(true);
    expect(byName.message?.notNull).toBe(true);
    expect(byName.first_name?.notNull).toBe(false);
    expect(byName.regarding?.notNull).toBe(false);
  });

  it("exposes the same fields on the form definition", () => {
    expect(Object.keys(inquiriesForm.fields)).toEqual([
      "firstName",
      "lastName",
      "email",
      "regarding",
      "message",
    ]);
  });
});

// --- coercion + validation -------------------------------------------------

describe("coerceFormValue", () => {
  const f = (type: Parameters<typeof coerceFormValue>[0]["type"]) => ({ type, label: "x" });
  it("coerces by field type; blanks → null", () => {
    expect(coerceFormValue(f("text"), "  hi  ")).toBe("hi");
    expect(coerceFormValue(f("text"), "   ")).toBeNull();
    expect(coerceFormValue(f("number"), "42")).toBe(42);
    expect(coerceFormValue(f("checkbox"), "on")).toBe(true);
    expect(coerceFormValue(f("checkbox"), undefined)).toBe(false);
  });
});

describe("validateSubmission", () => {
  const form = defineForm({
    name: "contact",
    fields: {
      email: { type: "email", label: "Email", required: true },
      topic: { type: "select", label: "Topic", options: ["sales", "support"] },
      message: { type: "textarea", label: "Message", required: true, validation: (r) => r.max(10) },
      count: { type: "number", label: "Count" },
    },
  });

  it("passes a valid submission and returns coerced values", async () => {
    const { values, violations } = await validateSubmission(form, {
      email: "a@b.co",
      topic: "sales",
      message: "hi",
      count: "3",
    });
    expect(violations).toEqual([]);
    expect(values).toMatchObject({ email: "a@b.co", topic: "sales", message: "hi", count: 3 });
  });

  it("flags required-empty, bad email, bad select, over-max, and non-numbers", async () => {
    const { violations } = await validateSubmission(form, {
      email: "not-an-email",
      topic: "billing", // not an option
      message: "this is way too long", // > 10
      count: "abc", // not a number
    });
    const paths = violations.map((v) => v.path);
    expect(paths).toContain("email"); // format
    expect(paths).toContain("topic"); // allowlist
    expect(paths).toContain("message"); // max(10)
    expect(paths).toContain("count"); // NaN
  });

  it("reports a missing required field", async () => {
    const { violations } = await validateSubmission(form, { message: "hi" });
    expect(violations.some((v) => v.path === "email" && /required/.test(v.message))).toBe(true);
  });
});

// --- tanstack adapter ------------------------------------------------------

describe("tanstackFormValidators", () => {
  it("returns per-field validators backed by the shared engine (one error string)", async () => {
    const form = defineForm({
      name: "contact",
      fields: {
        email: { type: "email", label: "Email", required: true },
        note: { type: "textarea", label: "Note", validation: (r) => r.max(3) },
      },
    });
    const validators = tanstackFormValidators(form);
    // TanStack shape: ({ value }) => errorMessage | undefined.
    expect(await validators.email({ value: "" })).toMatch(/required/);
    expect(await validators.email({ value: "bad" })).toMatch(/valid email/);
    expect(await validators.email({ value: "a@b.co" })).toBeUndefined();
    expect(await validators.note({ value: "toolong" })).toMatch(/at most 3/);
    expect(await validators.note({ value: "ok" })).toBeUndefined();
  });
});

// --- verifyTurnstileToken --------------------------------------------------

describe("verifyTurnstileToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns true only on a confirmed success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true }))),
    );
    expect(await verifyTurnstileToken("secret", "tok")).toBe(true);
  });

  it("fails closed on a missing token, a failure, or a network error", async () => {
    expect(await verifyTurnstileToken("secret", null)).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false }))),
    );
    expect(await verifyTurnstileToken("secret", "tok")).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    expect(await verifyTurnstileToken("secret", "tok")).toBe(false);
  });
});

// --- formRoute -------------------------------------------------------------

function makeD1() {
  const inserts: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async run() {
              inserts.push({ sql, binds });
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, inserts };
}

/** In-memory KVLike for the rate limiter. */
function makeKv() {
  const store = new Map<string, string>();
  return {
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
  };
}

describe("formRoute", () => {
  const form = defineForm({
    name: "inquiries",
    fields: {
      email: { type: "email", label: "Email", required: true },
      message: { type: "textarea", label: "Message", required: true },
    },
    spam: { rateLimit: { max: 2, windowSec: 60 } },
  });
  const url = "https://site.example/api/louise/forms/inquiries";
  const post = (body: unknown, origin = "https://site.example") =>
    new Request(url, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("passes through a non-matching path", async () => {
    const { db } = makeD1();
    const res = await formRoute({ form })(
      new Request("https://site.example/other"),
      { DB: db },
      ctx,
    );
    expect(res).toBeUndefined();
  });

  it("403s a cross-origin POST (CSRF) before touching the DB", async () => {
    const { db, inserts } = makeD1();
    const res = await formRoute({ form })(
      post({ email: "a@b.co", message: "hi" }, "https://evil.example"),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it("422s an invalid submission without inserting", async () => {
    const { db, inserts } = makeD1();
    const res = await formRoute({ form })(post({ email: "nope", message: "" }), { DB: db }, ctx);
    expect(res?.status).toBe(422);
    const body = (await res?.json()) as { violations: { path: string }[] };
    expect(body.violations.map((v) => v.path).sort()).toEqual(["email", "message"]);
    expect(inserts).toHaveLength(0);
  });

  it("inserts a valid submission (only declared columns + created_at)", async () => {
    const { db, inserts } = makeD1();
    const res = await formRoute({ form })(
      post({ email: "a@b.co", message: "hello" }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(201);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.sql).toContain('INSERT INTO "inquiries"');
    expect(inserts[0]?.sql).toContain('"email","message","created_at"');
    // email, message, created_at (unix seconds)
    expect(inserts[0]?.binds.slice(0, 2)).toEqual(["a@b.co", "hello"]);
  });

  it("rate-limits after the budget is spent (429)", async () => {
    const { db } = makeD1();
    const kv = makeKv();
    const route = formRoute({ form, rateLimitKv: () => kv, clientKey: () => "1.2.3.4" });
    const send = () => route(post({ email: "a@b.co", message: "hi" }), { DB: db }, ctx);
    expect((await send())?.status).toBe(201);
    expect((await send())?.status).toBe(201);
    const third = await send();
    expect(third?.status).toBe(429);
    expect(third?.headers.get("Retry-After")).toBeTruthy();
  });
});
