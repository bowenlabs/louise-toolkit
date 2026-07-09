import { describe, expect, it } from "vitest";
import type { EditorSession } from "../../src/core/auth/index.js";
import { inquiries, media, pages, siteSettings } from "../../src/core/db/index.js";
import {
  blobSettingsRoute,
  inquiriesRoute,
  listMediaRoute,
  mediaRoute,
  mergeBlobPatch,
  pagesRoute,
  partitionSettingsPatch,
  pickFields,
  resolveFieldValue,
  runEditorRoute,
  type SaveCollectionConfig,
  saveRoute,
  seedRoute,
  settingsRoute,
  validateSettingsImages,
} from "../../src/core/editor/index.js";

// Fake D1 supporting prepare().bind().all(); records the compiled SQL + binds
// so we can assert the query shape (mirrors media.test.ts's makeD1).
function makeD1(handler: (sql: string, binds: unknown[]) => unknown[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async all() {
              calls.push({ sql, binds });
              return { results: handler(sql, binds) };
            },
            async run() {
              calls.push({ sql, binds });
              return { success: true, meta: {} };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

const editor: EditorSession = { userId: "u1", email: "e@x.com", name: "Ed", role: "admin" };
const ctx = {} as ExecutionContext;
const URL_BASE = "https://site.example/api/louise/inquiries";
const req = (method: string, url = URL_BASE, origin = "https://site.example") =>
  new Request(url, { method, headers: { origin } });

describe("inquiriesRoute", () => {
  it("passes through (undefined) on a non-matching path", async () => {
    const { db } = makeD1(() => []);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    const res = await route(new Request("https://site.example/other"), { DB: db }, ctx);
    expect(res).toBeUndefined();
  });

  it("401s an unauthenticated GET without touching the DB", async () => {
    const { db, calls } = makeD1(() => []);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => null });
    const res = await route(req("GET"), { DB: db }, ctx);
    expect(res?.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("lists submissions newest-first for an editor", async () => {
    const rows = [
      { id: 2, email: "b@x" },
      { id: 1, email: "a@x" },
    ];
    const { db, calls } = makeD1(() => rows);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    const res = await route(req("GET"), { DB: db }, ctx);
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ inquiries: rows });
    expect(calls[0]?.sql).toContain('FROM "inquiries"');
    expect(calls[0]?.sql).toContain('ORDER BY "id" DESC');
    expect(calls[0]?.binds).toEqual([200]);
  });

  it("rejects a cross-origin DELETE (CSRF) with 403", async () => {
    const { db, calls } = makeD1(() => []);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    const res = await route(
      req("DELETE", `${URL_BASE}?id=1`, "https://evil.example"),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("deletes an inquiry by id", async () => {
    const { db, calls } = makeD1((sql) => (sql.startsWith("DELETE") ? [{ id: 5 }] : []));
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    const res = await route(req("DELETE", `${URL_BASE}?id=5`), { DB: db }, ctx);
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
    expect(calls[0]?.binds).toEqual([5]);
  });

  it("400s a non-numeric id", async () => {
    const { db, calls } = makeD1(() => []);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    const res = await route(req("DELETE", `${URL_BASE}?id=abc`), { DB: db }, ctx);
    expect(res?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("404s deleting a missing inquiry", async () => {
    const { db } = makeD1(() => []);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    const res = await route(req("DELETE", `${URL_BASE}?id=9`), { DB: db }, ctx);
    expect(res?.status).toBe(404);
  });

  it("405s an unsupported method", async () => {
    const { db } = makeD1(() => []);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    const res = await route(req("POST"), { DB: db }, ctx);
    expect(res?.status).toBe(405);
  });
});

describe("runEditorRoute (non-Worker adapter)", () => {
  it("supplies a no-op ctx and returns the route's response", async () => {
    const rows = [{ id: 1, email: "a@x" }];
    const { db } = makeD1(() => rows);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    // No ExecutionContext passed — runEditorRoute fills it in.
    const res = await runEditorRoute(route, req("GET"), { DB: db });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inquiries: rows });
  });

  it("turns a path fall-through into a 404 JSON", async () => {
    const { db } = makeD1(() => []);
    const route = inquiriesRoute({ table: inquiries, resolveEditor: () => editor });
    const res = await runEditorRoute(route, new Request("https://site.example/nope"), { DB: db });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

describe("partitionSettingsPatch", () => {
  const columns = ["siteName", "navLinks", "metaDescription"];
  const customKeys = ["heroHeadline", "aboutBlurb"];

  it("routes base keys to columns, site keys to custom, and ignores the rest", () => {
    const part = partitionSettingsPatch(
      { siteName: "Coracle", heroHeadline: "Hi", navLinks: [{ href: "/" }], bogus: "x" },
      columns,
      customKeys,
    );
    expect(part.columnUpdates).toEqual({ siteName: "Coracle", navLinks: [{ href: "/" }] });
    expect(part.customUpdates).toEqual({ heroHeadline: "Hi" });
    expect(part.ignored).toEqual(["bogus"]);
  });

  it("treats an empty customKeys list as 'no site extension'", () => {
    const part = partitionSettingsPatch({ siteName: "X", extra: 1 }, columns);
    expect(part.columnUpdates).toEqual({ siteName: "X" });
    expect(part.customUpdates).toEqual({});
    expect(part.ignored).toEqual(["extra"]);
  });
});

describe("settingsRoute (guard + dispatch)", () => {
  const settingsUrl = "https://site.example/api/louise/settings";
  const cfg = () => ({
    table: siteSettings,
    columns: ["siteName"],
    customKeys: ["heroHeadline"],
    resolveEditor: () => editor,
  });

  it("passes through a non-matching path", async () => {
    const { db } = makeD1(() => []);
    const res = await settingsRoute(cfg())(
      new Request("https://site.example/other"),
      { DB: db },
      ctx,
    );
    expect(res).toBeUndefined();
  });

  it("401s an unauthenticated read before touching the DB", async () => {
    const { db, calls } = makeD1(() => []);
    const route = settingsRoute({ ...cfg(), resolveEditor: () => null });
    const res = await route(new Request(settingsUrl, { method: "GET" }), { DB: db }, ctx);
    expect(res?.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("403s a cross-origin write (CSRF) before touching the DB", async () => {
    const { db, calls } = makeD1(() => []);
    const route = settingsRoute(cfg());
    const res = await route(
      new Request(settingsUrl, { method: "PATCH", headers: { origin: "https://evil.example" } }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("405s an unsupported method", async () => {
    const { db } = makeD1(() => []);
    const res = await settingsRoute(cfg())(
      new Request(settingsUrl, { method: "DELETE" }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(405);
  });
});

describe("validateSettingsImages", () => {
  const keys = ["logoUrl", "faviconUrl", "defaultOgImageUrl"];

  it("passes media-hosted, empty, and non-image patches", () => {
    expect(
      validateSettingsImages({ logoUrl: "/media/web/logo.png", siteName: "X" }, keys, "/media"),
    ).toEqual([]);
    // Clearing an image (empty string) is allowed.
    expect(validateSettingsImages({ logoUrl: "" }, keys, "/media")).toEqual([]);
    // A key not in the image list is ignored here (partition/allowlist owns it).
    expect(validateSettingsImages({ tagline: "https://x.example" }, keys, "/media")).toEqual([]);
    // An absent image key isn't validated (partial patch).
    expect(validateSettingsImages({ siteName: "X" }, keys, "/media")).toEqual([]);
  });

  it("rejects an external hotlink in any image key", () => {
    const v = validateSettingsImages({ logoUrl: "https://evil.example/logo.png" }, keys, "/media");
    expect(v).toHaveLength(1);
    expect(v[0].path).toBe("logoUrl");
    expect(v[0].severity).toBe("error");
  });

  it("reports every offending image key", () => {
    const v = validateSettingsImages(
      { logoUrl: "https://a.example/x.png", faviconUrl: "https://b.example/y.png" },
      keys,
      "/media",
    );
    expect(v.map((x) => x.path).sort()).toEqual(["faviconUrl", "logoUrl"]);
  });
});

describe("mergeBlobPatch", () => {
  const allow = {
    nav: (v: unknown) => v,
    footerBlurb: (v: unknown) => String(v ?? "").slice(0, 5),
  };

  it("sanitizes + merges allowlisted keys and ignores the rest", () => {
    const out = mergeBlobPatch(
      { nav: [{ href: "/old" }], keep: 1 },
      { nav: [{ href: "/new" }], footerBlurb: "hello world", bogus: "x" },
      allow,
    );
    expect(out.blob).toEqual({ nav: [{ href: "/new" }], footerBlurb: "hello", keep: 1 });
    expect(out.ignored).toEqual(["bogus"]);
    expect(out.changed).toBe(2);
  });

  it("reports changed=0 when nothing is allowlisted (never mutates input)", () => {
    const blob = { nav: [] };
    const out = mergeBlobPatch(blob, { bogus: 1 }, allow);
    expect(out.changed).toBe(0);
    expect(out.ignored).toEqual(["bogus"]);
    expect(out.blob).not.toBe(blob);
    expect(out.blob).toEqual({ nav: [] });
  });
});

describe("blobSettingsRoute (guard + dispatch)", () => {
  const url = "https://site.example/api/louise/settings";
  const cfg = () => ({
    table: siteSettings,
    column: "data",
    allow: { nav: (v: unknown) => v },
    resolveEditor: () => editor,
  });

  it("passes through a non-matching path", async () => {
    const { db } = makeD1(() => []);
    const res = await blobSettingsRoute(cfg())(
      new Request("https://site.example/other"),
      { DB: db },
      ctx,
    );
    expect(res).toBeUndefined();
  });

  it("401s an unauthenticated read before touching the DB", async () => {
    const { db, calls } = makeD1(() => []);
    const route = blobSettingsRoute({ ...cfg(), resolveEditor: () => null });
    const res = await route(new Request(url, { method: "GET" }), { DB: db }, ctx);
    expect(res?.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("403s a cross-origin write (CSRF) before touching the DB", async () => {
    const { db, calls } = makeD1(() => []);
    const res = await blobSettingsRoute(cfg())(
      new Request(url, { method: "PATCH", headers: { origin: "https://evil.example" } }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("405s an unsupported method", async () => {
    const { db } = makeD1(() => []);
    const res = await blobSettingsRoute(cfg())(
      new Request(url, { method: "DELETE" }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(405);
  });
});

describe("resolveFieldValue", () => {
  const coll: SaveCollectionConfig = {
    table: pages,
    fields: ["title", "body"],
    richFields: ["body"],
  };
  const fakeSanitize = (html: string) => `CLEAN:${html}`;

  it("rejects a field outside the allowlist", () => {
    expect(resolveFieldValue(coll, "slug", "x", fakeSanitize)).toEqual({
      ok: false,
      status: 400,
      error: "Unknown field",
    });
  });

  it("rejects empty / non-string values", () => {
    expect(resolveFieldValue(coll, "title", "", fakeSanitize)).toMatchObject({ ok: false });
    expect(resolveFieldValue(coll, "title", 5, fakeSanitize)).toMatchObject({ ok: false });
  });

  it("passes plain fields through untouched", () => {
    expect(resolveFieldValue(coll, "title", "Hello", fakeSanitize)).toEqual({
      ok: true,
      stored: "Hello",
    });
  });

  it("sanitizes rich fields before storing", () => {
    expect(resolveFieldValue(coll, "body", "<b>hi</b>", fakeSanitize)).toEqual({
      ok: true,
      stored: "CLEAN:<b>hi</b>",
    });
  });
});

describe("saveRoute (guard + dispatch)", () => {
  const saveUrl = "https://site.example/api/louise/save";
  const collections = {
    pages: { table: pages, fields: ["title", "body"], richFields: ["body"] },
  };
  const post = (body: unknown, origin = "https://site.example") =>
    new Request(saveUrl, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("passes through a non-matching path", async () => {
    const { db } = makeD1(() => []);
    const route = saveRoute({ collections, resolveEditor: () => editor });
    expect(await route(new Request("https://site.example/other"), { DB: db }, ctx)).toBeUndefined();
  });

  it("405s a GET", async () => {
    const { db } = makeD1(() => []);
    const route = saveRoute({ collections, resolveEditor: () => editor });
    const res = await route(new Request(saveUrl, { method: "GET" }), { DB: db }, ctx);
    expect(res?.status).toBe(405);
  });

  it("401s an unauthenticated same-origin POST", async () => {
    const { db, calls } = makeD1(() => []);
    const route = saveRoute({ collections, resolveEditor: () => null });
    const res = await route(
      post({ collection: "pages", key: "1", field: "title", value: "x" }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("403s a cross-origin POST (CSRF)", async () => {
    const { db } = makeD1(() => []);
    const route = saveRoute({ collections, resolveEditor: () => editor });
    const res = await route(
      post({ collection: "pages", key: "1", field: "title", value: "x" }, "https://evil.example"),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(403);
  });

  it("400s an unknown collection", async () => {
    const { db } = makeD1(() => []);
    const route = saveRoute({ collections, resolveEditor: () => editor });
    const res = await route(
      post({ collection: "nope", key: "1", field: "title", value: "x" }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "Unknown collection" });
  });

  it("400s an unknown field", async () => {
    const { db } = makeD1(() => []);
    const route = saveRoute({ collections, resolveEditor: () => editor });
    const res = await route(
      post({ collection: "pages", key: "1", field: "slug", value: "x" }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "Unknown field" });
  });
});

describe("pickFields", () => {
  const fakeSanitize = (html: string) => `CLEAN:${html}`;

  it("keeps only allowlisted keys and sanitizes the rich ones", () => {
    const out = pickFields(
      { title: "Home", body: "<b>hi</b>", secret: "drop", noindex: true },
      ["title", "body", "noindex"],
      ["body"],
      fakeSanitize,
    );
    expect(out).toEqual({ title: "Home", body: "CLEAN:<b>hi</b>", noindex: true });
  });

  it("leaves a rich field untouched when it isn't a string", () => {
    const out = pickFields({ body: 42 }, ["body"], ["body"], fakeSanitize);
    expect(out).toEqual({ body: 42 });
  });
});

describe("pagesRoute (guard + dispatch)", () => {
  const base = "https://site.example/api/louise/pages";
  const cfg = () => ({ table: pages, resolveEditor: () => editor });

  it("passes through a non-pages path", async () => {
    const { db } = makeD1(() => []);
    expect(
      await pagesRoute(cfg())(
        new Request("https://site.example/api/louise/other"),
        { DB: db },
        ctx,
      ),
    ).toBeUndefined();
  });

  it("401s an unauthenticated list before the DB", async () => {
    const { db, calls } = makeD1(() => []);
    const route = pagesRoute({ table: pages, resolveEditor: () => null });
    const res = await route(new Request(base, { method: "GET" }), { DB: db }, ctx);
    expect(res?.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("403s a cross-origin create (CSRF)", async () => {
    const { db } = makeD1(() => []);
    const res = await pagesRoute(cfg())(
      new Request(base, {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: "{}",
      }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(403);
  });

  it("405s an unsupported (same-origin) method on the collection path", async () => {
    const { db } = makeD1(() => []);
    // Same-origin so it clears the CSRF guard and reaches method dispatch.
    const res = await pagesRoute(cfg())(
      new Request(base, { method: "PUT", headers: { origin: "https://site.example" } }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(405);
  });

  it("400s a non-numeric id on the item path", async () => {
    const { db } = makeD1(() => []);
    const res = await pagesRoute(cfg())(
      new Request(`${base}/abc`, { method: "GET" }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(400);
  });
});

// PNG magic bytes, padded so the sniffer's 32-byte window is populated.
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(24).fill(0)];

function makeBucket() {
  const puts: { key: string }[] = [];
  const deletes: string[] = [];
  const bucket = {
    async put(key: string) {
      puts.push({ key });
    },
    async delete(key: string) {
      deletes.push(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, puts, deletes };
}

describe("mediaRoute", () => {
  const mediaBase = "https://site.example/api/louise/media";
  const MEDIA_URL = "https://media.example.com";
  const cfg = (over: Record<string, unknown> = {}) => ({
    table: media,
    resolveEditor: () => editor,
    ...over,
  });

  it("passes through a non-matching path", async () => {
    const { db } = makeD1(() => []);
    const { bucket } = makeBucket();
    const res = await mediaRoute(cfg())(
      new Request("https://site.example/other"),
      { DB: db, MEDIA: bucket, MEDIA_URL },
      ctx,
    );
    expect(res).toBeUndefined();
  });

  it("401s an unauthenticated list", async () => {
    const { db, calls } = makeD1(() => []);
    const { bucket } = makeBucket();
    const route = mediaRoute(cfg({ resolveEditor: () => null }));
    const res = await route(new Request(mediaBase), { DB: db, MEDIA: bucket, MEDIA_URL }, ctx);
    expect(res?.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("lists tracked assets with public URLs", async () => {
    const { db } = makeD1(() => [{ key: "web/1.png", size: 10 }]);
    const { bucket } = makeBucket();
    const res = await mediaRoute(cfg())(
      new Request(mediaBase),
      { DB: db, MEDIA: bucket, MEDIA_URL },
      ctx,
    );
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { media: { key: string; url: string }[] };
    expect(body.media[0]?.url).toBe("https://media.example.com/web/1.png");
  });

  it("registers a verified upload and stores it", async () => {
    const { db, calls } = makeD1(() => []);
    const { bucket, puts } = makeBucket();
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(PNG_HEADER)], "p.png", { type: "image/png" }));
    const req = new Request(mediaBase, {
      method: "POST",
      body: fd,
      headers: { origin: "https://site.example" },
    });
    const res = await mediaRoute(cfg())(req, { DB: db, MEDIA: bucket, MEDIA_URL }, ctx);
    expect(res?.status).toBe(201);
    expect(puts).toHaveLength(1);
    expect(calls.some((c) => c.sql.startsWith("INSERT INTO"))).toBe(true);
  });

  it("blocks a delete when the key is referenced (409), unless forced", async () => {
    const sources = [
      { collection: "Page", table: "pages", columns: ["body"], labelColumn: "title" },
    ];
    const { db } = makeD1((sql) => (sql.includes("pages") ? [{ label: "Home" }] : []));
    const { bucket, deletes } = makeBucket();
    const route = mediaRoute(cfg({ referenceSources: sources }));
    const res = await route(
      new Request(`${mediaBase}?key=web/1.png`, {
        method: "DELETE",
        headers: { origin: "https://site.example" },
      }),
      { DB: db, MEDIA: bucket, MEDIA_URL },
      ctx,
    );
    expect(res?.status).toBe(409);
    expect(deletes).toHaveLength(0); // nothing removed while in use
  });

  it("deletes an unreferenced key from R2 + the registry", async () => {
    const { db } = makeD1(() => []);
    const { bucket, deletes } = makeBucket();
    const route = mediaRoute(cfg({ referenceSources: [] }));
    const res = await route(
      new Request(`${mediaBase}?key=web/1.png`, {
        method: "DELETE",
        headers: { origin: "https://site.example" },
      }),
      { DB: db, MEDIA: bucket, MEDIA_URL },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect(deletes).toEqual(["web/1.png"]);
  });

  it("405s an unsupported method", async () => {
    const { db } = makeD1(() => []);
    const { bucket } = makeBucket();
    const res = await mediaRoute(cfg())(
      new Request(mediaBase, { method: "PATCH", headers: { origin: "https://site.example" } }),
      { DB: db, MEDIA: bucket, MEDIA_URL },
      ctx,
    );
    expect(res?.status).toBe(405);
  });
});

// A bucket that also implements list(), for the registry-less listMediaRoute.
function makeListBucket(objects: { key: string; size: number; uploaded: Date }[] = []) {
  const puts: { key: string }[] = [];
  const deletes: string[] = [];
  const bucket = {
    async list() {
      return { objects, truncated: false as const };
    },
    async put(key: string) {
      puts.push({ key });
    },
    async delete(key: string) {
      deletes.push(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, puts, deletes };
}

describe("listMediaRoute (registry-less + per-request scope)", () => {
  const mediaBase = "https://site.example/api/louise/media";
  const MEDIA_URL = "https://media.example.com";
  const uploadReq = (scope?: string) => {
    const fd = new FormData();
    fd.set("file", new File([new Uint8Array(PNG_HEADER)], "p.png", { type: "image/png" }));
    if (scope !== undefined) fd.set("scope", scope);
    return new Request(mediaBase, {
      method: "POST",
      body: fd,
      headers: { origin: "https://site.example" },
    });
  };

  it("lists straight from the R2 bucket without touching D1", async () => {
    const { db, calls } = makeD1(() => []);
    const { bucket } = makeListBucket([{ key: "web/a.png", size: 12, uploaded: new Date() }]);
    const route = listMediaRoute({ resolveEditor: () => editor });
    const res = await route(new Request(mediaBase), { DB: db, MEDIA: bucket, MEDIA_URL }, ctx);
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { media: { key: string; url: string }[] };
    expect(body.media[0]?.url).toBe("https://media.example.com/web/a.png");
    expect(calls).toHaveLength(0); // no registry table read
  });

  it("uploads under an allowlisted scope from the form", async () => {
    const { db } = makeD1(() => []);
    const { bucket, puts } = makeListBucket();
    const route = listMediaRoute({ resolveEditor: () => editor, scopes: ["web", "print"] });
    const res = await route(uploadReq("print"), { DB: db, MEDIA: bucket, MEDIA_URL }, ctx);
    expect(res?.status).toBe(201);
    expect(puts[0]?.key.startsWith("print/")).toBe(true);
  });

  it("falls back to the default scope when the form sends one not allowlisted", async () => {
    const { db } = makeD1(() => []);
    const { bucket, puts } = makeListBucket();
    const route = listMediaRoute({ resolveEditor: () => editor, scopes: ["web", "print"] });
    const res = await route(uploadReq("evil"), { DB: db, MEDIA: bucket, MEDIA_URL }, ctx);
    expect(res?.status).toBe(201);
    expect(puts[0]?.key.startsWith("web/")).toBe(true);
  });

  it("deletes an unreferenced key from R2 (no registry write)", async () => {
    const { db, calls } = makeD1(() => []);
    const { bucket, deletes } = makeListBucket();
    const route = listMediaRoute({ resolveEditor: () => editor });
    const res = await route(
      new Request(`${mediaBase}?key=web/a.png`, {
        method: "DELETE",
        headers: { origin: "https://site.example" },
      }),
      { DB: db, MEDIA: bucket, MEDIA_URL },
      ctx,
    );
    expect(res?.status).toBe(200);
    expect(deletes).toEqual(["web/a.png"]);
    expect(calls).toHaveLength(0);
  });
});

describe("seedRoute (guard + dispatch)", () => {
  const seedUrl = "https://site.example/api/louise/seed";
  const cfg = () => ({ table: siteSettings, resolveEditor: () => editor });

  it("passes through a non-matching path", async () => {
    const { db } = makeD1(() => []);
    expect(
      await seedRoute(cfg())(new Request("https://site.example/other"), { DB: db }, ctx),
    ).toBeUndefined();
  });

  it("405s a disallowed method", async () => {
    const { db } = makeD1(() => []);
    const res = await seedRoute({ ...cfg(), allowGet: false })(
      new Request(seedUrl, { method: "GET" }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(405);
  });

  it("403s a cross-origin seed (guarded as a mutation even on GET)", async () => {
    const { db, calls } = makeD1(() => []);
    const res = await seedRoute(cfg())(
      new Request(seedUrl, { method: "GET", headers: { origin: "https://evil.example" } }),
      { DB: db },
      ctx,
    );
    expect(res?.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
