import { describe, expect, it } from "vitest";
import {
  cfImage,
  circleImage,
  cropStyle,
  deleteMedia,
  findMediaReferences,
  isMediaUrl,
  likePattern,
  listMedia,
  type MediaRefSource,
  mediaUrl,
  putMedia,
  sniffImageType,
} from "../../src/core/media/index.js";

// --- fakes -----------------------------------------------------------------

interface StoredObject {
  body: ArrayBuffer;
  contentType?: string;
  cacheControl?: string;
  uploaded: Date;
}

/** Minimal in-memory R2 bucket. `list` pages by two regardless of the requested
 *  limit so the cursor loop in `listMedia` is actually exercised. */
function makeBucket(): { bucket: R2Bucket; store: Map<string, StoredObject> } {
  const store = new Map<string, StoredObject>();
  let clock = 0;
  const bucket = {
    async put(
      key: string,
      body: ArrayBuffer,
      opts?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
    ) {
      store.set(key, {
        body,
        contentType: opts?.httpMetadata?.contentType,
        cacheControl: opts?.httpMetadata?.cacheControl,
        uploaded: new Date(1_700_000_000_000 + clock++ * 1000),
      });
    },
    async list({ cursor, limit: _limit }: { cursor?: string; limit?: number }) {
      const all = [...store.entries()].map(([key, v]) => ({
        key,
        size: v.body.byteLength,
        uploaded: v.uploaded,
      }));
      const start = cursor ? Number(cursor) : 0;
      const pageSize = 2;
      const objects = all.slice(start, start + pageSize);
      const end = start + pageSize;
      const truncated = end < all.length;
      return { objects, truncated, cursor: truncated ? String(end) : undefined };
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

/** Fake D1 that returns canned rows per prepared statement and records the
 *  statement + bound value for assertions. */
function makeD1(rows: (sql: string) => Array<{ label: string }>): {
  db: D1Database;
  calls: Array<{ sql: string; bind: unknown }>;
} {
  const calls: Array<{ sql: string; bind: unknown }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...vals: unknown[]) {
          calls.push({ sql, bind: vals[0] });
          return {
            async all<T>() {
              return { results: rows(sql) as unknown as T[] };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

const bytesToFile = (bytes: number[], name: string, type = "application/octet-stream") =>
  new File([new Uint8Array(bytes)], name, { type });

// PNG magic bytes, padded so the sniffer's 32-byte window is populated.
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(24).fill(0)];

// --- sniff -----------------------------------------------------------------

describe("sniffImageType", () => {
  it("identifies supported formats from magic bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
    expect(
      sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("image/webp");
    // AVIF: ftyp box at offset 4 with the "avif" brand.
    const avif = new Uint8Array(32);
    avif.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70], 0);
    avif.set([0x61, 0x76, 0x69, 0x66], 8); // "avif"
    expect(sniffImageType(avif)).toBe("image/avif");
  });

  it("rejects non-image bytes (and never trusts a spoofed MIME)", () => {
    expect(sniffImageType(new Uint8Array([0x68, 0x65, 0x6c, 0x6c]))).toBeNull(); // "hell"
    // SVG is intentionally unsupported (script risk on a public media domain).
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns=..."))).toBeNull();
  });
});

// --- putMedia --------------------------------------------------------------

describe("putMedia", () => {
  it("stores a verified image with the sniffed type + immutable cache header", async () => {
    const { bucket, store } = makeBucket();
    const res = await putMedia(bucket, bytesToFile(PNG_HEADER, "Photo (1).PNG", "image/webp"), {
      scope: "web",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.contentType).toBe("image/png"); // sniffed, NOT the client "image/webp"
    expect(res.key).toMatch(/^web\/\d+-photo--1-\.png$/); // spaces + parens → "-"
    const stored = store.get(res.key)!;
    expect(stored.contentType).toBe("image/png");
    expect(stored.cacheControl).toContain("immutable");
  });

  it("rejects oversize files with 413 before writing", async () => {
    const { bucket, store } = makeBucket();
    const res = await putMedia(bucket, bytesToFile(PNG_HEADER, "big.png"), { maxBytes: 8 });
    expect(res).toMatchObject({ ok: false, status: 413 });
    expect(store.size).toBe(0);
  });

  it("rejects non-images with 415 before writing", async () => {
    const { bucket, store } = makeBucket();
    const res = await putMedia(bucket, bytesToFile([1, 2, 3, 4], "notes.txt"));
    expect(res).toMatchObject({ ok: false, status: 415 });
    expect(store.size).toBe(0);
  });
});

// --- listMedia / mediaUrl / deleteMedia ------------------------------------

describe("listMedia", () => {
  it("pages through the bucket and returns items newest-first with public URLs", async () => {
    const { bucket } = makeBucket();
    for (const n of [1, 2, 3, 4, 5]) {
      await putMedia(bucket, bytesToFile(PNG_HEADER, `p${n}.png`));
    }
    const items = await listMedia(bucket, "https://media.example.com/");
    expect(items).toHaveLength(5); // all pages walked (page size 2 → 3 pages)
    // Newest upload first.
    expect(items[0].uploaded >= items[1].uploaded).toBe(true);
    expect(items[0].url.startsWith("https://media.example.com/web/")).toBe(true);
    expect(items[0].url).not.toContain("//web"); // trailing slash trimmed
  });
});

describe("mediaUrl / deleteMedia", () => {
  it("joins base + key trimming a trailing slash", () => {
    expect(mediaUrl("https://m.example.com/", "web/a.png")).toBe("https://m.example.com/web/a.png");
    expect(mediaUrl("https://m.example.com", "web/a.png")).toBe("https://m.example.com/web/a.png");
  });

  it("removes an object", async () => {
    const { bucket, store } = makeBucket();
    const res = await putMedia(bucket, bytesToFile(PNG_HEADER, "gone.png"));
    if (!res.ok) throw new Error("setup failed");
    await deleteMedia(bucket, res.key);
    expect(store.size).toBe(0);
  });
});

describe("isMediaUrl", () => {
  it("accepts a URL served from the base (with or without a trailing slash)", () => {
    expect(isMediaUrl("/media", "/media/web/a.png")).toBe(true);
    expect(isMediaUrl("/media/", "/media/web/a.png")).toBe(true);
    expect(isMediaUrl("https://m.example.com", "https://m.example.com/web/a.png")).toBe(true);
  });

  it("rejects an external URL, the empty string, and a base-less bare match", () => {
    expect(isMediaUrl("/media", "https://evil.example/a.png")).toBe(false);
    // Contains the base as a path segment but isn't served from it.
    expect(isMediaUrl("/media", "https://evil.example/media/a.png")).toBe(false);
    expect(isMediaUrl("/media", "")).toBe(false);
    // The base itself is not an asset (no key).
    expect(isMediaUrl("/media", "/media")).toBe(false);
    // A non-boundary prefix match must not pass.
    expect(isMediaUrl("/media", "/mediafoo/a.png")).toBe(false);
    // An empty base never matches.
    expect(isMediaUrl("", "/media/web/a.png")).toBe(false);
  });
});

// --- findMediaReferences ---------------------------------------------------

describe("findMediaReferences", () => {
  const sources: MediaRefSource[] = [
    {
      collection: "Artwork",
      table: "artworks",
      columns: ["images", "description"],
      labelColumn: "title",
    },
    { collection: "Settings", table: "site_settings", columns: ["data"], labelColumn: "id" },
  ];

  it("returns referencing records when a key is in use", async () => {
    const { db, calls } = makeD1((sql) => (sql.includes("artworks") ? [{ label: "Sunrise" }] : []));
    const refs = await findMediaReferences(db, "web/123-x.png", sources);
    expect(refs).toEqual([{ collection: "Artwork", label: "Sunrise" }]);
    // key is bound as a LIKE param, never interpolated; ESCAPE clause present.
    expect(calls[0].bind).toBe("%web/123-x.png%");
    expect(calls[0].sql).toContain("ESCAPE '\\'");
    expect(calls[0].sql).toContain('"artworks"');
    expect(calls[0].sql).toContain('"images" LIKE ?1');
  });

  it("returns nothing when the key is unreferenced", async () => {
    const { db } = makeD1(() => []);
    expect(await findMediaReferences(db, "web/orphan.png", sources)).toEqual([]);
  });

  it("skips sources with no columns and rejects invalid identifiers", async () => {
    const { db, calls } = makeD1(() => []);
    await findMediaReferences(db, "k", [
      { collection: "X", table: "x", columns: [], labelColumn: "id" },
    ]);
    expect(calls).toHaveLength(0); // no columns → no query issued
    await expect(
      findMediaReferences(db, "k", [
        { collection: "X", table: "x; DROP TABLE y", columns: ["a"], labelColumn: "id" },
      ]),
    ).rejects.toThrow(/Invalid SQL identifier/);
  });
});

describe("likePattern", () => {
  it("wraps in wildcards and escapes LIKE metacharacters", () => {
    expect(likePattern("a_b%c")).toBe("%a\\_b\\%c%");
    expect(likePattern("plain")).toBe("%plain%");
  });
});

// --- transforms ------------------------------------------------------------

describe("cfImage", () => {
  it("rewrites to a /cdn-cgi/image derivative with the requested options", () => {
    const out = cfImage("https://media.example.com/web/a.png", {
      width: 400,
      fit: "cover",
      gravity: "auto",
    });
    expect(out).toBe(
      "https://media.example.com/cdn-cgi/image/width=400,fit=cover,gravity=auto,format=auto/web/a.png",
    );
  });

  it("defaults format to auto and leaves non-URLs / already-transformed URLs untouched", () => {
    expect(cfImage("/relative.png", { width: 100 })).toBe("/relative.png");
    const already = "https://m.example.com/cdn-cgi/image/width=100/web/a.png";
    expect(cfImage(already, { width: 200 })).toBe(already);
  });
});

describe("circleImage", () => {
  it("returns a square focal-cropped src + 1x/2x srcset", () => {
    const { src, srcset } = circleImage("https://m.example.com/web/a.png", 100);
    expect(src).toContain("width=100,height=100,fit=cover,gravity=auto");
    expect(srcset).toContain("width=200,height=200");
    expect(srcset).toMatch(/ 1x, .+ 2x$/);
  });
});

describe("cropStyle", () => {
  it("maps {x,y,scale} to focal object-position + scale about the focal point", () => {
    expect(cropStyle({ x: 25, y: 75, scale: 1.5 })).toEqual({
      objectPosition: "25% 75%",
      transform: "scale(1.5)",
      transformOrigin: "25% 75%",
    });
  });
});
