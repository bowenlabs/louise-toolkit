// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Stega (steganographic) auto-tagging (issue #23) — a companion to the manual
// `editAttr()` path in `visual-editing.ts`. `editAttr` tags an *element*; stega
// tags the *string*: an invisible, zero-width payload rides inside a field's
// rendered text, so any occurrence of that text traces back to its
// `{ collection, id, field }` with no wrapper element and no author discipline
// (the sharpest footgun in the manual path). Same primitive Sanity's visual
// editing uses. Built on `@vercel/stega` (~1 KB, pure JS, runs on workerd) —
// declared an OPTIONAL peer, so only sites that opt into stega pull it in.
//
// Hybrid, not a replacement: keep `editAttr` for text-less targets (images,
// whole blocks, buttons); use stega for prose. Reuses the existing `EditRef` /
// `encodeEditRef` / `decodeEditRef` contract, so the editor side is unchanged.
//
// ⚠️ Preview-only. Never encode production HTML — zero-width chars would leak
// into <title>, meta/OG tags and search indexes. Gate `encodeDocument` behind
// the same preview/edit flag that controls `data-louise-field` rendering, and
// always `stegaClean()` a value before persisting it (see `stega-clean.ts`).

import { vercelStegaCombine, vercelStegaDecode } from "@vercel/stega";
import { type EditRef, decodeEditRef, encodeEditRef } from "./visual-editing.js";
import type { JsonValue } from "./types.js";

export { stegaClean } from "./stega-clean.js";

/** The stega payload key Louise stows its {@link EditRef} string under. */
const STEGA_KEY = "louise";

/**
 * Embed an {@link EditRef} invisibly inside `value`. The text renders
 * identically; the returned string now carries its own source pointer.
 */
export function stegaEncode(ref: EditRef, value: string): string {
  return vercelStegaCombine(value, { [STEGA_KEY]: encodeEditRef(ref) });
}

/** Recover the {@link EditRef} embedded in `value` by {@link stegaEncode}, or
 *  `null` if the string carries no Louise stega payload. */
export function stegaDecode(value: string): EditRef | null {
  const payload = vercelStegaDecode(value) as { [STEGA_KEY]?: unknown } | undefined;
  const encoded = payload?.[STEGA_KEY];
  return typeof encoded === "string" ? decodeEditRef(encoded) : null;
}

/**
 * Decide whether a field's text should be stega-encoded. `field` is the leaf
 * key. Returns `true` to encode, `false` to skip. Provide your own to change
 * the policy; wrap {@link defaultStegaFilter} to extend it.
 */
export type StegaFilter = (field: string) => boolean;

/** Non-display fields where an invisible payload would leak into a URL,
 *  `<title>`, a date, or structural JSON. */
const SKIP_FIELDS = new Set([
  "slug",
  "url",
  "href",
  "id",
  "email",
  "date",
  "_key",
  "type",
  "status",
  "meta",
]);

/**
 * Default {@link StegaFilter}: skip slugs/urls/ids/emails/dates/`*_at`(`*At`)
 * timestamps and structural keys (`_key`/`type`/`status`/`meta`) so invisible
 * characters never reach a URL, `<title>`, date, or JSON sink. Everything else
 * (display prose) is encoded.
 */
export const defaultStegaFilter: StegaFilter = (field) => {
  if (SKIP_FIELDS.has(field)) return false;
  if (/_at$|At$/.test(field)) return false;
  return true;
};

function isPlainObject(v: JsonValue): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function encodeField(
  collection: string,
  id: number,
  fieldPath: string,
  leafKey: string,
  value: JsonValue,
  filter: StegaFilter,
): JsonValue {
  if (typeof value === "string") {
    return filter(leafKey) ? stegaEncode({ collection, id, field: fieldPath }, value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      // Keyed blocks address by `_key` (survives reorder); else by index.
      const seg = isPlainObject(item) && typeof item._key === "string" ? item._key : String(i);
      return encodeField(collection, id, `${fieldPath}.${seg}`, leafKey, item, filter);
    });
  }
  if (isPlainObject(value)) {
    const out: { [k: string]: JsonValue } = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = encodeField(collection, id, `${fieldPath}.${key}`, key, v, filter);
    }
    return out;
  }
  return value;
}

/**
 * Return a copy of `doc` with every eligible display string stega-encoded so a
 * preview render carries per-field source pointers. Recurses into nested
 * objects and `_key`-keyed arrays (blocks), building the dotted `field` path
 * (`blocks.<_key>.heading`) the editor routes on. PREVIEW DATA PATH ONLY.
 */
export function encodeDocument(
  collection: string,
  id: number,
  doc: Record<string, JsonValue>,
  filter: StegaFilter = defaultStegaFilter,
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(doc)) {
    out[key] = encodeField(collection, id, key, key, value, filter);
  }
  return out;
}
