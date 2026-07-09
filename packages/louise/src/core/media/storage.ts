// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/media — R2 storage helpers.
//
// Transport-agnostic building blocks for a Louise media library: verified
// uploads, paged listing, deletion, and a delete-safety reference scan. Each
// takes its binding explicitly (the R2 bucket, and for the scan a raw
// `D1Database`), so a site names its bindings whatever it likes — Louise pins
// the *shape*, not the wiring. The HTTP route that guards these with an editor
// session lives in the generic editor surface (louisecms/worker), not here.

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
 *  the HTTP status a route handler should surface. */
export type PutMediaResult =
  | { ok: true; key: string; contentType: string; size: number }
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

  const contentType = sniffImageType(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 32)));
  if (!contentType) {
    return { ok: false, status: 415, error: "Unsupported or invalid image file" };
  }

  const scope = opts.scope ?? "web";
  const key = `${scope}/${Date.now()}-${safeName(file.name)}`;
  await bucket.put(key, buffer, {
    httpMetadata: {
      contentType,
      cacheControl: opts.cacheControl ?? "public, max-age=31536000, immutable",
    },
  });

  return { ok: true, key, contentType, size: buffer.byteLength };
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
