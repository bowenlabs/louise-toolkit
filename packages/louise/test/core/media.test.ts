import { describe, expect, it } from "vitest";
import {
  cfImage,
  circleImage,
  cropStyle,
  deleteMedia,
  findMediaReferences,
  imageDimensions,
  imageInfo,
  isMediaUrl,
  likePattern,
  listMedia,
  mediaMetaByUrl,
  type MediaRefSource,
  mediaUrl,
  putMedia,
  sniffImageType,
  transformImage,
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

// --- imageDimensions -------------------------------------------------------

describe("imageDimensions", () => {
  it("reads PNG width/height from IHDR (big-endian u32 at 16/20)", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); // length + "IHDR"
    png.set([0x00, 0x00, 0x03, 0x20], 16); // width 800
    png.set([0x00, 0x00, 0x02, 0x58], 20); // height 600
    expect(imageDimensions(png)).toEqual({ width: 800, height: 600 });
  });

  it("reads GIF logical-screen size (little-endian u16 at 6/8)", () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x02, 0xe0, 0x01]); // "GIF89a" + 640×480
    expect(imageDimensions(gif)).toEqual({ width: 640, height: 480 });
  });

  it("reads a JPEG SOF0 frame size, skipping earlier segments", () => {
    const jpeg = new Uint8Array(24);
    jpeg.set([0xff, 0xd8], 0); // SOI
    jpeg.set([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], 2); // APP0, length 4 (skipped)
    jpeg.set([0xff, 0xc0, 0x00, 0x11, 0x08], 8); // SOF0, len, precision
    jpeg.set([0x01, 0x2c], 13); // height 300
    jpeg.set([0x02, 0x1c], 15); // width 540
    expect(imageDimensions(jpeg)).toEqual({ width: 540, height: 300 });
  });

  it("reads WebP VP8 (lossy) and VP8X (extended) canvas sizes", () => {
    const vp8 = new Uint8Array(30);
    vp8.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    vp8.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    vp8.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
    vp8.set([0x9d, 0x01, 0x2a], 23); // keyframe start code
    vp8.set([0x40, 0x01], 26); // width 320 (14-bit LE)
    vp8.set([0xf0, 0x00], 28); // height 240
    expect(imageDimensions(vp8)).toEqual({ width: 320, height: 240 });

    const vp8x = new Uint8Array(30);
    vp8x.set([0x52, 0x49, 0x46, 0x46], 0);
    vp8x.set([0x57, 0x45, 0x42, 0x50], 8);
    vp8x.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
    vp8x.set([0xaf, 0x04, 0x00], 24); // width-1 = 1199 → 1200
    vp8x.set([0x75, 0x02, 0x00], 27); // height-1 = 629 → 630
    expect(imageDimensions(vp8x)).toEqual({ width: 1200, height: 630 });
  });

  it("returns null for unreadable/unsupported headers", () => {
    expect(imageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull(); // garbage
    // All-zero PNG body → 0×0, treated as unknown rather than a bogus size.
    const zeroPng = new Uint8Array(24);
    zeroPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    expect(imageDimensions(zeroPng)).toBeNull();
  });
});

// --- Images binding (.info + transform) ------------------------------------

/** Fake Cloudflare Images binding. `info` returns a raster response by default;
 *  the transformer records the chained transform/output options. */
function makeImages(
  opts: { info?: () => unknown; infoThrows?: boolean; outputBytes?: Uint8Array } = {},
) {
  const calls = { info: 0, transform: [] as unknown[], output: [] as unknown[] };
  const bytes = opts.outputBytes ?? new Uint8Array([1, 2, 3]);
  const images = {
    async info() {
      calls.info++;
      if (opts.infoThrows) throw new Error("not an image");
      return opts.info
        ? opts.info()
        : { format: "image/avif", fileSize: 99, width: 1024, height: 768 };
    },
    input() {
      const transformer = {
        transform(t: unknown) {
          calls.transform.push(t);
          return transformer;
        },
        async output(o: unknown) {
          calls.output.push(o);
          return {
            response: () =>
              new Response(bytes as BodyInit, {
                headers: { "content-type": (o as { format: string }).format },
              }),
            contentType: () => (o as { format: string }).format,
            image: () => new Blob([bytes as BufferSource]).stream(),
          };
        },
      };
      return transformer;
    },
  };
  return { images: images as unknown as ImagesBinding, calls };
}

describe("imageInfo", () => {
  it("returns dimensions from the Images binding for any format (AVIF/TIFF)", async () => {
    const { images } = makeImages({
      info: () => ({ format: "image/avif", width: 4000, height: 3000 }),
    });
    expect(await imageInfo(images, new Uint8Array([0, 1, 2]))).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it("returns null for vector input (SVG has no intrinsic pixel size)", async () => {
    const { images } = makeImages({ info: () => ({ format: "image/svg+xml" }) });
    expect(await imageInfo(images, new Uint8Array([0]))).toBeNull();
  });

  it("returns null on an Images error (so callers can fall back)", async () => {
    const { images } = makeImages({ infoThrows: true });
    expect(await imageInfo(images, new Uint8Array([0]))).toBeNull();
  });
});

describe("transformImage", () => {
  it("chains input→transform→output and returns the encoded Response", async () => {
    const { images, calls } = makeImages({ outputBytes: new Uint8Array([9, 9, 9]) });
    const res = await transformImage(images, new Uint8Array([1, 2, 3]), {
      width: 1200,
      height: 630,
      format: "avif",
      quality: 70,
    });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("content-type")).toBe("image/avif");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]));
    expect(calls.transform[0]).toMatchObject({
      width: 1200,
      height: 630,
      fit: "cover",
      gravity: "auto",
    });
    expect(calls.output[0]).toEqual({ format: "image/avif", quality: 70 });
  });

  it("defaults fit/gravity/format/quality", async () => {
    const { images, calls } = makeImages();
    await transformImage(images, new Uint8Array([1]));
    expect(calls.transform[0]).toMatchObject({ fit: "cover", gravity: "auto" });
    expect(calls.output[0]).toEqual({ format: "image/avif", quality: 82 });
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
    // The synthetic PNG header has no real dimensions → recorded as unknown.
    expect(res.width).toBeNull();
    expect(res.height).toBeNull();
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

  it("reads dimensions from the Images binding when provided (fills what the parser can't)", async () => {
    const { bucket } = makeBucket();
    const { images } = makeImages({
      info: () => ({ format: "image/png", width: 1200, height: 800 }),
    });
    // The synthetic PNG header has no real size (parser → null); .info() supplies it.
    const res = await putMedia(bucket, bytesToFile(PNG_HEADER, "big.png"), { images });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.width).toBe(1200);
    expect(res.height).toBe(800);
  });

  it("falls back to the header parser when .info() fails", async () => {
    const { bucket } = makeBucket();
    const { images, calls } = makeImages({ infoThrows: true });
    // A real 640×480 PNG IHDR the header parser can read.
    const png = [...PNG_HEADER];
    png.splice(8, 8, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52); // length + "IHDR"
    png.splice(16, 4, 0x00, 0x00, 0x02, 0x80); // width 640
    png.splice(20, 4, 0x00, 0x00, 0x01, 0xe0); // height 480
    const res = await putMedia(bucket, bytesToFile(png, "photo.png"), { images });
    expect(calls.info).toBe(1); // .info() was attempted
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.width).toBe(640); // from the parser, not the binding
    expect(res.height).toBe(480);
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

// --- mediaMetaByUrl --------------------------------------------------------

/** Fake D1 supporting both `.prepare().all()` and `.prepare().bind().all()`. */
function makeMetaD1(rows: Record<string, unknown>[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const res = (sql: string, binds: unknown[]) => ({
    async all() {
      calls.push({ sql, binds });
      return { results: rows };
    },
  });
  const db = {
    prepare(sql: string) {
      return { bind: (...b: unknown[]) => res(sql, b), all: () => res(sql, []).all() };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

describe("mediaMetaByUrl", () => {
  it("scopes to the given urls with an IN query, deriving keys from the base", async () => {
    const { db, calls } = makeMetaD1([
      { key: "web/a.png", alt: "A blue mug", caption: null, width: 10, height: 20 },
    ]);
    const map = await mediaMetaByUrl(db, "media", "/media", [
      "/media/web/a.png",
      "https://evil.example/x.png", // not media-hosted → dropped
    ]);
    expect(calls[0]?.sql).toContain('WHERE "key" IN (?1)');
    expect(calls[0]?.binds).toEqual(["web/a.png"]);
    expect(map.get("/media/web/a.png")).toMatchObject({
      key: "web/a.png",
      alt: "A blue mug",
      width: 10,
    });
  });

  it("issues no query and returns empty when no url matches the base", async () => {
    const { db, calls } = makeMetaD1([]);
    const map = await mediaMetaByUrl(db, "media", "/media", ["https://evil.example/x.png"]);
    expect(map.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("loads the whole table when no urls are given", async () => {
    const { db, calls } = makeMetaD1([
      { key: "web/a.png", alt: null, caption: null, width: null, height: null },
    ]);
    const map = await mediaMetaByUrl(db, "media", "/media");
    expect(calls[0]?.sql).not.toContain("WHERE");
    expect(map.has("/media/web/a.png")).toBe(true);
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
