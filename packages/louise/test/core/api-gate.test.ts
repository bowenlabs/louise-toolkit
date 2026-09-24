import { describe, expect, it, vi } from "vitest";
import { vitalsRoute } from "../../src/core/analytics/index.js";
import type { EditorSession } from "../../src/core/auth/index.js";
import { formRoute, inquiriesRoute } from "../../src/core/editor/index.js";
import { inquiries } from "../../src/core/db/index.js";
import { defineForm } from "../../src/core/forms/index.js";
import { isPublicRoute } from "../../src/core/worker/gate.js";
import {
  composeWorker,
  isLouisePublicPath,
  LOUISE_FORMS_PATH,
  LOUISE_VITALS_PATH,
  louiseApiGate,
  publicRoute,
  type WorkerRoute,
} from "../../src/core/worker/index.js";

// ADR 0012: under /api/louise a request must be an editor's unless it's headed
// for a route that declared itself public—whether or not the route it lands
// on remembered its own guard.

type IncomingRequest = Parameters<NonNullable<ExportedHandler["fetch"]>>[0];
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const SITE = "https://site.example";
const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };

const req = (path: string, init: RequestInit & { origin?: string | null } = {}) => {
  const { origin = SITE, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (origin) headers.set("origin", origin);
  return new Request(`${SITE}${path}`, { ...rest, headers }) as unknown as IncomingRequest;
};

/** A site route under the prefix that forgot its guard: answers anyone. */
const forgetful: WorkerRoute = (request) =>
  new URL(request.url).pathname === "/api/louise/forgot"
    ? Response.json({ secret: "rows" })
    : undefined;

function worker(opts: { signedIn: boolean; routes?: WorkerRoute<never>[] }) {
  const fallback = vi.fn(async () => new Response("astro"));
  const resolveEditor = vi.fn(() => (opts.signedIn ? editor : null));
  const w = composeWorker({
    routes: (opts.routes ?? [forgetful]) as WorkerRoute[],
    fetch: fallback,
    gate: { resolveEditor },
  });
  const call = (r: IncomingRequest) => w.fetch!(r, {} as never, ctx);
  return { call, fallback, resolveEditor };
}

describe("composeWorker({ gate }) — deny by default", () => {
  it("denies an anonymous request to a route that forgot its guard", async () => {
    const { call } = worker({ signedIn: false });
    const res = await call(req("/api/louise/forgot"));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("rows");
  });

  it("lets an editor through to the same route", async () => {
    const { call } = worker({ signedIn: true });
    expect(await (await call(req("/api/louise/forgot"))).json()).toEqual({ secret: "rows" });
  });

  it("401s an anonymous request for an unknown path, not 404 — no route enumeration", async () => {
    const { call, fallback } = worker({ signedIn: false });
    expect((await call(req("/api/louise/does-not-exist"))).status).toBe(401);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("gates the site's own framework routes under the prefix, then falls through", async () => {
    // Sites mount their own Astro API routes under /api/louise; those are
    // reached through the fallback, and only after the gate.
    const anon = worker({ signedIn: false });
    expect((await anon.call(req("/api/louise/crm/1"))).status).toBe(401);
    expect(anon.fallback).not.toHaveBeenCalled();
    const ed = worker({ signedIn: true });
    expect(await (await ed.call(req("/api/louise/crm/1"))).text()).toBe("astro");
  });

  it("403s a cross-origin write even with a session (CSRF)", async () => {
    const { call } = worker({ signedIn: true });
    const res = await call(
      req("/api/louise/forgot", { method: "POST", origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
  });

  it("origin-checks a WebSocket upgrade, though it is a GET", async () => {
    // Method alone would wave it through, and a cross-site page can open a
    // socket carrying the editor's cookie.
    const { call } = worker({ signedIn: true });
    const upgrade = { upgrade: "websocket", connection: "Upgrade" };
    const hijack = req("/api/louise/realtime/pages/1", {
      headers: upgrade,
      origin: "https://evil.example",
    });
    expect((await call(hijack)).status).toBe(403);
    const own = req("/api/louise/realtime/pages/1", { headers: upgrade });
    expect((await call(own)).status).not.toBe(403);
  });

  it("leaves a same-origin read alone without an Origin header", async () => {
    const { call } = worker({ signedIn: true });
    expect((await call(req("/api/louise/forgot", { origin: null }))).status).toBe(200);
  });

  it("matches the prefix on a segment boundary", async () => {
    const lookalike: WorkerRoute = (r) =>
      new URL(r.url).pathname === "/api/louise-shop/x" ? new Response("open") : undefined;
    const { call, resolveEditor } = worker({ signedIn: false, routes: [lookalike] });
    expect(await (await call(req("/api/louise-shop/x"))).text()).toBe("open");
    expect((await call(req("/api/louise"))).status).toBe(401);
    expect(resolveEditor).toHaveBeenCalledTimes(1);
  });

  it("never gates a path outside the prefix", async () => {
    const outside: WorkerRoute = (r) =>
      new URL(r.url).pathname === "/media/a.jpg" ? new Response("img") : undefined;
    const { call, resolveEditor } = worker({ signedIn: false, routes: [outside] });
    expect(await (await call(req("/media/a.jpg"))).text()).toBe("img");
    expect(resolveEditor).not.toHaveBeenCalled();
  });
});

describe("publicRoute", () => {
  it("answers an anonymous request under the prefix", async () => {
    const beacon = publicRoute((r) =>
      new URL(r.url).pathname === "/api/louise/beacon"
        ? new Response(null, { status: 204 })
        : undefined,
    );
    const { call, resolveEditor } = worker({ signedIn: false, routes: [forgetful, beacon] });
    expect((await call(req("/api/louise/beacon", { method: "POST" }))).status).toBe(204);
    // Tried before the gate, so no session lookup for a public hit.
    expect(resolveEditor).not.toHaveBeenCalled();
  });

  it("marks the toolkit's own public routes: forms and vitals", async () => {
    const form = defineForm({
      name: "contact",
      fields: { email: { type: "email", label: "Email", required: true } },
    });
    expect(isPublicRoute(formRoute({ form }))).toBe(true);
    expect(isPublicRoute(vitalsRoute({ dataset: () => ({ writeDataPoint() {} }) }))).toBe(true);
    expect(isPublicRoute(forgetful)).toBe(false);

    // And end to end: an anonymous submission reaches the form's own
    // validation (422), not the gate (401).
    const { call } = worker({ signedIn: false, routes: [forgetful, formRoute({ form })] });
    const res = await call(
      req("/api/louise/forms/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nope" }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe("one session lookup per request", () => {
  it("the gate and the route's own guard share it", async () => {
    const resolveEditor = vi.fn(async () => editor);
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }),
    } as unknown as D1Database;
    const w = composeWorker({
      routes: [inquiriesRoute({ table: inquiries, resolveEditor })] as WorkerRoute[],
      fetch: async () => new Response("astro"),
      gate: { resolveEditor },
    });
    const res = await w.fetch!(req("/api/louise/inquiries"), { DB: db } as never, ctx);
    expect(res.status).toBe(200);
    expect(resolveEditor).toHaveBeenCalledTimes(1);
  });
});

describe("route response headers", () => {
  it("adds the baseline security headers the middleware never sees", async () => {
    const { call } = worker({ signedIn: true });
    const res = await call(req("/api/louise/forgot"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps a header the route set, and only forces no-store on gated responses", async () => {
    const own: WorkerRoute = (r) => {
      const p = new URL(r.url).pathname;
      if (p === "/api/louise/cached")
        return new Response("x", { headers: { "cache-control": "private, max-age=60" } });
      if (p === "/img")
        return new Response("x", { headers: { "content-security-policy": "sandbox" } });
      return undefined;
    };
    const { call } = worker({ signedIn: true, routes: [own] });
    expect((await call(req("/api/louise/cached"))).headers.get("cache-control")).toBe(
      "private, max-age=60",
    );
    const img = await call(req("/img"));
    expect(img.headers.get("content-security-policy")).toBe("sandbox");
    expect(img.headers.get("cache-control")).toBeNull();
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rewraps a response whose headers are immutable instead of throwing", async () => {
    const redirect: WorkerRoute = (r) =>
      new URL(r.url).pathname === "/go" ? Response.redirect(`${SITE}/there`, 302) : undefined;
    const { call } = worker({ signedIn: false, routes: [redirect] });
    const res = await call(req("/go"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${SITE}/there`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("hands a 101 WebSocket response back untouched", async () => {
    // Node's Response can't carry a 101; the Workers one can, with its socket.
    const socket = { status: 101, headers: new Headers(), webSocket: {} } as unknown as Response;
    const { call } = worker({ signedIn: true, routes: [() => socket] });
    expect(await call(req("/api/louise/realtime/pages/1"))).toBe(socket);
  });

  it("skips the transport headers on localhost, as the middleware does", async () => {
    const w = composeWorker({
      routes: [forgetful],
      fetch: async () => new Response(),
      gate: { resolveEditor: () => editor },
    });
    const local = new Request(
      "http://localhost:4321/api/louise/forgot",
    ) as unknown as IncomingRequest;
    const res = await w.fetch!(local, {} as never, ctx);
    expect(res.headers.get("strict-transport-security")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("louiseApiGate (standalone)", () => {
  it("returns null outside the prefix and for a permitted request", async () => {
    const config = { resolveEditor: () => editor };
    expect(await louiseApiGate(new Request(`${SITE}/about`), {}, config)).toBeNull();
    expect(await louiseApiGate(new Request(`${SITE}/api/louise/pages`), {}, config)).toBeNull();
  });

  it("honours a custom prefix", async () => {
    const config = { resolveEditor: () => null, prefix: "/admin/api/" };
    expect((await louiseApiGate(new Request(`${SITE}/admin/api/x`), {}, config))?.status).toBe(401);
    expect(await louiseApiGate(new Request(`${SITE}/api/louise/x`), {}, config)).toBeNull();
  });
});

describe("composeWorker without gate", () => {
  it("is unchanged: no gate, no added headers", async () => {
    const w = composeWorker({ routes: [forgetful], fetch: async () => new Response() });
    const res = await w.fetch!(req("/api/louise/forgot"), {} as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBeNull();
  });
});

describe("isLouisePublicPath", () => {
  it("is exactly where formRoute and vitalsRoute mount by default", async () => {
    // The routes build their default paths from the same constants, so a
    // middleware exempting these paths can't drift from where they answer.
    const form = defineForm({ name: "contact", fields: {} });
    const hit = await formRoute({ form })(
      new Request(`${SITE}${LOUISE_FORMS_PATH}/contact`, { method: "GET" }),
      {} as never,
      ctx,
    );
    expect(hit?.status).toBe(405); // matched the path, refused the method
    expect(isLouisePublicPath(`${LOUISE_FORMS_PATH}/contact`)).toBe(true);
    expect(isLouisePublicPath(LOUISE_VITALS_PATH)).toBe(true);
    for (const path of [
      "/api/louise/forms",
      "/api/louise/formsx/a",
      "/api/louise/vitals/x",
      "/api/louise/pages",
    ]) {
      expect(isLouisePublicPath(path), path).toBe(false);
    }
  });
});
