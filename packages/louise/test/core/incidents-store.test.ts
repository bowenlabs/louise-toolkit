import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { EditorSession } from "../../src/core/auth/types.js";
import { incidentsRoute } from "../../src/core/editor/incidents.js";
import {
  buildIncidentReport,
  d1Incidents,
  getIncident,
  type IncidentReport,
  listIncidents,
  resolveIncident,
  upsertIncident,
} from "../../src/core/incidents/index.js";
import { reportDegraded } from "../../src/core/errors.js";
import { composeWorker } from "../../src/core/worker/index.js";

// The table as drizzle-kit generates it from `incidentsColumns`.
const INCIDENTS_DDL = `CREATE TABLE incidents (
  fingerprint TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  message TEXT NOT NULL,
  path TEXT,
  host TEXT,
  release TEXT,
  critical INTEGER DEFAULT false NOT NULL,
  count INTEGER DEFAULT 1 NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  resolved_at INTEGER,
  reopened_at INTEGER
);
CREATE INDEX incidents_last_seen ON incidents (last_seen);`;

/** A D1 double over in-memory SQLite: drizzle reads a select through `raw()`
 *  and everything else through `all()` or `run()`. */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(INCIDENTS_DDL);
  const statement = (sql: string, binds: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    all: async () => ({ results: sqlite.prepare(sql).all(...binds), success: true, meta: {} }),
    raw: async () => {
      const prepared = sqlite.prepare(sql);
      prepared.setReturnArrays(true);
      return prepared.all(...binds);
    },
    first: async () => sqlite.prepare(sql).get(...binds) ?? null,
    run: async () => ({
      success: true,
      meta: { changes: Number(sqlite.prepare(sql).run(...binds).changes) },
    }),
  });
  return { sqlite, db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database };
}

const T0 = 1_700_000_000_000;

function report(
  overrides: Partial<Parameters<typeof buildIncidentReport>[0]> = {},
): IncidentReport {
  return buildIncidentReport({
    kind: "fetch",
    cause: new Error("row 41 not found"),
    request: new Request("https://site.example/menu"),
    now: T0,
    ...overrides,
  });
}

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  error.mockRestore();
});

describe("upsertIncident", () => {
  it("inserts the first report for a fingerprint", async () => {
    const { db } = sqliteD1();
    const first = report();
    const row = await upsertIncident(db, first);
    expect(row).toMatchObject({
      fingerprint: first.fingerprint,
      kind: "fetch",
      name: "Error",
      code: null,
      message: "row 41 not found",
      path: "/menu",
      host: "site.example",
      release: null,
      critical: false,
      count: 1,
      resolvedAt: null,
      reopenedAt: null,
    });
    expect(row.firstSeen.getTime()).toBe(T0);
    expect(row.lastSeen.getTime()).toBe(T0);
  });

  it("counts a repeat and keeps the latest details", async () => {
    const { db } = sqliteD1();
    await upsertIncident(db, report());
    const row = await upsertIncident(
      db,
      report({
        cause: new Error("row 97 not found"),
        request: new Request("https://site.example/cart"),
        release: "v2",
        critical: true,
        now: T0 + 5_000,
      }),
    );
    expect(row).toMatchObject({
      count: 2,
      message: "row 97 not found",
      path: "/cart",
      release: "v2",
      critical: true,
    });
    expect(row.firstSeen.getTime()).toBe(T0);
    expect(row.lastSeen.getTime()).toBe(T0 + 5_000);
  });

  it("never moves lastSeen backward for a report that arrives late", async () => {
    const { db } = sqliteD1();
    await upsertIncident(db, report({ now: T0 + 10_000 }));
    const row = await upsertIncident(db, report({ now: T0 }));
    expect(row.count).toBe(2);
    expect(row.lastSeen.getTime()).toBe(T0 + 10_000);
  });

  it("reopens a resolved incident when it comes back", async () => {
    const { db } = sqliteD1();
    const { fingerprint } = await upsertIncident(db, report());
    const resolved = await resolveIncident(db, fingerprint, new Date(T0 + 1_000));
    expect(resolved?.resolvedAt?.getTime()).toBe(T0 + 1_000);

    const back = await upsertIncident(db, report({ now: T0 + 2_000 }));
    expect(back.resolvedAt).toBeNull();
    expect(back.reopenedAt?.getTime()).toBe(T0 + 2_000);
    expect(back.count).toBe(2);

    // An open incident's repeats leave reopenedAt where it was.
    const again = await upsertIncident(db, report({ now: T0 + 3_000 }));
    expect(again.reopenedAt?.getTime()).toBe(T0 + 2_000);
  });

  it("keeps different failures apart", async () => {
    const { db } = sqliteD1();
    await upsertIncident(db, report());
    await upsertIncident(db, report({ cause: new TypeError("fetch failed") }));
    expect(await listIncidents(db)).toHaveLength(2);
  });
});

describe("listIncidents, getIncident, and resolveIncident", () => {
  it("lists open incidents by default, most recently seen first", async () => {
    const { db } = sqliteD1();
    const a = await upsertIncident(db, report({ now: T0 }));
    const b = await upsertIncident(db, report({ cause: new TypeError("x"), now: T0 + 1 }));
    const c = await upsertIncident(db, report({ cause: new RangeError("y"), now: T0 + 2 }));
    await resolveIncident(db, b.fingerprint);

    expect((await listIncidents(db)).map((r) => r.fingerprint)).toEqual([
      c.fingerprint,
      a.fingerprint,
    ]);
    expect((await listIncidents(db, { status: "resolved" })).map((r) => r.fingerprint)).toEqual([
      b.fingerprint,
    ]);
    expect(await listIncidents(db, { status: "all" })).toHaveLength(3);
    expect(await listIncidents(db, { status: "all", limit: 1 })).toHaveLength(1);
  });

  it("reads one incident, or null", async () => {
    const { db } = sqliteD1();
    const row = await upsertIncident(db, report());
    expect((await getIncident(db, row.fingerprint))?.count).toBe(1);
    expect(await getIncident(db, "0000000000000000")).toBeNull();
  });

  it("resolves only an open incident", async () => {
    const { db } = sqliteD1();
    const row = await upsertIncident(db, report());
    expect(await resolveIncident(db, row.fingerprint)).not.toBeNull();
    expect(await resolveIncident(db, row.fingerprint)).toBeNull();
    expect(await resolveIncident(db, "0000000000000000")).toBeNull();
  });
});

describe("d1Incidents with composeWorker", () => {
  type Env = { DB: D1Database };
  const ctx = () => {
    const pending: Promise<unknown>[] = [];
    return {
      ctx: {
        waitUntil: (p: Promise<unknown>) => pending.push(p),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext,
      settled: () => Promise.all(pending),
    };
  };
  type IncomingRequest = Parameters<NonNullable<ExportedHandler["fetch"]>>[0];

  it("turns 100 identical throws into one incident with a count of 100", async () => {
    const { db } = sqliteD1();
    const worker = composeWorker<Env>({
      fetch: async (request) => {
        throw new Error(`row ${new URL(request.url).searchParams.get("id")} not found`);
      },
      onIncident: [d1Incidents((env: Env) => env.DB)],
    });
    for (let id = 0; id < 100; id++) {
      const { ctx: c, settled } = ctx();
      const request = new Request(`https://site.example/p?id=${id}`) as unknown as IncomingRequest;
      await expect(worker.fetch!(request, { DB: db }, c)).rejects.toThrow();
      await settled();
    }
    const rows = await listIncidents(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 100, message: "row 99 not found", path: "/p" });
  });

  it("hands every sink the bindings and the original cause", async () => {
    const { db } = sqliteD1();
    const seen: unknown[] = [];
    const boom = new Error("render failed");
    const worker = composeWorker<Env>({
      fetch: async () => {
        throw boom;
      },
      onIncident: [
        d1Incidents((env: Env) => env.DB),
        (_report, context) => {
          seen.push(context.env, context.cause);
        },
      ],
    });
    const env = { DB: db };
    const { ctx: c, settled } = ctx();
    await expect(
      worker.fetch!(new Request("https://site.example/") as unknown as IncomingRequest, env, c),
    ).rejects.toBe(boom);
    await settled();
    expect(seen).toEqual([env, boom]);
    expect(await listIncidents(db)).toHaveLength(1);
  });

  describe("a failed query's bound values", () => {
    // What a contact form writes: personal data no log, row, or tracker may keep.
    const pii = {
      name: "Avery Example",
      email: "avery@example.com",
      address: "1 Example Lane",
      note: "Leave it with the neighbor",
      customerId: "CUST-7Q2X",
    };
    const inquiries = sqliteTable("inquiries", {
      id: integer("id").primaryKey(),
      name: text("name").notNull(),
      email: text("email").notNull().unique(),
      address: text("address"),
      note: text("note"),
      customerId: text("customer_id"),
    });

    /** A site whose insert fails on drizzle-orm's D1 driver, with a sink that
     *  keeps what it would forward to an error tracker. */
    function site(mode: "throw" | "degrade") {
      const d1 = sqliteD1();
      d1.sqlite.exec(
        "CREATE TABLE inquiries (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, address TEXT, note TEXT, customer_id TEXT)",
      );
      const forwarded: string[] = [];
      const causes: unknown[] = [];
      const worker = composeWorker<Env>({
        fetch: async (_request, env) => {
          const orm = drizzle(env.DB);
          await orm.insert(inquiries).values(pii);
          try {
            await orm.insert(inquiries).values(pii);
          } catch (err) {
            if (mode === "throw") throw err;
            reportDegraded("forms.inquiry", err);
          }
          return new Response("ok");
        },
        onIncident: [
          d1Incidents((env: Env) => env.DB),
          (report, context) => {
            forwarded.push(JSON.stringify(report));
            causes.push(context.cause);
          },
        ],
      });
      return { ...d1, forwarded, causes, worker };
    }

    function expectNoPii(text: string): void {
      for (const value of Object.values(pii)) expect(text).not.toContain(value);
      expect(text).not.toContain("params:");
    }

    it("stay out of the incident row and the forwarded report when the error is uncaught", async () => {
      const { db, forwarded, causes, worker } = site("throw");
      const { ctx: c, settled } = ctx();
      const request = new Request("https://site.example/contact") as unknown as IncomingRequest;
      const thrown = await Promise.resolve(worker.fetch!(request, { DB: db }, c)).then(
        () => undefined,
        (err: unknown) => err as Error,
      );
      await settled();
      // The runtime records what's re-thrown, so it's the copy without values.
      expect(thrown?.message).toMatch(/^Failed query: insert into inquiries\. Cause: /);
      expectNoPii(`${thrown?.message}\n${thrown?.stack}`);
      // So is the cause a sink such as an error tracker reads frames from.
      expect(causes).toEqual([thrown]);
      const rows = await listIncidents(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "fetch",
        name: "DrizzleQueryError",
        message: expect.stringMatching(
          /^Failed query: insert into inquiries\. Cause: .*UNIQUE constraint failed: inquiries\.email/,
        ),
      });
      expectNoPii(JSON.stringify(rows));
      expect(forwarded).toHaveLength(1);
      expectNoPii(forwarded[0]!);
    });

    it("stay out of the log line, the incident row, and the forwarded report when it degrades", async () => {
      const { db, forwarded, causes, worker } = site("degrade");
      const { ctx: c, settled } = ctx();
      const request = new Request("https://site.example/contact") as unknown as IncomingRequest;
      const response = await worker.fetch!(request, { DB: db }, c);
      expect(response.status).toBe(200);
      await settled();
      const lines = error.mock.calls.map((args) => args.map(String).join(" "));
      expect(lines.some((line) => line.startsWith("[louise] degraded forms.inquiry: "))).toBe(true);
      for (const line of lines) expectNoPii(line);
      const rows = await listIncidents(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "degraded", name: "forms.inquiry" });
      expectNoPii(JSON.stringify(rows));
      expect(forwarded).toHaveLength(1);
      expectNoPii(forwarded[0]!);
      const cause = causes[0] as Error;
      expectNoPii(`${cause.message}\n${cause.stack}`);
    });
  });
});

describe("incidentsRoute", () => {
  const editor: EditorSession = {
    userId: "u1",
    email: "alex@example.com",
    name: "Alex",
    role: "admin",
  };
  const ORIGIN = "https://site.example";
  const call = (
    route: ReturnType<typeof incidentsRoute>,
    db: D1Database,
    path: string,
    init: RequestInit = {},
  ) => route(new Request(`${ORIGIN}${path}`, init), { DB: db }, {} as ExecutionContext);

  async function seeded() {
    const d1 = sqliteD1();
    const open = await upsertIncident(d1.db, report());
    const closed = await upsertIncident(d1.db, report({ cause: new TypeError("gone") }));
    await resolveIncident(d1.db, closed.fingerprint);
    return { ...d1, open, closed };
  }

  it("lists open incidents to an editor, and not to anyone else", async () => {
    const { db, open } = await seeded();
    const route = incidentsRoute({ resolveEditor: () => editor });
    const res = await call(route, db, "/api/louise/incidents");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    const body = (await res!.json()) as { incidents: { fingerprint: string }[] };
    expect(body.incidents.map((r) => r.fingerprint)).toEqual([open.fingerprint]);

    const anonymous = incidentsRoute({ resolveEditor: () => null });
    expect((await call(anonymous, db, "/api/louise/incidents"))?.status).toBe(401);
  });

  it("filters by status, and refuses an unknown one", async () => {
    const { db } = await seeded();
    const route = incidentsRoute({ resolveEditor: () => editor });
    const all = (await (await call(route, db, "/api/louise/incidents?status=all"))!.json()) as {
      incidents: unknown[];
    };
    expect(all.incidents).toHaveLength(2);
    expect((await call(route, db, "/api/louise/incidents?status=closed"))?.status).toBe(400);
  });

  it("reads one incident by fingerprint", async () => {
    const { db, open } = await seeded();
    const route = incidentsRoute({ resolveEditor: () => editor });
    const res = await call(route, db, `/api/louise/incidents/${open.fingerprint}`);
    expect(((await res!.json()) as { incident: { count: number } }).incident.count).toBe(1);
    expect((await call(route, db, "/api/louise/incidents/0000000000000000"))?.status).toBe(404);
    expect((await call(route, db, "/api/louise/incidents/not-a-fingerprint"))?.status).toBe(404);
  });

  it("resolves an incident from the same origin only", async () => {
    const { db, open } = await seeded();
    const route = incidentsRoute({ resolveEditor: () => editor });
    const path = `/api/louise/incidents/${open.fingerprint}/resolve`;

    const crossSite = await call(route, db, path, {
      method: "POST",
      headers: { origin: "https://other.example" },
    });
    expect(crossSite?.status).toBe(403);

    const res = await call(route, db, path, { method: "POST", headers: { origin: ORIGIN } });
    expect(res?.status).toBe(200);
    expect(
      ((await res!.json()) as { incident: { resolvedAt: string | null } }).incident.resolvedAt,
    ).not.toBeNull();

    const again = await call(route, db, path, { method: "POST", headers: { origin: ORIGIN } });
    expect(again?.status).toBe(404);
  });

  it("answers 405 to the wrong method, and passes on other paths", async () => {
    const { db, open } = await seeded();
    const route = incidentsRoute({ resolveEditor: () => editor, path: "/api/louise/incidents/" });
    expect((await call(route, db, "/api/louise/incidents", { method: "DELETE" }))?.status).toBe(
      405,
    );
    expect(
      (await call(route, db, `/api/louise/incidents/${open.fingerprint}`, { method: "POST" }))
        ?.status,
    ).toBe(405);
    expect(
      (await call(route, db, `/api/louise/incidents/${open.fingerprint}/resolve`))?.status,
    ).toBe(405);
    expect((await call(route, db, `/api/louise/incidents/${open.fingerprint}/other`))?.status).toBe(
      404,
    );
    expect(await call(route, db, "/api/louise/incidentsx")).toBeUndefined();
    expect(await call(route, db, "/api/louise/pages")).toBeUndefined();
  });
});
