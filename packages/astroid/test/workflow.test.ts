import { describe, expect, it } from "vitest";
import {
  advanceWorkflowStage,
  normalizeInitials,
  normalizeSpecs,
  overrideWorkflowStage,
} from "../src/workflow/advance.js";
import {
  defineWorkflow,
  workflowAuditTable,
  workflowOverrideTable,
} from "../src/workflow/config.js";
import { generateWorkflowRoute, generateWorkflowSchema } from "../src/workflow/generate.js";
import { AstroidConfigError } from "../src/errors.js";

/**
 * A D1 stub backed by one row, honouring the `WHERE stage = ?` guard — which is
 * the only behaviour these tests actually depend on. `calls` records the SQL so
 * a test can assert ORDER, which is where the reference implementation went
 * wrong.
 */
function db(initial: { id: string; stage: number } | null) {
  const row = initial ? { ...initial } : null;
  const calls: { sql: string; binds: unknown[] }[] = [];
  const audit: Record<string, unknown>[] = [];
  const overrides: Record<string, unknown>[] = [];

  return {
    calls,
    audit,
    overrides,
    get stage() {
      return row?.stage;
    },
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          calls.push({ sql, binds });
          return {
            async run() {
              if (sql.startsWith("UPDATE")) {
                const [next, , expected] = binds as [number, string, number];
                // The guard: only move when the row is where the caller thought.
                if (row && row.stage === expected) {
                  row.stage = next;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.includes("INSERT INTO") && sql.includes("_signoffs")) {
                audit.push({ id: binds[0], stage: binds[1], specs: binds[2], initials: binds[3] });
              }
              if (sql.includes("INSERT INTO") && sql.includes("_override_log")) {
                overrides.push({ id: binds[0], action: binds[1], initials: binds[2] });
              }
              if (sql.startsWith("DELETE")) {
                const [, stage] = binds as [string, number];
                const at = audit.findIndex((a) => a.stage === stage);
                if (at >= 0) audit.splice(at, 1);
              }
              return { meta: { changes: 1 } };
            },
            async first<T>() {
              return (row ? { stage: row.stage } : null) as T | null;
            },
          };
        },
      };
    },
  };
}

const base = (over: Partial<Parameters<typeof advanceWorkflowStage>[0]> = {}) => ({
  table: "orders",
  auditTable: "orders_signoffs",
  auditIdColumn: "order_id",
  id: "GF-1",
  expectedStage: 0,
  stageCount: 4,
  actor: { initials: "bb" },
  ...over,
});

describe("advanceWorkflowStage", () => {
  it("advances one stage and records who did it", async () => {
    const stub = db({ id: "GF-1", stage: 0 });
    const result = await advanceWorkflowStage({ ...base(), db: stub });

    expect(result).toEqual({ ok: true, stage: 1, complete: false });
    expect(stub.stage).toBe(1);
    // Initials are normalized on the way in.
    expect(stub.audit).toEqual([{ id: "GF-1", stage: 0, specs: null, initials: "BB" }]);
  });

  it("reports completion when the last stage is signed", async () => {
    const stub = db({ id: "GF-1", stage: 3 });
    const result = await advanceWorkflowStage({ ...base({ expectedStage: 3 }), db: stub });
    expect(result).toEqual({ ok: true, stage: 4, complete: true });
  });

  it("409s the SECOND of two operators signing the same stage", async () => {
    // The failure this module exists to prevent: two stations, one job, both
    // pressing sign-off. Without the guard the item runs forward twice.
    const stub = db({ id: "GF-1", stage: 2 });
    const first = await advanceWorkflowStage({ ...base({ expectedStage: 2 }), db: stub });
    const second = await advanceWorkflowStage({ ...base({ expectedStage: 2 }), db: stub });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, status: 409 });
    // The item moved exactly once...
    expect(stub.stage).toBe(3);
    // ...and the audit trail records exactly one sign-off.
    expect(stub.audit).toHaveLength(1);
  });

  it("names the real stage in the conflict, so the operator can recover", async () => {
    const stub = db({ id: "GF-1", stage: 3 });
    const result = await advanceWorkflowStage({ ...base({ expectedStage: 1 }), db: stub });
    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.error).toContain("stage 3");
  });

  it("writes NO audit row when the advance was refused", async () => {
    // The ordering bug in the reference: it inserted the sign-off first, so a
    // stale submit recorded work that never happened.
    const stub = db({ id: "GF-1", stage: 3 });
    await advanceWorkflowStage({ ...base({ expectedStage: 0 }), db: stub });
    expect(stub.audit).toEqual([]);
  });

  it("guards the UPDATE itself rather than checking first", async () => {
    const stub = db({ id: "GF-1", stage: 0 });
    await advanceWorkflowStage({ ...base(), db: stub });
    // The very first statement must be the guarded write — a SELECT-then-UPDATE
    // leaves a window between the two.
    expect(stub.calls[0].sql).toMatch(
      /^UPDATE orders SET stage = \? WHERE id = \? AND stage = \?$/,
    );
    expect(stub.calls[0].binds).toEqual([1, "GF-1", 0]);
  });

  it("404s a row that no longer exists", async () => {
    const stub = db(null);
    expect(await advanceWorkflowStage({ ...base(), db: stub })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("422s missing initials and an out-of-range stage", async () => {
    const stub = db({ id: "GF-1", stage: 0 });
    expect(
      await advanceWorkflowStage({ ...base({ actor: { initials: "  " } }), db: stub }),
    ).toMatchObject({ ok: false, status: 422 });
    expect(await advanceWorkflowStage({ ...base({ expectedStage: 9 }), db: stub })).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(await advanceWorkflowStage({ ...base({ expectedStage: -1 }), db: stub })).toMatchObject({
      ok: false,
      status: 422,
    });
    // Nothing moved on any of them.
    expect(stub.stage).toBe(0);
  });

  it("stores recorded specs as JSON", async () => {
    const stub = db({ id: "GF-1", stage: 0 });
    await advanceWorkflowStage({
      ...base({ specs: [{ k: "Brew ratio", v: "1:4.2" }] }),
      db: stub,
    });
    expect(JSON.parse(stub.audit[0].specs as string)).toEqual([{ k: "Brew ratio", v: "1:4.2" }]);
  });
});

describe("normalizeInitials / normalizeSpecs", () => {
  it("upper-cases, trims, and caps initials", () => {
    expect(normalizeInitials("  bb ")).toBe("BB");
    expect(normalizeInitials("abcdef")).toBe("ABC");
    expect(normalizeInitials("   ")).toBeNull();
    expect(normalizeInitials(undefined)).toBeNull();
  });

  it("drops malformed specs and bounds the list", () => {
    // An operator's notes are untrusted request input like anything else.
    expect(normalizeSpecs([{ k: "a", v: "b" }, { k: 1 }, null, "x"])).toEqual([{ k: "a", v: "b" }]);
    expect(normalizeSpecs("nope")).toEqual([]);
    expect(normalizeSpecs(Array.from({ length: 50 }, () => ({ k: "k", v: "v" })))).toHaveLength(24);
    expect(normalizeSpecs([{ k: "x".repeat(200), v: "y".repeat(500) }])[0].k).toHaveLength(60);
  });
});

describe("overrideWorkflowStage", () => {
  type OverrideArgs = Parameters<typeof overrideWorkflowStage>[0];
  const overrideBase = (over: Partial<OverrideArgs> & Pick<OverrideArgs, "action">) => ({
    ...base(),
    overrideTable: "orders_override_log",
    station: "roast",
    ...over,
  });

  it("sends an item back and reopens that stage's sign-off", async () => {
    const stub = db({ id: "GF-1", stage: 2 });
    await advanceWorkflowStage({ ...base({ expectedStage: 2 }), db: stub }); // now at 3, audit@2
    expect(stub.audit).toHaveLength(1);

    const result = await overrideWorkflowStage({
      ...overrideBase({ action: "back", expectedStage: 3 }),
      db: stub,
    });

    expect(result).toMatchObject({ ok: true, stage: 2 });
    // The sign-off for the reopened stage is gone — otherwise the audit trail
    // would claim work that was undone.
    expect(stub.audit).toEqual([]);
    expect(stub.overrides).toEqual([{ id: "GF-1", action: "back", initials: "BB" }]);
  });

  it("skips a stage forward without writing a sign-off for it", async () => {
    const stub = db({ id: "GF-1", stage: 1 });
    const result = await overrideWorkflowStage({
      ...overrideBase({ action: "skip", expectedStage: 1 }),
      db: stub,
    });
    expect(result).toMatchObject({ ok: true, stage: 2 });
    // A skipped stage was never done, so it must not look signed.
    expect(stub.audit).toEqual([]);
    expect(stub.overrides[0].action).toBe("skip");
  });

  it("refuses to go back past the start or forward past the end", async () => {
    const atStart = db({ id: "GF-1", stage: 0 });
    expect(
      await overrideWorkflowStage({
        ...overrideBase({ action: "back", expectedStage: 0 }),
        db: atStart,
      }),
    ).toMatchObject({ ok: false, status: 422 });

    const done = db({ id: "GF-1", stage: 4 });
    expect(
      await overrideWorkflowStage({
        ...overrideBase({ action: "skip", expectedStage: 4 }),
        db: done,
      }),
    ).toMatchObject({ ok: false, status: 422 });
  });

  it("409s a stale override the same way an advance does", async () => {
    const stub = db({ id: "GF-1", stage: 3 });
    expect(
      await overrideWorkflowStage({
        ...overrideBase({ action: "back", expectedStage: 1 }),
        db: stub,
      }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(stub.overrides).toEqual([]);
  });
});

describe("defineWorkflow", () => {
  const ok = { key: "orders", stages: ["received", "packed", "shipped"] };

  it("accepts a valid pipeline and normalizes table names", () => {
    const wf = defineWorkflow(ok);
    expect(workflowAuditTable(wf)).toBe("orders_signoffs");
    expect(workflowOverrideTable(wf)).toBe("orders_override_log");
    expect(workflowOverrideTable(defineWorkflow({ ...ok, overrides: false }))).toBeNull();
  });

  it("rejects a key that can't name a table or route", () => {
    expect(() => defineWorkflow({ ...ok, key: "My Orders" })).toThrow(AstroidConfigError);
    expect(() => defineWorkflow({ ...ok, key: "" })).toThrow(AstroidConfigError);
  });

  it("rejects a pipeline with fewer than two stages", () => {
    // One stage is an integer that only ever holds 0 — there is nothing to advance to.
    expect(() => defineWorkflow({ ...ok, stages: ["only"] })).toThrow(/at least 2 stages/);
  });

  it("rejects duplicate stage keys", () => {
    // Duplicates make stationFields ambiguous and an audit row's stage non-unique.
    expect(() => defineWorkflow({ ...ok, stages: ["a", "b", "a"] })).toThrow(/duplicate stage/);
  });

  it("rejects stationFields for a stage that doesn't exist", () => {
    expect(() =>
      defineWorkflow({ ...ok, stationFields: { nope: [{ key: "x", label: "X" }] } }),
    ).toThrow(/unknown stage/);
  });
});

describe("generateWorkflowSchema", () => {
  const wf = defineWorkflow({ key: "orders", stages: ["received", "packed", "shipped"] });

  it("emits the audit table with a unique index per item+stage", () => {
    const { source } = generateWorkflowSchema(wf);
    expect(source).toContain('sqliteTable(\n  "orders_signoffs"');
    expect(source).toContain("uniqueIndex");
    expect(source).toContain('"orders_signoffs_entity_stage_key"');
    // Derived FK name, singularized from the workflow key.
    expect(source).toContain('text("order_id")');
  });

  it("emits the override log only when overrides are on", () => {
    expect(generateWorkflowSchema(wf).source).toContain("orders_override_log");
    expect(
      generateWorkflowSchema(
        defineWorkflow({ key: "orders", stages: ["a", "b"], overrides: false }),
      ).source,
    ).not.toContain("override_log");
  });

  it("hands back the stage column rather than generating the project's table", () => {
    // Astroid doesn't own the entity table — inventing one would collide with
    // whatever the project already has.
    const { source, stageColumn } = generateWorkflowSchema(wf);
    expect(stageColumn).toContain('integer("stage")');
    expect(source).not.toContain('sqliteTable(\n  "orders"');
  });

  it("emits stage labels in order", () => {
    expect(generateWorkflowSchema(wf).source).toContain(
      'ORDERS_STAGES = ["received","packed","shipped"]',
    );
  });
});

describe("generateWorkflowRoute", () => {
  const wf = defineWorkflow({ key: "orders", stages: ["received", "packed", "shipped"] });

  it("wires the guarded advance and maps its status straight onto the response", () => {
    const route = generateWorkflowRoute(wf);
    expect(route).toContain("advanceWorkflowStage");
    expect(route).toContain("stageCount: STAGE_COUNT");
    expect(route).toContain("const STAGE_COUNT = 3;");
    expect(route).toContain("{ status: result.status }");
  });

  it("leaves an explicit gate TODO rather than shipping an open endpoint", () => {
    // A pipeline advance is privileged; a scaffold that silently omitted auth
    // would be worse than one that says so.
    expect(generateWorkflowRoute(wf)).toContain("TODO: gate this");
  });
});
