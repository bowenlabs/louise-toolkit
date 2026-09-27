import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import {
  collectionVersionsTable,
  defineCollection,
  toPageId,
} from "../../src/core/content/index.js";
import { onDegraded } from "../../src/core/degraded.js";
import {
  applySaveDraft,
  type DraftBufferKV,
  draftBufferKey,
  type DraftSoftLocks,
  readDraftBuffer,
  versionsRoute,
  writeDraftBuffer,
} from "../../src/core/editor/index.js";
import { createEditSession, realtimeSoftLocks } from "../../src/core/realtime/index.js";

// The soft-lock check on a draft save (#572, step 3): a field another editor
// holds in the realtime session is refused on the draft route too, so a surface
// whose socket dropped can't replace it through the fetch fallback.

const docs = sqliteTable("docs", {
  id: integer("id").primaryKey(),
  title: text("title"),
  body: text("body"),
});
const config = defineCollection({
  slug: "docs",
  fields: { title: { type: "text" }, body: { type: "richText" } },
  versions: { drafts: true },
});
const versionsTable = collectionVersionsTable(config);
const me: EditorSession = { userId: "u1", email: "e@example.com", name: "Alex", role: "admin" };
const LIVE_ROW = [1, "Live title", "<p>Live</p>"];
const fakeD1 = {
  prepare: () => ({
    bind: () => ({
      raw: async () => [LIVE_ROW],
      all: async () => ({ results: [LIVE_ROW] }),
    }),
    raw: async () => [LIVE_ROW],
    all: async () => ({ results: [LIVE_ROW] }),
  }),
} as unknown as D1Database;

/** A KV buffer flushed a moment ago holding the live values, so a save stays in KV. */
async function freshBuffer(): Promise<DraftBufferKV> {
  const store = new Map<string, string>();
  const kv: DraftBufferKV = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
  const now = Date.now();
  await writeDraftBuffer(kv, draftBufferKey("docs", 1), {
    data: { title: "Live title", body: "<p>Live</p>" },
    updatedAt: now,
    flushedAt: now,
  });
  return kv;
}

/** Soft-locks that report `locks` and count their reads. */
function locksOf(locks: Record<string, string>) {
  const read = vi.fn(async () => locks);
  const softLocks: DraftSoftLocks = { fields: ["body"], read };
  return { softLocks, read };
}

const save = (
  kv: DraftBufferKV,
  input: Record<string, unknown>,
  softLocks?: DraftSoftLocks,
  editor = me,
) =>
  applySaveDraft(
    { DB: fakeD1 },
    { table: docs, versionsTable, config, bufferKv: () => kv },
    editor,
    toPageId(1),
    input,
    { softLocks },
  );

describe("applySaveDraft—the soft-lock check", () => {
  let stopListening: (() => void) | undefined;
  afterEach(() => stopListening?.());

  it("answers 423 when the save changes a field someone else holds", async () => {
    const kv = await freshBuffer();
    const { softLocks, read } = locksOf({ body: "u2" });
    const result = await save(kv, { body: "<p>Mine</p>" }, softLocks);
    expect(result).toMatchObject({ ok: false, status: 423, locked: ["body"] });
    expect(read).toHaveBeenCalledWith({ DB: fakeD1 }, { slug: "docs", id: 1 });
    const buffered = await readDraftBuffer(kv, draftBufferKey("docs", 1));
    expect(buffered?.data).toMatchObject({ body: "<p>Live</p>" });
  });

  it("lets the lock holder save", async () => {
    const kv = await freshBuffer();
    const { softLocks } = locksOf({ body: "u1" });
    expect(await save(kv, { body: "<p>Mine</p>" }, softLocks)).toMatchObject({ ok: true });
  });

  it("isn't locked when the held field's value doesn't change, and doesn't read the locks", async () => {
    const kv = await freshBuffer();
    const { softLocks, read } = locksOf({ body: "u2" });
    const result = await save(kv, { title: "New title", body: "<p>Live</p>" }, softLocks);
    expect(result).toMatchObject({ ok: true });
    expect(read).not.toHaveBeenCalled();
  });

  it("never reads the locks for a save that touches no lockable field", async () => {
    const kv = await freshBuffer();
    const { softLocks, read } = locksOf({ body: "u2" });
    expect(await save(kv, { title: "New title" }, softLocks)).toMatchObject({ ok: true });
    expect(read).not.toHaveBeenCalled();
  });

  it("goes ahead and reports it when the locks can't be read", async () => {
    const events: string[] = [];
    stopListening = onDegraded((event) => events.push(event.name));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const kv = await freshBuffer();
    const softLocks: DraftSoftLocks = {
      fields: ["body"],
      read: async () => {
        throw new Error("session unreachable");
      },
    };
    expect(await save(kv, { body: "<p>Mine</p>" }, softLocks)).toMatchObject({ ok: true });
    expect(events).toContain("editor.softLocks");
  });

  it("saves as before without softLocks", async () => {
    const kv = await freshBuffer();
    expect(await save(kv, { body: "<p>Mine</p>" })).toMatchObject({ ok: true });
  });
});

// ── End to end: the route reads the locks from a real session ───────────────

/** A page's edit session over in-memory storage, reachable as a DO namespace. */
function sessionNamespace() {
  const map = new Map<string, unknown>();
  const storage = {
    get: async (k: string) => map.get(k),
    put: async (k: string, v: unknown) => void map.set(k, v),
    delete: async (k: string | string[]) => {
      for (const key of Array.isArray(k) ? k : [k]) map.delete(key);
    },
    list: async (opts?: { prefix?: string }) => {
      const out = new Map<string, unknown>();
      for (const [k, v] of map) if (k.startsWith(opts?.prefix ?? "")) out.set(k, v);
      return out;
    },
    getAlarm: async () => null,
    setAlarm: async () => {},
  };
  const session = createEditSession(
    {
      storage,
      getWebSockets: () => [],
      acceptWebSocket: () => {},
    } as unknown as DurableObjectState,
    { fields: ["title", "body"], lockFields: ["body"] },
  );
  const names: string[] = [];
  const ns = {
    idFromName: (name: string) => {
      names.push(name);
      return { name } as unknown as DurableObjectId;
    },
    get: () =>
      ({
        fetch: (input: RequestInfo, init?: RequestInit) => session.fetch(new Request(input, init)),
      }) as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
  return { ns, map, names, session };
}

describe("realtimeSoftLocks", () => {
  it("reads the held locks from the page's session", async () => {
    const { ns, map, names } = sessionNamespace();
    map.set("lock:body", "u2");
    const softLocks = realtimeSoftLocks({ namespace: () => ns, fields: ["body"] });
    expect(softLocks.fields).toEqual(["body"]);
    expect(await softLocks.read({ DB: fakeD1 }, { slug: "docs", id: toPageId(1) })).toEqual({
      body: "u2",
    });
    expect(names).toEqual(["docs:1"]);
  });

  it("reports no locks when realtime isn't provisioned", async () => {
    const softLocks = realtimeSoftLocks({ namespace: () => undefined, fields: ["body"] });
    expect(await softLocks.read({ DB: fakeD1 }, { slug: "docs", id: toPageId(1) })).toEqual({});
  });

  it("still refuses a plain request to the session that isn't a lock read", async () => {
    const { session } = sessionNamespace();
    const res = await session.fetch(new Request("https://edit-session.invalid/other"));
    expect(res.status).toBe(426);
  });

  it("makes versionsRoute answer 423 with the locked fields", async () => {
    const { ns, map } = sessionNamespace();
    map.set("lock:body", "u2");
    const kv = await freshBuffer();
    const route = versionsRoute({
      table: docs,
      versionsTable,
      config,
      resolveEditor: () => me,
      bufferKv: () => kv,
      softLocks: realtimeSoftLocks({ namespace: () => ns, fields: ["body"] }),
    });
    const res = await route(
      new Request("https://site.example/api/louise/pages/1/versions", {
        method: "POST",
        headers: { origin: "https://site.example", "content-type": "application/json" },
        body: JSON.stringify({ body: "<p>Mine</p>" }),
      }),
      { DB: fakeD1 },
      {} as ExecutionContext,
    );
    expect(res?.status).toBe(423);
    expect(await res?.json()).toEqual({
      error: "Someone else is editing this right now.",
      locked: ["body"],
    });
  });
});
