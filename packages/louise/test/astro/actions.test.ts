import { describe, expect, it } from "vitest";
import { louiseSaveAction, type SaveActionContext } from "../../src/astro/actions.js";
import { pages } from "../../src/core/db/index.js";

// Fake D1 mirroring test/core/editor.test.ts's makeD1, plus `.raw()`: drizzle's
// `update().set().where().returning()` reads its rows via `stmt.bind(...).raw()`
// (row-arrays, decoded by column index), so `handler` returns those row-arrays —
// a non-empty result means "row updated", `[]` means "not found". Records SQL/binds
// so a test can assert an UPDATE was issued.
function makeD1(handler: (sql: string, binds: unknown[]) => unknown[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          const record = () => calls.push({ sql, binds });
          return {
            async all() {
              record();
              return { results: handler(sql, binds) };
            },
            // drizzle's D1 driver reads `.returning()` rows through `.raw()`.
            async raw() {
              record();
              return handler(sql, binds);
            },
            async run() {
              record();
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

// Stand-in for Astro's injected `ActionError`: captures the code/message the
// handler throws, so the mapping is assertable without the virtual `astro:actions`.
class FakeActionError extends Error {
  code: string;
  constructor(opts: { code: string; message?: string }) {
    super(opts.message);
    this.code = opts.code;
  }
}

const editor = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };
const collections = {
  pages: { table: pages, fields: ["title", "body"], richFields: ["body"] },
};
const action = louiseSaveAction({ collections, ActionError: FakeActionError });

// A minimal Astro Action context: the middleware-resolved editor + CF bindings,
// both off `locals` (the handler's default `getEditor`/`getEnv` read here).
const makeCtx = (db: D1Database, ed: unknown = editor): SaveActionContext => ({
  locals: { editor: ed, runtime: { env: { DB: db } } },
});

describe("louiseSaveAction", () => {
  it("input schema requires the routing keys", () => {
    expect(
      action.input.safeParse({ collection: "pages", key: "1", field: "title", value: "x" }).success,
    ).toBe(true);
    expect(action.input.safeParse({ collection: "pages" }).success).toBe(false);
  });

  it("writes the field and returns ok", async () => {
    const { db, calls } = makeD1(() => [[1]]); // returning() yields the row
    const out = await action.handler(
      { collection: "pages", key: "1", field: "title", value: "Hello" },
      makeCtx(db),
    );
    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/update/i);
    expect(calls[0].sql).toMatch(/where/i);
    expect(calls[0].binds).toContain("Hello");
  });

  it("sanitizes a rich field before storing", async () => {
    const { db, calls } = makeD1(() => [[1]]);
    await action.handler(
      { collection: "pages", key: "1", field: "body", value: "<b>hi</b><script>x</script>" },
      makeCtx(db),
    );
    // The stored value is the sanitized HTML — the <script> is gone.
    const stored = String(calls[0].binds[0]);
    expect(stored).toContain("<b>hi</b>");
    expect(stored).not.toContain("<script>");
  });

  it("throws UNAUTHORIZED without an editor, and never touches D1", async () => {
    const { db, calls } = makeD1(() => []);
    await expect(
      action.handler(
        { collection: "pages", key: "1", field: "title", value: "x" },
        makeCtx(db, null),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls).toHaveLength(0);
  });

  it("throws BAD_REQUEST for an unknown collection", async () => {
    const { db, calls } = makeD1(() => []);
    await expect(
      action.handler({ collection: "nope", key: "1", field: "title", value: "x" }, makeCtx(db)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Unknown collection" });
    expect(calls).toHaveLength(0);
  });

  it("throws BAD_REQUEST for an empty value", async () => {
    const { db } = makeD1(() => []);
    await expect(
      action.handler({ collection: "pages", key: "1", field: "title", value: "" }, makeCtx(db)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws NOT_FOUND when no row is updated", async () => {
    const { db } = makeD1(() => []); // returning() yields nothing
    await expect(
      action.handler({ collection: "pages", key: "999", field: "title", value: "x" }, makeCtx(db)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
