import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateAuthSchemaSql,
  getLouiseAuth,
  type LouiseAuth,
  type LouiseAuthEnv,
} from "../../src/core/auth/index.js";

// Better Auth's admin plugin serves user administration at
// `<basePath>/admin/*`, guarded only by the session user's role. An editor
// instance keeps it; a customer instance leaves it off unless the site sets
// `customers.adminEndpoints`. Against real SQLite, with the schema the
// generator emits, so the role and ban columns are the ones a site has.

/** A D1 double over in-memory SQLite, with the auth schema applied. */
function sqliteD1(schemaSql: string) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schemaSql);
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
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results;
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}

const ORIGIN = "http://localhost:4321";
const authBase = {
  rpName: "Test Studio",
  mailFrom: { email: "hello@example.com" },
  renderMagicLinkEmail: () => ({ subject: "", html: "", text: "" }),
};
const portal = {
  basePath: "/api/portal-auth",
  cookiePrefix: "portal",
  tablePrefix: "portal_",
  resolveAdmins: () => [],
};

function envFor(db: D1Database): LouiseAuthEnv {
  return { DB: db, SESSION_SECRET: "s".repeat(40) } as unknown as LouiseAuthEnv;
}

/** The `name=value` pairs a response sets, as one `Cookie` header. */
function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
}

const post = (auth: LouiseAuth, path: string, body: unknown, cookie = "") =>
  auth.handler(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const get = (auth: LouiseAuth, path: string, cookie: string) =>
  auth.handler(new Request(`${ORIGIN}${path}`, { headers: { cookie } }));

/** A customer instance over a fresh database, and a signed-in customer. */
async function customerInstance(customers: Record<string, unknown> = {}) {
  const { sqlite, db } = sqliteD1(
    generateAuthSchemaSql({ customers: true, tablePrefix: portal.tablePrefix }),
  );
  const auth = await getLouiseAuth(envFor(db), ORIGIN, {
    ...authBase,
    ...portal,
    customers,
  } as never);
  const signUp = await post(auth, `${portal.basePath}/sign-up/email`, {
    email: "quinn@example.com",
    password: "correct-horse-battery",
    name: "Quinn",
  });
  expect(signUp.status).toBe(200);
  return { sqlite, auth, cookie: cookiesFrom(signUp) };
}

describe("admin endpoints on a customer instance", () => {
  it("aren't mounted by default, even for a customer whose role is admin", async () => {
    const { sqlite, auth, cookie } = await customerInstance();
    sqlite.exec(`UPDATE "portal_user" SET "role" = 'admin'`);
    for (const path of ["list-users", "get-user?id=x"]) {
      const res = await get(auth, `${portal.basePath}/admin/${path}`, cookie);
      expect(res.status).toBe(404);
    }
    for (const [path, body] of [
      ["set-role", { userId: "x", role: "admin" }],
      ["impersonate-user", { userId: "x" }],
      ["ban-user", { userId: "x" }],
      ["remove-user", { userId: "x" }],
    ] as const) {
      const res = await post(auth, `${portal.basePath}/admin/${path}`, body, cookie);
      expect(res.status).toBe(404);
    }
  });

  it("still gives a new account its role, and the session user carries it", async () => {
    const { sqlite, auth, cookie } = await customerInstance();
    const row = sqlite.prepare(`SELECT "role", "banned" FROM "portal_user"`).get() as {
      role: string;
      banned: number;
    };
    expect(row).toEqual({ role: "user", banned: 0 });
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user?.role).toBe("user");
  });

  it("doesn't let a customer set their own role", async () => {
    const { sqlite, auth, cookie } = await customerInstance();
    await post(auth, `${portal.basePath}/update-user`, { role: "admin", name: "Q" }, cookie);
    const row = sqlite.prepare(`SELECT "role" FROM "portal_user"`).get() as { role: string };
    expect(row.role).toBe("user");
  });

  it("still refuses a banned customer a session, until the ban expires", async () => {
    const { sqlite, auth } = await customerInstance();
    const signIn = () =>
      post(auth, `${portal.basePath}/sign-in/email`, {
        email: "quinn@example.com",
        password: "correct-horse-battery",
      });
    sqlite.exec(`UPDATE "portal_user" SET "banned" = 1`);
    const banned = await signIn();
    expect(banned.status).toBe(403);
    expect(((await banned.json()) as { code?: string }).code).toBe("BANNED_USER");
    sqlite.exec(`UPDATE "portal_user" SET "banExpires" = '2000-01-01T00:00:00.000Z'`);
    expect((await signIn()).status).toBe(200);
  });

  it("are mounted when the site opts in with customers.adminEndpoints", async () => {
    const { sqlite, auth, cookie } = await customerInstance({ adminEndpoints: true });
    expect((await get(auth, `${portal.basePath}/admin/list-users`, cookie)).status).toBe(403);
    sqlite.exec(`UPDATE "portal_user" SET "role" = 'admin'`);
    const res = await get(auth, `${portal.basePath}/admin/list-users`, cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(1);
  });
});

describe("admin endpoints on an editor instance", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stay mounted for an editor", async () => {
    const { db } = sqliteD1(generateAuthSchemaSql());
    const auth = await getLouiseAuth(envFor(db), ORIGIN, {
      ...authBase,
      resolveAdmins: () => ["owner@example.com"],
    } as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ask = await post(auth, "/api/auth/sign-in/magic-link", { email: "owner@example.com" });
    expect(ask.status).toBe(200);
    const link = String(log.mock.calls.at(-1)?.[0]).split(": ").at(-1) ?? "";
    const verify = await auth.handler(new Request(link));
    const cookie = cookiesFrom(verify);
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user?.role).toBe("admin");
    const res = await get(auth, "/api/auth/admin/list-users", cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(1);
  });
});
