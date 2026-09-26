import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import {
  ageCheck,
  d1Check,
  runStatusChecks,
  type StatusCheck,
  type StatusD1,
  statusRoute,
} from "../../src/core/editor/index.js";
import {
  composeWorker,
  isLouisePublicPath,
  LOUISE_STATUS_PATH,
} from "../../src/core/worker/index.js";

// #557: a route an outside probe can read, under the gated prefix but public
// (ADR 0012). 200 when every check passes, 503 otherwise, and a body that
// carries booleans and ages, never an error's text.

type Env = { DB?: StatusD1 };
const env: Env = {};
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const SITE = "https://site.example";
const req = (method = "GET", path = LOUISE_STATUS_PATH) =>
  new Request(`${SITE}${path}`, { method });

const pass: StatusCheck<Env> = () => true;
const fail: StatusCheck<Env> = () => false;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("statusRoute", () => {
  it("falls through (undefined) on a path it doesn't own", async () => {
    const r = statusRoute<Env>({ checks: { a: pass } });
    expect(await r(req("GET", "/api/louise/pages"), env, ctx)).toBeUndefined();
  });

  it("answers 200 with every check's result when all pass", async () => {
    const r = statusRoute<Env>({ checks: { db: pass, scan: () => ({ ok: true, ageMs: 1234.4 }) } });
    const res = await r(req(), env, ctx);
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({
      ok: true,
      checks: { db: { ok: true }, scan: { ok: true, ageMs: 1234 } },
    });
  });

  it("answers 200 with no checks: the Worker runs", async () => {
    const res = await statusRoute<Env>({ checks: {} })(req(), env, ctx);
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ ok: true, checks: {} });
  });

  it("answers 503 when one check fails, and still reports the others", async () => {
    const r = statusRoute<Env>({ checks: { db: pass, seed: fail } });
    const res = await r(req(), env, ctx);
    expect(res?.status).toBe(503);
    expect(await res!.json()).toEqual({
      ok: false,
      checks: { db: { ok: true }, seed: { ok: false } },
    });
  });

  it("answers 503 when a check hangs past the timeout", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let aborted = false;
    const hang: StatusCheck<Env> = (_env, signal) =>
      new Promise(() => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      });
    const r = statusRoute<Env>({ checks: { db: pass, provider: hang }, timeoutMs: 20 });
    const res = await r(req(), env, ctx);
    expect(res?.status).toBe(503);
    expect(await res!.json()).toEqual({
      ok: false,
      checks: { db: { ok: true }, provider: { ok: false } },
    });
    expect(aborted).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("answers 503 on a throw, logs the error, and keeps its text out of the body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "D1_ERROR: no such table: secret_rows at /srv/worker.js:42";
    const r = statusRoute<Env>({
      checks: {
        db: () => {
          throw new Error(secret);
        },
        kv: async () => {
          throw new Error(secret);
        },
      },
    });
    const res = await r(req(), env, ctx);
    expect(res?.status).toBe(503);
    const text = await res!.text();
    expect(JSON.parse(text)).toEqual({
      ok: false,
      checks: { db: { ok: false }, kv: { ok: false } },
    });
    expect(text).not.toMatch(/secret|D1_ERROR|worker\.js|Error/);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("counts anything but true or { ok: true } as a failure", async () => {
    const r = statusRoute<Env>({
      checks: {
        a: () => "yes" as never,
        b: () => ({ ok: "true" }) as never,
        c: () => null as never,
      },
    });
    const res = await r(req(), env, ctx);
    expect(res?.status).toBe(503);
    expect(await res!.json()).toEqual({
      ok: false,
      checks: { a: { ok: false }, b: { ok: false }, c: { ok: false } },
    });
  });

  it("sets Cache-Control: no-store on 200, 503, and 405", async () => {
    const ok = await statusRoute<Env>({ checks: { a: pass } })(req(), env, ctx);
    const down = await statusRoute<Env>({ checks: { a: fail } })(req(), env, ctx);
    const post = await statusRoute<Env>({ checks: { a: pass } })(req("POST"), env, ctx);
    expect(ok?.headers.get("cache-control")).toBe("no-store");
    expect(down?.headers.get("cache-control")).toBe("no-store");
    expect(post?.status).toBe(405);
    expect(post?.headers.get("allow")).toBe("GET, HEAD");
    expect(post?.headers.get("cache-control")).toBe("no-store");
  });

  it("answers HEAD with the status and no body", async () => {
    const ok = await statusRoute<Env>({ checks: { a: pass } })(req("HEAD"), env, ctx);
    const down = await statusRoute<Env>({ checks: { a: fail } })(req("HEAD"), env, ctx);
    expect(ok?.status).toBe(200);
    expect(down?.status).toBe(503);
    expect(down?.headers.get("cache-control")).toBe("no-store");
    expect(await down!.text()).toBe("");
  });

  it("runs the checks on every request by default", async () => {
    const check = vi.fn(() => true);
    const r = statusRoute<Env>({ checks: { a: check } });
    await r(req(), env, ctx);
    await r(req(), env, ctx);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("reuses a result for reuseMs, then runs the checks again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const check = vi.fn(() => true);
    const r = statusRoute<Env>({ checks: { a: check }, reuseMs: 10_000 });
    await r(req(), env, ctx);
    vi.setSystemTime(9_999);
    await r(req(), env, ctx);
    expect(check).toHaveBeenCalledOnce();
    vi.setSystemTime(10_000);
    await r(req(), env, ctx);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("is public: an anonymous probe gets through composeWorker's gate", async () => {
    const w = composeWorker<Env>({
      routes: [statusRoute<Env>({ checks: { a: pass } })],
      gate: { resolveEditor: (): EditorSession | null => null },
      fetch: async () => new Response("ssr"),
    });
    type IncomingRequest = Parameters<NonNullable<ExportedHandler["fetch"]>>[0];
    const res = await w.fetch!(req() as unknown as IncomingRequest, env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("mounts where framework middleware exempts it by default", () => {
    expect(isLouisePublicPath(LOUISE_STATUS_PATH)).toBe(true);
    expect(isLouisePublicPath(`${LOUISE_STATUS_PATH}/x`)).toBe(false);
  });
});

describe("runStatusChecks", () => {
  it("runs the checks at once, not one after another", async () => {
    const slow: StatusCheck<Env> = () =>
      new Promise((resolve) => setTimeout(() => resolve(true), 30));
    const started = Date.now();
    const report = await runStatusChecks(env, { a: slow, b: slow, c: slow });
    expect(report.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(80);
  });
});

describe("d1Check", () => {
  const d1 = (first: () => Promise<unknown>): StatusD1 => ({
    prepare: vi.fn(() => ({ first })),
  });

  it("passes when SELECT 1 returns a row", async () => {
    const db = d1(async () => ({ ok: 1 }));
    expect(await d1Check<Env>((e) => e.DB)({ DB: db }, new AbortController().signal)).toBe(true);
    expect(db.prepare).toHaveBeenCalledWith("SELECT 1 AS ok");
  });

  it("fails when the binding is missing or no row comes back", async () => {
    const signal = new AbortController().signal;
    expect(await d1Check<Env>((e) => e.DB)({}, signal)).toBe(false);
    expect(await d1Check<Env>((e) => e.DB)({ DB: d1(async () => null) }, signal)).toBe(false);
  });

  it("makes the route answer 503 when D1 throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = d1(async () => {
      throw new Error("D1_ERROR: network connection lost");
    });
    const res = await statusRoute<Env>({ checks: { db: d1Check((e) => e.DB) } })(
      req(),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(503);
    expect(await res!.text()).not.toContain("D1_ERROR");
  });
});

describe("ageCheck", () => {
  const HOUR = 60 * 60 * 1000;
  const signal = new AbortController().signal;
  const at = (value: unknown) => ageCheck<Env>(() => value as never, 36 * HOUR);

  it("passes and reports the age for a recent timestamp, in any form", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    const twoHoursAgo = Date.now() - 2 * HOUR;
    for (const value of [twoHoursAgo, new Date(twoHoursAgo), new Date(twoHoursAgo).toISOString()]) {
      expect(await at(value)(env, signal)).toEqual({ ok: true, ageMs: 2 * HOUR });
    }
  });

  it("fails an old timestamp and still reports its age", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(100 * HOUR);
    expect(await at(0)(env, signal)).toEqual({ ok: false, ageMs: 100 * HOUR });
  });

  it("passes at exactly the limit, and counts a future timestamp as age 0", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(100 * HOUR);
    expect(await at(64 * HOUR)(env, signal)).toEqual({ ok: true, ageMs: 36 * HOUR });
    expect(await at(101 * HOUR)(env, signal)).toEqual({ ok: true, ageMs: 0 });
  });

  it("fails with no age when there's no timestamp or it can't be read", async () => {
    for (const value of [null, undefined, "", "not a date", Number.NaN]) {
      expect(await at(value)(env, signal), String(value)).toEqual({ ok: false });
    }
  });

  it("puts the age in the route's body", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10 * HOUR);
    const r = statusRoute<Env>({
      checks: { scan: ageCheck(async () => 9 * HOUR, 36 * HOUR), catalog: at(null) },
    });
    const res = await r(req(), env, ctx);
    expect(res?.status).toBe(503);
    expect(await res!.json()).toEqual({
      ok: false,
      checks: { scan: { ok: true, ageMs: HOUR }, catalog: { ok: false } },
    });
  });
});
