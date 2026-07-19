// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// One media lookup per page, not one per image.
//
// A section stores an image as a URL. The `alt` and `caption` an editor typed
// live on the media ASSET, so rendering a page's images correctly means joining
// every image field back to the media registry. Done naively — a query per
// `<MediaSlot>` — a gallery section is thirty round-trips to D1 on every render.
//
// So the whole page is resolved in ONE bounded `IN (...)` lookup before anything
// renders, and the result is threaded down as `mediaMeta`. This is the pattern
// ghostfire's `Sections.astro` arrived at independently, generalized.
//
// The collection step is SCHEMA-DRIVEN: it walks the catalog looking for fields
// of `type: "image"` rather than hardcoding field names. That's what keeps it
// correct as sections are added — a new section with an image field is picked up
// because it declared one, not because someone remembered to update a list here.
//
// Self-contained (ships as source): type-only imports, no astroid `src/*` reach.

import type { SectionCatalog, SectionField, SectionItem } from "louise-toolkit/content";
import type { MediaMeta } from "./sections.js";

/** SQLite's default parameter ceiling is 999; stay well under it and let the
 *  caller's URL count drive the number of statements rather than the limit. */
const CHUNK = 100;

/** Walk one item's declared fields, collecting the values of `image` ones.
 *  Recurses into `array` item fields — a gallery's images live there. */
function collectFrom(
  item: Record<string, unknown>,
  fields: Record<string, SectionField> | undefined,
  out: Set<string>,
): void {
  if (!fields) return;
  for (const [key, field] of Object.entries(fields)) {
    const value = item[key];
    if (field.type === "image") {
      if (typeof value === "string" && value !== "") out.add(value);
    } else if (field.type === "array" && Array.isArray(value)) {
      for (const row of value) {
        if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
        // With a discriminator, an item's variant contributes extra fields on
        // top of the shared set — an image declared only on the "image" variant
        // of a blocks-style array would be missed otherwise.
        const sub = row as Record<string, unknown>;
        let itemFields = field.itemFields ?? {};
        const disc = field.discriminator;
        if (disc) {
          const variant = sub[disc.key];
          const extra = typeof variant === "string" ? disc.variants[variant] : undefined;
          if (extra) itemFields = { ...itemFields, ...extra };
        }
        collectFrom(sub, itemFields, out);
      }
    }
  }
}

/**
 * Every media URL a page's sections reference, deduplicated.
 *
 * Blocks are walked too, against the block catalog — a section's images and its
 * blocks' images are the same lookup, and splitting them would reintroduce the
 * per-section query this exists to avoid.
 */
export function collectSectionMediaUrls(
  items: SectionItem[],
  catalog: SectionCatalog,
  blockCatalog: SectionCatalog = {},
): string[] {
  const urls = new Set<string>();
  for (const item of items) {
    const def = catalog[String(item._type)];
    if (def) collectFrom(item, def.fields, urls);
    if (!Array.isArray(item.blocks)) continue;
    for (const block of item.blocks) {
      if (typeof block !== "object" || block === null) continue;
      const blockDef = blockCatalog[String((block as { _type?: unknown })._type)];
      if (blockDef) collectFrom(block as Record<string, unknown>, blockDef.fields, urls);
    }
  }
  return [...urls];
}

/** The D1 surface this needs. Structural, so a real `D1Database` fits and a test
 *  can pass a stub. */
export interface MediaMetaDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
    };
  };
}

/**
 * Turn a public media URL into its registry `key`.
 *
 * The public URL is `MEDIA_URL + "/" + key`, so this is prefix removal — but it
 * has to tolerate an absolute URL too (a site whose media base is a full origin),
 * which is why it falls back to the pathname's last segment rather than assuming
 * the string starts with `mediaBase`.
 */
export function mediaKeyFromUrl(url: string, mediaBase: string): string | null {
  if (!url) return null;
  const base = mediaBase.replace(/\/+$/, "");
  if (base && url.startsWith(`${base}/`)) return url.slice(base.length + 1);
  // Absolute or unexpected shape — take the path's tail, which is the key for
  // every URL the media route produces.
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    const tail = path.split("/").filter(Boolean).pop();
    return tail ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve alt/caption for a set of media URLs in one bounded lookup per chunk.
 *
 * Returns `{}` on any failure rather than throwing: missing alt text degrades a
 * page, but a media table that isn't provisioned yet must not take the whole
 * render down with it. The caller's per-image `alt` (a usage-level override)
 * always wins over what comes back here — this is the ASSET-level fallback.
 */
export async function resolveSectionMedia(
  db: MediaMetaDatabase | undefined,
  urls: string[],
  mediaBase = "/media",
): Promise<MediaMeta> {
  if (!db || urls.length === 0) return {};

  // key → the URL(s) that produced it, so results map back to what the sections
  // actually reference.
  const byKey = new Map<string, string[]>();
  for (const url of urls) {
    const key = mediaKeyFromUrl(url, mediaBase);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) existing.push(url);
    else byKey.set(key, [url]);
  }
  if (byKey.size === 0) return {};

  const keys = [...byKey.keys()];
  const meta: MediaMeta = {};

  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(", ");
      const { results } = await db
        .prepare(`SELECT key, alt, caption FROM media WHERE key IN (${placeholders})`)
        .bind(...chunk)
        .all<{ key: string; alt: string | null; caption: string | null }>();

      for (const row of results ?? []) {
        for (const url of byKey.get(row.key) ?? []) {
          meta[url] = {
            ...(row.alt ? { alt: row.alt } : {}),
            ...(row.caption ? { caption: row.caption } : {}),
          };
        }
      }
    }
  } catch {
    // No media table yet (pre-provision), or a transient D1 error. Alt text
    // falls back to whatever the section itself carries.
    return meta;
  }

  return meta;
}
