import { describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import {
  createEditSession,
  type EditSessionConfig,
  parseClientMessage,
  presenceMessage,
  REALTIME_PROTOCOL_VERSION,
  realtimeRoute,
} from "../../src/core/realtime/index.js";

const noopD1 = { prepare: () => ({ bind: () => ({}) }) } as unknown as D1Database;
const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ada", role: "admin" };
const ctx = {} as ExecutionContext;

// ── Route ────────────────────────────────────────────────────────────────────

/** A DO namespace whose stub records the forwarded upgrade request. */
function fakeNamespace() {
  let forwarded: Request | undefined;
  let namedId: string | undefined;
  const ns = {
    idFromName: (name: string) => {
      namedId = name;
      return { name } as unknown as DurableObjectId;
    },
    get: () =>
      ({
        // A real DO answers 101 (Switching Protocols); undici's Response can't
        // represent that outside the Workers runtime, so the fake returns 200 and
        // records the forwarded upgrade instead.
        fetch: async (req: Request) => {
          forwarded = req;
          return new Response(null, { status: 200 });
        },
      }) as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
  return { ns, forwarded: () => forwarded, namedId: () => namedId };
}

const route = (opts: { editor?: EditorSession | null; ns?: DurableObjectNamespace | undefined }) =>
  realtimeRoute<{ DB: D1Database }>({
    resolveEditor: () => ("editor" in opts ? (opts.editor ?? null) : editor),
    namespace: () => ("ns" in opts ? opts.ns : fakeNamespace().ns),
  });

const wsReq = (path: string, upgrade = true, origin = "https://site.example") =>
  new Request(`https://site.example${path}`, {
    headers: {
      origin,
      ...(upgrade ? { upgrade: "websocket" } : {}),
    },
  });

const env = { DB: noopD1 };

describe("realtimeRoute", () => {
  it("falls through on paths it doesn't own", async () => {
    const r = route({});
    expect(await r(wsReq("/other"), env, ctx)).toBeUndefined();
    expect(await r(wsReq("/api/louise/realtime"), env, ctx)).toBeUndefined();
    expect(await r(wsReq("/api/louise/realtime/pages"), env, ctx)).toBeUndefined();
    expect(await r(wsReq("/api/louise/realtime/pages/1/extra"), env, ctx)).toBeUndefined();
  });

  it("426s a non-WebSocket request", async () => {
    const res = (await route({})(
      wsReq("/api/louise/realtime/pages/1", false),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(426);
  });

  it("503s when the DO namespace binding is absent", async () => {
    const res = (await route({ ns: undefined })(
      wsReq("/api/louise/realtime/pages/1"),
      env,
      ctx,
    )) as Response;
    expect(res.status).toBe(503);
  });

  it("denies an unauthenticated upgrade", async () => {
    const res = (await route({ editor: null })(
      wsReq("/api/louise/realtime/pages/1"),
      env,
      ctx,
    )) as Response;
    expect([401, 403]).toContain(res.status);
  });

  it("400s a non-integer id", async () => {
    const res = (await route({})(wsReq("/api/louise/realtime/pages/abc"), env, ctx)) as Response;
    expect(res.status).toBe(400);
  });

  it("forwards to the per-page DO stamping the full server-resolved editor identity", async () => {
    const fake = fakeNamespace();
    const r = realtimeRoute<{ DB: D1Database }>({
      resolveEditor: () => editor,
      namespace: () => fake.ns,
    });
    const res = (await r(wsReq("/api/louise/realtime/pages/42"), env, ctx)) as Response;
    expect(res.status).toBe(200); // the stub's response is returned verbatim (101 in prod)
    expect(fake.namedId()).toBe("pages:42"); // one DO per page
    const fwd = fake.forwarded();
    // The original request is forwarded (upgrade preserved), re-pointed at a URL
    // carrying the server-resolved identity — id/name AND email/role so the DO can
    // attribute the coalesced flush to a complete EditorSession.
    expect(fwd?.headers.get("upgrade")).toBe("websocket");
    const params = new URL(fwd?.url ?? "").searchParams;
    expect(params.get("_eid")).toBe("u1");
    expect(params.get("_ename")).toBe("Ada");
    expect(params.get("_eemail")).toBe("e@x.com");
    expect(params.get("_erole")).toBe("admin");
  });
});

// ── Session logic (fake ctx + storage + sockets) ─────────────────────────────

const mkSession = (userId: string, name: string): EditorSession => ({
  userId,
  email: `${userId}@x.com`,
  name,
  role: "admin",
});

/** A fake hibernatable socket recording sends + carrying a mutable attachment. */
function socket(session: EditorSession) {
  const sent: string[] = [];
  let attached: EditorSession = session;
  const ws = {
    send: (m: string) => sent.push(m),
    close: vi.fn(),
    serializeAttachment: (v: EditorSession) => {
      attached = v;
    },
    deserializeAttachment: () => attached,
  } as unknown as WebSocket;
  return { ws, sent, msgs: () => sent.map((m) => JSON.parse(m) as { t: string }) };
}

/** In-memory `DurableObjectStorage` — the transactional KV + alarm surface the
 *  session uses. */
function fakeStorage() {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    get: async <T>(k: string) => map.get(k) as T | undefined,
    put: async (k: string, v: unknown) => {
      map.set(k, v);
    },
    delete: async (k: string | string[]) => {
      if (Array.isArray(k)) {
        let n = 0;
        for (const key of k) if (map.delete(key)) n++;
        return n;
      }
      return map.delete(k);
    },
    list: async <T>(opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? "";
      const out = new Map<string, T>();
      for (const [k, v] of map) if (k.startsWith(prefix)) out.set(k, v as T);
      return out;
    },
    getAlarm: async () => alarm,
    setAlarm: async (t: number | Date) => {
      alarm = typeof t === "number" ? t : t.getTime();
    },
    deleteAlarm: async () => {
      alarm = null;
    },
  };
  return { storage, map, alarm: () => alarm };
}

function build(sockets: WebSocket[], config?: Partial<EditSessionConfig>) {
  const s = fakeStorage();
  const ctxState = {
    acceptWebSocket: vi.fn(),
    getWebSockets: () => sockets,
    storage: s.storage,
  } as unknown as DurableObjectState;
  const persist = vi.fn(
    async (
      _snapshot: Record<string, unknown>,
      _editor: EditorSession,
      _target: { slug: string; id: number },
    ) => {},
  );
  const session = createEditSession(ctxState, {
    fields: ["title", "body", "sections"],
    lockFields: ["body"],
    persist,
    flushMs: 10_000,
    now: () => 1000,
    ...config,
  });
  return { session, storage: s, persist };
}

const parse = (raw: string) =>
  JSON.parse(raw) as {
    t: string;
    peers?: { id: string; name: string }[];
    you?: { id: string; name: string };
    snapshot?: Record<string, unknown>;
    locks?: Record<string, string>;
    rev?: number;
    field?: string;
    value?: unknown;
    from?: string;
  };

describe("createEditSession — presence + handshake", () => {
  it("answers `hello` with a welcome carrying you, peers, snapshot and locks", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const b = socket(mkSession("u2", "Bo"));
    const { session, storage } = build([a.ws, b.ws]);
    storage.map.set("field:title", "Hello");
    storage.map.set("lock:body", "u2");

    await session.webSocketMessage(a.ws, JSON.stringify({ t: "hello" }));

    expect(a.sent).toHaveLength(1);
    const msg = parse(a.sent[0]);
    expect(msg.t).toBe("welcome");
    expect(msg.you).toEqual({ id: "u1", name: "Ada" });
    expect(msg.peers).toEqual([
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Bo" },
    ]);
    expect(msg.snapshot).toEqual({ title: "Hello" });
    expect(msg.locks).toEqual({ body: "u2" });
  });

  it("answers `ping` with a pong and ignores unknown frames", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const { session } = build([a.ws]);

    await session.webSocketMessage(a.ws, JSON.stringify({ t: "ping" }));
    await session.webSocketMessage(a.ws, JSON.stringify({ t: "bogus" }));
    await session.webSocketMessage(a.ws, "not json");

    expect(a.sent).toHaveLength(1);
    expect(parse(a.sent[0]).t).toBe("pong");
  });

  it("re-broadcasts presence + locks to the remaining sockets on close, freeing the leaver's locks", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const b = socket(mkSession("u2", "Bo"));
    const { session, storage } = build([a.ws, b.ws]);
    storage.map.set("lock:body", "u1"); // the leaver holds a lock

    await session.webSocketClose(a.ws, 1000, "bye", true);

    expect(a.ws.close).toHaveBeenCalled();
    expect(a.sent).toHaveLength(0); // the leaver got nothing
    // b got a presence frame (only b) and a locks frame (now empty — a's freed).
    const bMsgs = b.msgs();
    expect(bMsgs.map((m) => m.t)).toEqual(["presence", "locks"]);
    expect(parse(b.sent[0])).toMatchObject({ t: "presence", peers: [{ id: "u2", name: "Bo" }] });
    expect(parse(b.sent[1])).toMatchObject({ t: "locks", locks: {} });
    expect(storage.map.has("lock:body")).toBe(false);
  });

  it("returns 426 for a non-upgrade fetch", async () => {
    const { session } = build([]);
    const res = await session.fetch(new Request("https://do/", { headers: {} }));
    expect(res.status).toBe(426);
  });
});

describe("createEditSession — change broadcast", () => {
  it("records a structured change, acks the sender, broadcasts to peers, and arms the alarm", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const b = socket(mkSession("u2", "Bo"));
    const { session, storage } = build([a.ws, b.ws]);

    await session.webSocketMessage(
      a.ws,
      JSON.stringify({ t: "change", field: "title", value: "Hi" }),
    );

    expect(storage.map.get("field:title")).toBe("Hi");
    expect(storage.map.get("rev")).toBe(1);
    expect(storage.map.get("lastWriter")).toMatchObject({ userId: "u1" });
    expect(storage.alarm()).toBe(1000 + 10_000); // armed at now()+flushMs

    // sender gets an ack; peer gets the change (with the author id)
    expect(parse(a.sent[0])).toEqual({ v: REALTIME_PROTOCOL_VERSION, t: "ack", rev: 1 });
    expect(parse(b.sent[0])).toMatchObject({
      t: "change",
      field: "title",
      value: "Hi",
      rev: 1,
      from: "u1",
    });
  });

  it("drops a change for a field outside the allowlist", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const b = socket(mkSession("u2", "Bo"));
    const { session, storage } = build([a.ws, b.ws]);

    await session.webSocketMessage(
      a.ws,
      JSON.stringify({ t: "change", field: "secretFlag", value: true }),
    );

    expect(storage.map.has("field:secretFlag")).toBe(false);
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(0);
    expect(storage.alarm()).toBeNull();
  });

  it("keeps a monotonic rev across successive changes", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const { session, storage } = build([a.ws]);
    await session.webSocketMessage(
      a.ws,
      JSON.stringify({ t: "change", field: "title", value: "1" }),
    );
    await session.webSocketMessage(
      a.ws,
      JSON.stringify({ t: "change", field: "title", value: "2" }),
    );
    expect(storage.map.get("rev")).toBe(2);
    expect(storage.map.get("field:title")).toBe("2");
  });
});

describe("createEditSession — rich-text soft-lock", () => {
  it("grants a claim and broadcasts the held locks to everyone", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const b = socket(mkSession("u2", "Bo"));
    const { session, storage } = build([a.ws, b.ws]);

    await session.webSocketMessage(a.ws, JSON.stringify({ t: "claim", field: "body" }));

    expect(storage.map.get("lock:body")).toBe("u1");
    expect(parse(a.sent[0])).toMatchObject({ t: "locks", locks: { body: "u1" } });
    expect(parse(b.sent[0])).toMatchObject({ t: "locks", locks: { body: "u1" } });
  });

  it("only broadcasts a lock message to the asker when the field is already held", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const b = socket(mkSession("u2", "Bo"));
    const { session, storage } = build([a.ws, b.ws]);
    storage.map.set("lock:body", "u1");

    await session.webSocketMessage(b.ws, JSON.stringify({ t: "claim", field: "body" }));

    expect(storage.map.get("lock:body")).toBe("u1"); // unchanged
    expect(parse(b.sent[0])).toMatchObject({ t: "locks", locks: { body: "u1" } });
    expect(a.sent).toHaveLength(0); // the holder is not re-notified
  });

  it("drops a lock-guarded change from a non-holder, and does NOT fan the holder's change out", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const b = socket(mkSession("u2", "Bo"));
    const { session, storage } = build([a.ws, b.ws]);
    storage.map.set("lock:body", "u1"); // Ada holds the body lock

    // Bo (non-holder) is blocked
    await session.webSocketMessage(
      b.ws,
      JSON.stringify({ t: "change", field: "body", value: "x" }),
    );
    expect(storage.map.has("field:body")).toBe(false);
    expect(b.sent).toHaveLength(0);

    // Ada (holder) is allowed, persisted + acked, but her raw rich-text is NOT broadcast to Bo
    await session.webSocketMessage(
      a.ws,
      JSON.stringify({ t: "change", field: "body", value: "<p>hi</p>" }),
    );
    expect(storage.map.get("field:body")).toBe("<p>hi</p>");
    expect(parse(a.sent[0])).toMatchObject({ t: "ack" });
    expect(b.sent).toHaveLength(0);
  });

  it("releases only the holder's lock", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const b = socket(mkSession("u2", "Bo"));
    const { session, storage } = build([a.ws, b.ws]);
    storage.map.set("lock:body", "u1");

    // a non-holder release is a no-op
    await session.webSocketMessage(b.ws, JSON.stringify({ t: "release", field: "body" }));
    expect(storage.map.get("lock:body")).toBe("u1");

    await session.webSocketMessage(a.ws, JSON.stringify({ t: "release", field: "body" }));
    expect(storage.map.has("lock:body")).toBe(false);
  });
});

describe("createEditSession — coalesced flush (alarm)", () => {
  it("flushes the coalesced dirty snapshot through persist and clears it on success", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const { session, storage, persist } = build([a.ws]);
    storage.map.set("target", { slug: "pages", id: 42 });
    await session.webSocketMessage(
      a.ws,
      JSON.stringify({ t: "change", field: "title", value: "Hi" }),
    );
    await session.webSocketMessage(
      a.ws,
      JSON.stringify({ t: "change", field: "sections", value: [1, 2] }),
    );

    await storage.storage.deleteAlarm(); // model: the runtime clears the alarm before firing
    await session.alarm();

    expect(persist).toHaveBeenCalledTimes(1);
    const [snapshot, editorArg, target] = persist.mock.calls[0];
    expect(snapshot).toEqual({ title: "Hi", sections: [1, 2] });
    expect(editorArg).toMatchObject({ userId: "u1", email: "u1@x.com", role: "admin" });
    expect(target).toEqual({ slug: "pages", id: 42 });
    // flushed fields are cleared; nothing left to flush, so no re-arm
    expect([...storage.map.keys()].some((k) => k.startsWith("field:"))).toBe(false);
    expect(storage.alarm()).toBeNull();
  });

  it("leaves the snapshot dirty and re-arms when persist throws", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const persist = vi.fn(async () => {
      throw new Error("D1 down");
    });
    const { session, storage } = build([a.ws], { persist });
    storage.map.set("target", { slug: "pages", id: 42 });
    await session.webSocketMessage(
      a.ws,
      JSON.stringify({ t: "change", field: "title", value: "Hi" }),
    );

    await storage.storage.deleteAlarm(); // model: the runtime clears the alarm before firing
    await session.alarm();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(storage.map.get("field:title")).toBe("Hi"); // still dirty
    expect(storage.alarm()).toBe(1000 + 10_000); // re-armed for a retry
  });

  it("is a no-op with nothing dirty", async () => {
    const a = socket(mkSession("u1", "Ada"));
    const { session, storage, persist } = build([a.ws]);
    storage.map.set("target", { slug: "pages", id: 42 });
    await session.alarm();
    expect(persist).not.toHaveBeenCalled();
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("parseClientMessage / presenceMessage", () => {
  it("parses the full client protocol and rejects everything else", () => {
    expect(parseClientMessage(JSON.stringify({ t: "hello" }))?.t).toBe("hello");
    expect(parseClientMessage(JSON.stringify({ t: "ping" }))?.t).toBe("ping");
    expect(parseClientMessage(JSON.stringify({ t: "bye" }))?.t).toBe("bye");
    const change = parseClientMessage(
      JSON.stringify({ t: "change", field: "title", value: "x", rev: 3 }),
    );
    expect(change).toEqual({ t: "change", field: "title", value: "x", rev: 3 });
    expect(parseClientMessage(JSON.stringify({ t: "claim", field: "body" }))).toEqual({
      t: "claim",
      field: "body",
    });
    // a change/claim without a valid `field` is rejected
    expect(parseClientMessage(JSON.stringify({ t: "change", value: "x" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "claim" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "unknown" }))).toBeNull();
    expect(parseClientMessage("{bad json")).toBeNull();
    expect(parseClientMessage(new TextEncoder().encode('{"t":"ping"}').buffer)?.t).toBe("ping");
  });

  it("builds a versioned presence message from sockets", () => {
    const a = socket(mkSession("u1", "Ada"));
    const msg = presenceMessage([a.ws]);
    expect(msg).toEqual({
      v: REALTIME_PROTOCOL_VERSION,
      t: "presence",
      peers: [{ id: "u1", name: "Ada" }],
    });
  });
});
