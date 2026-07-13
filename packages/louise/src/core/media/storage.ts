// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/media — R2 storage helpers.
//
// Transport-agnostic building blocks for a Louise media library: verified
// uploads, paged listing, deletion, and a delete-safety reference scan. Each
// takes its binding explicitly (the R2 bucket, and for the scan a raw
// `D1Database`), so a site names its bindings whatever it likes — Louise pins
// the *shape*, not the wiring. The HTTP route that guards these with an editor
// session lives in the generic editor surface (louise/worker), not here.

import { imageDimensions } from "./dimensions.js";
import { sniffImageType } from "./sniff.js";

/** Hard ceiling on a single upload. Without it the bucket streams whatever is
 *  posted, bloating storage and cost. Overridable per call. */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export interface PutMediaOptions {
  /** Key prefix grouping uploads by purpose (e.g. `"web"`). Default `"web"`. */
  scope?: string;
  /** Max accepted size in bytes. Default {@link DEFAULT_MAX_BYTES} (10 MB). */
  maxBytes?: number;
  /** `Cache-Control` stored on the object. Default: 1-year immutable. */
  cacheControl?: string;
}

/** Outcome of {@link putMedia}: either the stored object, or a rejection with
 *  the HTTP status a route handler should surface. `width`/`height` are the
 *  intrinsic pixel dimensions when the header could be read, else `null`. */
export type PutMediaResult =
  | {
      ok: true;
      key: string;
      contentType: string;
      size: number;
      width: number | null;
      height: number | null;
    }
  | { ok: false; status: 413 | 415; error: string };

/** Lowercase a filename to a bucket-safe key segment. */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}

/**
 * Verify and store an uploaded image in R2. The bytes are sniffed for a real
 * image signature (the client MIME is never trusted); the object is stored with
 * the *verified* content type and an immutable cache header. The serving route
 * should set `X-Content-Type-Options: nosniff` on the response (this helper only
 * writes the object). Rejects oversize files (413) and non-images (415) without
 * writing anything.
 */
export async function putMedia(
  bucket: R2Bucket,
  file: File,
  opts: PutMediaOptions = {},
): Promise<PutMediaResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  // Size cap first — reject before buffering anything large.
  if (file.size > maxBytes) {
    return { ok: false, status: 413, error: `File too large (max ${maxBytes / 1024 / 1024} MB)` };
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    return { ok: false, status: 413, error: `File too large (max ${maxBytes / 1024 / 1024} MB)` };
  }

  const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 32));
  const contentType = sniffImageType(head);
  if (!contentType) {
    return { ok: false, status: 415, error: "Unsupported or invalid image file" };
  }

  // Read intrinsic dimensions from the header (no pixel decode). A larger slice
  // than the sniff needs, since a JPEG's SOF can sit past several segments.
  const dims = imageDimensions(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536)));

  const scope = opts.scope ?? "web";
  const key = `${scope}/${Date.now()}-${safeName(file.name)}`;
  await bucket.put(key, buffer, {
    httpMetadata: {
      contentType,
      cacheControl: opts.cacheControl ?? "public, max-age=31536000, immutable",
    },
  });

  return {
    ok: true,
    key,
    contentType,
    size: buffer.byteLength,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
  };
}

export interface MediaItem {
  key: string;
  url: string;
  size: number;
  /** ISO 8601 upload timestamp. */
  uploaded: string;
}

/** Join a public media base URL and an object key into an absolute URL. */
export function mediaUrl(base: string, key: string): string {
  return `${base.replace(/\/$/, "")}/${key}`;
}

/**
 * Whether `value` is a URL served from this site's media base (`MEDIA_URL`) — an
 * asset in the media library rather than an external hotlink. A prefix match on
 * the normalized base (what {@link mediaUrl} builds is always `base` + `/` +
 * key). The empty string is NOT media; a caller that treats "unset" as valid
 * checks that separately. This is the one definition of "media-backed" the
 * sanitizer, the sections validator, and the settings route all enforce with.
 */
export function isMediaUrl(base: string, value: string): boolean {
  const b = base.replace(/\/$/, "");
  return b.length > 0 && value.startsWith(`${b}/`);
}

/**
 * List everything in the bucket, newest first, so a media picker can browse
 * what's actually stored. Pages through R2's 1000-object limit so nothing is
 * hidden. `base` is the public media URL used to build each item's `url`.
 */
export async function listMedia(bucket: R2Bucket, base: string): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const o of page.objects) {
      items.push({
        key: o.key,
        url: mediaUrl(base, o.key),
        size: o.size,
        uploaded: o.uploaded.toISOString(),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  items.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return items;
}

/** Remove one object from the bucket. Delete-safety (the reference scan) is the
 *  caller's decision — run {@link findMediaReferences} first when appropriate. */
export async function deleteMedia(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/** Asset-level metadata for a media row, keyed for render-time lookup. */
export interface MediaMeta {
  key: string;
  url: string;
  alt: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Load asset-level metadata (alt/caption/dimensions) from the `media` registry,
 * keyed by public URL, so a render pass can fill an image's `alt` from its asset
 * default when a per-usage override isn't set. `tableName` is the site's `media`
 * table name, `base` its `MEDIA_URL`.
 *
 * Pass `urls` (the specific public URLs a render actually needs) to scope the
 * query to just those rows — a bounded `IN (…)` lookup instead of a full-table
 * scan, so this stays cheap even on a large library. Omit `urls` to load the
 * whole registry (only sensible for a small table).
 */
export async function mediaMetaByUrl(
  db: D1Database,
  tableName: string,
  base: string,
  urls?: readonly string[],
): Promise<Map<string, MediaMeta>> {
  const map = new Map<string, MediaMeta>();
  let stmt = `SELECT "key","alt","caption","width","height" FROM ${ident(tableName)}`;
  let binds: string[] = [];

  if (urls) {
    // Derive object keys from the public URLs (strip the media base); a URL not
    // served from this base can't be a registry asset, so it's dropped.
    const b = base.replace(/\/$/, "");
    const keys = [...new Set(urls)]
      .map((u) => (b.length > 0 && u.startsWith(`${b}/`) ? u.slice(b.length + 1) : null))
      .filter((k): k is string => k !== null && k.length > 0);
    if (keys.length === 0) return map; // nothing scoped in → no query
    stmt += ` WHERE "key" IN (${keys.map((_, i) => `?${i + 1}`).join(",")})`;
    binds = keys;
  }

  const prepared = binds.length > 0 ? db.prepare(stmt).bind(...binds) : db.prepare(stmt);
  const { results } = await prepared.all<{
    key: string;
    alt: string | null;
    caption: string | null;
    width: number | null;
    height: number | null;
  }>();
  for (const row of results) {
    const url = mediaUrl(base, row.key);
    map.set(url, {
      key: row.key,
      url,
      alt: row.alt,
      caption: row.caption,
      width: row.width,
      height: row.height,
    });
  }
  return map;
}

export interface MediaReference {
  /** Human label for the collection ("Artwork", "Product", "Settings"). */
  collection: string;
  /** The referencing record's title/name so the editor knows what breaks. */
  label: string;
}

/**
 * One table to cross-reference a media key against, described by name so the
 * scan needs no drizzle schema. `columns` are the text columns whose contents
 * may embed a key: `images[]` URL arrays, embedded `<img>`/ProseMirror `src`
 * in rich text, or settings JSON. `labelColumn` is read as the record label.
 */
export interface MediaRefSource {
  collection: string;
  table: string;
  columns: string[];
  labelColumn: string;
}

/** SQLite identifiers are trusted (they come from a site's own config, never
 *  user input), but validate + quote them anyway as defense in depth so a typo
 *  can't become an injection. */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Escape LIKE wildcards so a key containing `_` or `%` (both legal after key
 * sanitization) can't over-match unrelated rows. Pairs with `ESCAPE '\'`.
 */
export function likePattern(needle: string): string {
  return `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Cross-reference an object key against content in D1 before deleting it. The
 * timestamped key is unique enough that a substring scan catches every place it
 * can appear (image-URL arrays, rich-text `src` embeds, settings JSON). Returns
 * the referencing records so a panel can warn "Used by: …". This is the
 * fallback that also covers rich-text embeds that don't go through a `media`
 * reference row; with the `media` table, primary delete-safety is a join.
 */
export async function findMediaReferences(
  db: D1Database,
  key: string,
  sources: MediaRefSource[],
): Promise<MediaReference[]> {
  const kp = likePattern(key);
  const refs: MediaReference[] = [];

  for (const source of sources) {
    if (source.columns.length === 0) continue;
    const where = source.columns.map((c) => `${ident(c)} LIKE ?1 ESCAPE '\\'`).join(" OR ");
    const stmt = `SELECT ${ident(source.labelColumn)} AS label FROM ${ident(source.table)} WHERE ${where}`;
    const { results } = await db.prepare(stmt).bind(kp).all<{ label: string }>();
    for (const row of results) {
      refs.push({ collection: source.collection, label: row.label });
    }
  }

  return refs;
}
