// core/editor/media-list—the registry-less media route: reference lookups,
// upload failures, and the delete-safety scan against in-memory SQLite (#695).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listMediaRoute } from "../../src/core/editor/media-list.js";
import type { MediaRefSource } from "../../src/core/media/index.js";

const MEDIA_URL = "https://media.example.com";
const BASE = "https://example.com/api/louise/media";
const ORIGIN = { origin: "https://example.com" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(24).fill(0)]);

const editor = { userId: "u1", email: "alex@example.com", name: "Alex", role: "admin" as const };
const ctx = {} as ExecutionContext;

/** Pages whose body may mention a media key, for the reference scan. */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE pages (id INTEGER PRIMARY KEY, title TEXT, body TEXT, hero TEXT)`);
  const queries: string[] = [];
  const statement = (sql: string, binds: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    all: async () => {
      queries.push(sql);
      return { success: true, results: sqlite.prepare(sql).all(...binds), meta: {} };
    },
  });
  const d1 = { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
  return { d1, sqlite, queries };
}

function bucket() {
  const puts: string[] = [];
  const deletes: string[] = [];
  const r2 = {
    async list() {
      return {
        objects: [{ key: "web/a.png", size: 1, uploaded: new Date("2026-01-01T00:00:00Z") }],
        truncated: false,
      };
    },
    async put(key: string) {
      puts.push(key);
    },
    async delete(key: string) {
      deletes.push(key);
    },
  } as unknown as R2Bucket;
  return { r2, puts, deletes };
}

const sources: MediaRefSource[] = [
  { collection: "pages", table: "pages", columns: ["body", "hero"], labelColumn: "title" },
];

function setup(config: Partial<Parameters<typeof listMediaRoute>[0]> = {}) {
  const h = sqliteD1();
  const b = bucket();
  const route = listMediaRoute({ resolveEditor: () => editor, ...config });
  const env = { DB: h.d1, MEDIA: b.r2, MEDIA_URL };
  const call = (req: Request) => route(req, env, ctx);
  return { ...h, ...b, call };
}

const upload = (file?: File, scope?: string) => {
  const fd = new FormData();
  if (file) fd.set("file", file);
  if (scope !== undefined) fd.set("scope", scope);
  return new Request(BASE, { method: "POST", body: fd, headers: ORIGIN });
};

describe("listMediaRoute: references", () => {
  it("lists the records that use a key", async () => {
    const t = setup({ referenceSources: sources });
    t.sqlite.exec(`INSERT INTO pages (id, title, body, hero) VALUES
      (1, 'Home', '<img src="https://media.example.com/web/a.png">', NULL),
      (2, 'About', NULL, 'https://media.example.com/web/a.png'),
      (3, 'Contact', 'no images', NULL)`);
    const res = await t.call(new Request(`${BASE}?references=web/a.png`));
    expect(await res?.json()).toEqual({
      references: [
        { collection: "pages", label: "Home" },
        { collection: "pages", label: "About" },
      ],
    });
  });

  it("answers an empty list without querying when no sources are configured", async () => {
    const t = setup();
    const res = await t.call(new Request(`${BASE}?references=web/a.png`));
    expect(await res?.json()).toEqual({ references: [] });
    expect(t.queries).toHaveLength(0);
  });

  it("denies a read without an editor session", async () => {
    const t = setup({ resolveEditor: () => null });
    const res = await t.call(new Request(BASE));
    expect(res?.status).toBe(401);
  });
});

describe("listMediaRoute: upload", () => {
  it("answers 400 when the form carries no file, or the body isn't a form", async () => {
    const t = setup();
    const noFile = await t.call(upload());
    expect(noFile?.status).toBe(400);
    expect(await noFile?.json()).toEqual({ error: "No file" });
    const notForm = await t.call(new Request(BASE, { method: "POST", body: "x", headers: ORIGIN }));
    expect(notForm?.status).toBe(400);
    expect(t.puts).toHaveLength(0);
  });

  it("passes on the store's refusal of a file that isn't an image", async () => {
    const t = setup();
    const res = await t.call(upload(new File(["hello"], "a.txt", { type: "image/png" })));
    expect(res?.status).toBe(415);
    expect(t.puts).toHaveLength(0);
  });

  it("enforces the configured size cap", async () => {
    const t = setup({ maxBytes: 8 });
    const res = await t.call(upload(new File([PNG], "a.png", { type: "image/png" })));
    expect(res?.status).toBe(413);
  });

  it("uploads under the first scope when the form omits one, and returns the URL", async () => {
    const t = setup({ scopes: ["print", "web"] });
    const res = await t.call(upload(new File([PNG], "a.png", { type: "image/png" })));
    expect(res?.status).toBe(201);
    const body = (await res?.json()) as { ok: boolean; key: string; url: string };
    expect(body.key.startsWith("print/")).toBe(true);
    expect(body.url).toBe(`${MEDIA_URL}/${body.key}`);
    expect(t.puts).toEqual([body.key]);
  });

  it("falls back to web when the scope list is empty", async () => {
    const t = setup({ scopes: [] });
    const res = await t.call(upload(new File([PNG], "a.png", { type: "image/png" }), "print"));
    expect(((await res?.json()) as { key: string }).key.startsWith("web/")).toBe(true);
  });

  it("rejects a cross-origin upload", async () => {
    const t = setup();
    const fd = new FormData();
    fd.set("file", new File([PNG], "a.png", { type: "image/png" }));
    const res = await t.call(
      new Request(BASE, { method: "POST", body: fd, headers: { origin: "https://example.org" } }),
    );
    expect(res?.status).toBe(403);
  });
});

describe("listMediaRoute: delete", () => {
  const del = (query: string) =>
    new Request(`${BASE}${query}`, { method: "DELETE", headers: ORIGIN });

  it("answers 400 without a key", async () => {
    const t = setup();
    const res = await t.call(del(""));
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "No key" });
  });

  it("refuses to delete a key that's in use, naming the references", async () => {
    const t = setup({ referenceSources: sources });
    t.sqlite.exec(`INSERT INTO pages (id, title, hero) VALUES (1, 'Home', 'web/a.png')`);
    const res = await t.call(del("?key=web/a.png"));
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({
      error: "in_use",
      references: [{ collection: "pages", label: "Home" }],
    });
    expect(t.deletes).toEqual([]);
  });

  it("deletes an unreferenced key after the scan", async () => {
    const t = setup({ referenceSources: sources });
    t.sqlite.exec(`INSERT INTO pages (id, title, hero) VALUES (1, 'Home', 'web/b.png')`);
    const res = await t.call(del("?key=web/a.png"));
    expect(res?.status).toBe(200);
    expect(t.deletes).toEqual(["web/a.png"]);
    expect(t.queries).toHaveLength(1);
  });

  it("skips the scan and deletes with force=1", async () => {
    const t = setup({ referenceSources: sources });
    t.sqlite.exec(`INSERT INTO pages (id, title, hero) VALUES (1, 'Home', 'web/a.png')`);
    const res = await t.call(del("?key=web/a.png&force=1"));
    expect(res?.status).toBe(200);
    expect(t.deletes).toEqual(["web/a.png"]);
    expect(t.queries).toHaveLength(0);
  });

  it("denies a delete without an editor session", async () => {
    const t = setup({ resolveEditor: () => null });
    const res = await t.call(del("?key=web/a.png"));
    expect(res?.status).toBe(401);
    expect(t.deletes).toEqual([]);
  });
});

describe("listMediaRoute: routing", () => {
  it("answers 405 to another method and mounts at a custom path", async () => {
    const t = setup({ path: "/api/files" });
    expect(await t.call(new Request(BASE))).toBeUndefined();
    const res = await t.call(
      new Request("https://example.com/api/files", { method: "PUT", headers: ORIGIN }),
    );
    expect(res?.status).toBe(405);
    const list = await t.call(new Request("https://example.com/api/files"));
    expect(await list?.json()).toEqual({
      media: [
        {
          key: "web/a.png",
          url: `${MEDIA_URL}/web/a.png`,
          size: 1,
          uploaded: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });
});
