import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  type EditorActionContext,
  louiseSaveAction,
  louiseSaveDraftAction,
  louiseSettingsAction,
} from "../../src/astro/actions.js";
import { collectionVersionsTable, defineCollection } from "../../src/core/content/index.js";
import { pages, siteSettings } from "../../src/core/db/index.js";

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

// The Worker `env` is injected via `getEnv` — Astro v6+ removed `locals.runtime.env`,
// so there is no context default (see resolveDeps). Each factory closes over the
// per-test fake D1 exactly the way a site closes over `env` from `cloudflare:workers`,
// so calling a handler only reaches D1 through the injected `getEnv`.
const saveActionFor = (db: D1Database) =>
  louiseSaveAction({ collections, ActionError: FakeActionError, getEnv: () => ({ DB: db }) });

// A minimal Astro Action context: just the middleware-resolved editor off `locals`
// (the handler's default `getEditor` reads here). No `runtime.env` — the env comes
// from the injected `getEnv`, not the context.
const makeCtx = (ed: unknown = editor): EditorActionContext => ({ locals: { editor: ed } });

describe("louiseSaveAction", () => {
  it("input schema requires the routing keys", () => {
    const action = saveActionFor({} as D1Database);
    expect(
      action.input.safeParse({ collection: "pages", key: "1", field: "title", value: "x" }).success,
    ).toBe(true);
    expect(action.input.safeParse({ collection: "pages" }).success).toBe(false);
  });

  it("resolves the env via the injected getEnv, writes the field, and returns ok", async () => {
    const { db, calls } = makeD1(() => [[1]]); // returning() yields the row
    // The context carries no env; the only path to D1 is the injected `getEnv`.
    const out = await saveActionFor(db).handler(
      { collection: "pages", key: "1", field: "title", value: "Hello" },
      makeCtx(),
    );
    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/update/i);
    expect(calls[0].sql).toMatch(/where/i);
    expect(calls[0].binds).toContain("Hello");
  });

  it("sanitizes a rich field before storing", async () => {
    const { db, calls } = makeD1(() => [[1]]);
    await saveActionFor(db).handler(
      { collection: "pages", key: "1", field: "body", value: "<b>hi</b><script>x</script>" },
      makeCtx(),
    );
    // The stored value is the sanitized HTML — the <script> is gone.
    const stored = String(calls[0].binds[0]);
    expect(stored).toContain("<b>hi</b>");
    expect(stored).not.toContain("<script>");
  });

  it("throws UNAUTHORIZED without an editor, and never touches D1", async () => {
    const { db, calls } = makeD1(() => []);
    await expect(
      saveActionFor(db).handler(
        { collection: "pages", key: "1", field: "title", value: "x" },
        makeCtx(null),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls).toHaveLength(0);
  });

  it("throws BAD_REQUEST for an unknown collection", async () => {
    const { db, calls } = makeD1(() => []);
    await expect(
      saveActionFor(db).handler(
        { collection: "nope", key: "1", field: "title", value: "x" },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Unknown collection" });
    expect(calls).toHaveLength(0);
  });

  it("throws BAD_REQUEST for an empty value", async () => {
    const { db } = makeD1(() => []);
    await expect(
      saveActionFor(db).handler(
        { collection: "pages", key: "1", field: "title", value: "" },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws NOT_FOUND when no row is updated", async () => {
    const { db } = makeD1(() => []); // returning() yields nothing
    await expect(
      saveActionFor(db).handler(
        { collection: "pages", key: "999", field: "title", value: "x" },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

const settingsActionFor = (db: D1Database) =>
  louiseSettingsAction({
    table: siteSettings,
    columns: ["siteName"],
    customKeys: ["heroHeadline"],
    ActionError: FakeActionError,
    getEnv: () => ({ DB: db }),
  });

// One all-null settings row: the singleton read goes through drizzle's `.raw()`,
// and drizzle skips decoding for null cells, so an all-null array of the right
// length decodes to a row of nulls regardless of column types. `[]` = no row.
const settingsRow = [
  Array.from({ length: getTableConfig(siteSettings).columns.length }, () => null),
];

describe("louiseSettingsAction", () => {
  it("patches allowlisted keys and reports the ignored ones", async () => {
    const { db, calls } = makeD1(() => settingsRow);
    const out = await settingsActionFor(db).handler({ siteName: "Acme", bogus: "x" }, makeCtx());
    expect(out).toEqual({ ok: true, ignored: ["bogus"] });
    expect(calls.some((c) => /update/i.test(c.sql))).toBe(true);
  });

  it("throws UNAUTHORIZED without an editor, and never touches D1", async () => {
    const { db, calls } = makeD1(() => settingsRow);
    await expect(
      settingsActionFor(db).handler({ siteName: "Acme" }, makeCtx(null)),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls).toHaveLength(0);
  });

  it("throws NOT_FOUND when there is no settings row", async () => {
    const { db } = makeD1(() => []);
    await expect(
      settingsActionFor(db).handler({ siteName: "Acme" }, makeCtx()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

const draftConfig = defineCollection({
  slug: "pages",
  fields: { slug: { type: "text" }, title: { type: "text" }, sections: { type: "json" } },
  versions: { drafts: true },
});
const saveDraftActionFor = (db: D1Database) =>
  louiseSaveDraftAction({
    table: pages,
    versionsTable: collectionVersionsTable(draftConfig),
    config: draftConfig,
    ActionError: FakeActionError,
    getEnv: () => ({ DB: db }),
  });

// The merge-base / KV-buffer happy path saves a draft version to D1 and is
// covered by the astro-preview E2E against a real local D1 (there is no async
// in-memory SQLite harness in this repo) — mirroring versions-route.test.ts. These
// cover the Action wrapper contract, which short-circuits before that machinery.
describe("louiseSaveDraftAction", () => {
  it("input schema requires an integer id and a data object", () => {
    const action = saveDraftActionFor({} as D1Database);
    expect(action.input.safeParse({ id: 5, data: { title: "x" } }).success).toBe(true);
    expect(action.input.safeParse({ data: { title: "x" } }).success).toBe(false);
    expect(action.input.safeParse({ id: 1.5, data: {} }).success).toBe(false);
  });

  it("throws UNAUTHORIZED without an editor, and never touches D1", async () => {
    const { db, calls } = makeD1(() => []);
    await expect(
      saveDraftActionFor(db).handler({ id: 5, data: { title: "x" } }, makeCtx(null)),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls).toHaveLength(0);
  });

  it("throws NOT_FOUND when the versioned row does not exist", async () => {
    const { db } = makeD1(() => []); // the parent-row select yields nothing
    await expect(
      saveDraftActionFor(db).handler({ id: 999, data: { title: "x" } }, makeCtx()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// Regression for #138 / the Astro v6 `locals.runtime.env` removal: there is no
// context default for the env, so a config that omits `getEnv` is a wiring error
// that throws at construction — loudly, up front — instead of silently reading an
// `undefined` env and 500-ing per request (which the old `runtime.env` default did
// under the peer-dep `astro ^7`). The `as unknown as …` casts drop `getEnv` the way
// an untyped (JS) caller would, exercising the shared `resolveDeps` guard.
describe("editor Actions require an injected getEnv", () => {
  it("louiseSaveAction throws when getEnv is omitted", () => {
    expect(() =>
      louiseSaveAction({ collections, ActionError: FakeActionError } as unknown as Parameters<
        typeof louiseSaveAction
      >[0]),
    ).toThrow(/getEnv/);
  });

  it("louiseSettingsAction throws when getEnv is omitted", () => {
    expect(() =>
      louiseSettingsAction({
        table: siteSettings,
        columns: ["siteName"],
        ActionError: FakeActionError,
      } as unknown as Parameters<typeof louiseSettingsAction>[0]),
    ).toThrow(/getEnv/);
  });

  it("louiseSaveDraftAction throws when getEnv is omitted", () => {
    expect(() =>
      louiseSaveDraftAction({
        table: pages,
        versionsTable: collectionVersionsTable(draftConfig),
        config: draftConfig,
        ActionError: FakeActionError,
      } as unknown as Parameters<typeof louiseSaveDraftAction>[0]),
    ).toThrow(/getEnv/);
  });
});
