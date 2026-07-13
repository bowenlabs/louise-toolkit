// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { JsonValue } from "./types.js";

/**
 * Patch model + deep diff (issues #14, #24) — adopts Sanity's mutation/patch
 * idea (pattern, not code): represent a content change as a small set of field
 * operations, and compute a diff between two document snapshots. Underpins
 * version-history display (what changed between two versions) and the
 * content-migration runner (#18), which expresses a transform's effect as a
 * {@link Patch} and applies it.
 *
 * Two altitudes, deliberately kept separate:
 *
 *   - **Diff** ({@link diffDocuments}) is `_key`-aware and deep: a changed
 *     `blocks` array reports "the hero block's heading changed" at a segmented
 *     path (`["blocks", { key }, "heading"]`), not one opaque "blocks changed".
 *     Reordering blocks with unchanged content is a no-op. This is what a
 *     version-history UI renders.
 *   - **Write** ({@link computePatch} / {@link applyPatch}) stays top-level
 *     field-level (`set`/`unset` on a document's own fields) — the
 *     snapshot-store write model Louise shares with Payload/Strapi. Path-
 *     addressed write ops (insert-by-`_key`, etc.) are a separate Tier-2
 *     concern gated on a real-time-collaboration requirement, not built here.
 */

/** A single field operation. `set` writes a value; `unset` removes the field.
 *  `path` is a top-level field key (the write path is field-level). */
export type PatchOp = { op: "set"; path: string; value: JsonValue } | { op: "unset"; path: string };

/** An ordered set of field operations transforming one document into another. */
export type Patch = PatchOp[];

export type FieldChangeKind = "added" | "removed" | "changed";

/**
 * One segment of a {@link FieldChange} path. A plain string is an object field
 * key; `{ key }` addresses an element of a `_key`-keyed array (a page-builder
 * block) by its stable key rather than a positional index — so a change survives
 * reordering. E.g. `["blocks", { key: "b1a2" }, "heading"]`.
 */
export type PathSeg = string | { key: string };

/** One field's difference between two document snapshots, addressed by a
 *  segmented {@link PathSeg} path (deep — may point inside a block). */
export interface FieldChange {
  path: PathSeg[];
  kind: FieldChangeKind;
  /** Value in the "before" snapshot (absent for `added`). */
  before?: JsonValue;
  /** Value in the "after" snapshot (absent for `removed`). */
  after?: JsonValue;
}

type Doc = Record<string, JsonValue>;

/** The stable per-block key blocks are stamped with (see
 *  `visual-editing.ts`'s `BLOCK_KEY`/`newBlockKey`) — the identity the deep diff
 *  matches array elements on. */
const BLOCK_KEY = "_key";

/**
 * Render a segmented path as a display string: object keys join with `.`,
 * keyed array segments render as `[<key>]`. `["blocks", { key: "b1a2" },
 * "heading"]` → `blocks[b1a2].heading`. For UI labels/keys, not parsing.
 */
export function formatPath(path: PathSeg[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "string") out += out ? `.${seg}` : seg;
    else out += `[${seg.key}]`;
  }
  return out;
}

// Structural deep-equality over JSON values — order-sensitive for arrays
// (a reordered blocks array is a real change unless we match by key), key-order-
// insensitive for objects.
function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i] as JsonValue));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((key) => Object.hasOwn(b, key) && deepEqual((a as Doc)[key], (b as Doc)[key]));
  }
  return false;
}

function isPlainObject(v: JsonValue): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A `_key`-keyed array — a non-empty array whose every element is an object
 * carrying a string `_key`. Returns the elements when it qualifies, else `null`
 * (so ordinary scalar/mixed arrays fall back to a leaf compare). This is the
 * "match by identity, not index" predicate the deep diff keys on.
 */
function keyedArray(v: JsonValue): Array<{ [k: string]: JsonValue }> | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const items: Array<{ [k: string]: JsonValue }> = [];
  for (const item of v) {
    if (!isPlainObject(item) || typeof item[BLOCK_KEY] !== "string") return null;
    items.push(item);
  }
  return items;
}

/**
 * Recursively diff two values, appending {@link FieldChange}s to `out`.
 * `_key`-keyed arrays are matched by key (add/remove/recurse, never by index),
 * plain objects recurse per field, everything else compares as a leaf.
 */
function diffValue(before: JsonValue, after: JsonValue, path: PathSeg[], out: FieldChange[]): void {
  if (deepEqual(before, after)) return;

  const beforeArr = keyedArray(before);
  const afterArr = keyedArray(after);
  if (beforeArr && afterArr) {
    const beforeByKey = new Map(beforeArr.map((i) => [i[BLOCK_KEY] as string, i]));
    const afterByKey = new Map(afterArr.map((i) => [i[BLOCK_KEY] as string, i]));
    for (const [key, item] of beforeByKey) {
      if (!afterByKey.has(key))
        out.push({ path: [...path, { key }], kind: "removed", before: item });
    }
    for (const [key, afterItem] of afterByKey) {
      const beforeItem = beforeByKey.get(key);
      if (!beforeItem) out.push({ path: [...path, { key }], kind: "added", after: afterItem });
      else diffValue(beforeItem, afterItem, [...path, { key }], out);
    }
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const inBefore = Object.hasOwn(before, key);
      const inAfter = Object.hasOwn(after, key);
      if (inBefore && !inAfter)
        out.push({ path: [...path, key], kind: "removed", before: before[key] });
      else if (!inBefore && inAfter)
        out.push({ path: [...path, key], kind: "added", after: after[key] });
      else diffValue(before[key], after[key], [...path, key], out);
    }
    return;
  }

  // Leaf (scalar, non-keyed array, or a type change): a single change here. Both
  // sides exist — add/remove is decided by the parent object/array.
  out.push({ path, kind: "changed", before, after });
}

export interface DiffOptions {
  /**
   * Restrict the diff to these top-level field keys. Omit to diff the union of
   * both documents' own keys. Useful for ignoring bookkeeping columns
   * (`id`/`createdAt`/`publishedVersionId`) in a version-history view.
   */
  fields?: readonly string[];
  /** Top-level field keys to skip (e.g. `["id", "createdAt"]`). */
  ignore?: readonly string[];
}

/**
 * Deep, `_key`-aware diff between two document snapshots — the per-change
 * added/removed/changed list a version-history UI renders, each addressed by a
 * segmented {@link PathSeg} path. Editing one sub-field of one block yields a
 * single change at `["blocks", { key }, "<field>"]`; reordering blocks with
 * unchanged content yields nothing.
 */
export function diffDocuments(before: Doc, after: Doc, options: DiffOptions = {}): FieldChange[] {
  const ignore = new Set(options.ignore ?? []);
  const keys = options.fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];

  const changes: FieldChange[] = [];
  for (const key of keys) {
    if (ignore.has(key)) continue;
    const inBefore = Object.hasOwn(before, key);
    const inAfter = Object.hasOwn(after, key);
    if (inBefore && !inAfter) {
      changes.push({ path: [key], kind: "removed", before: before[key] });
    } else if (!inBefore && inAfter) {
      changes.push({ path: [key], kind: "added", after: after[key] });
    } else if (inBefore && inAfter) {
      diffValue(before[key], after[key], [key], changes);
    }
  }
  return changes;
}

/**
 * The {@link Patch} that transforms `before` into `after`: `set` for each
 * added/changed top-level field, `unset` for each removed one. The write path
 * is field-level (a changed `blocks` array is one `set` of the whole array), so
 * `applyPatch(before, computePatch(before, after))` deep-equals `after`. Not
 * derived from the deep diff — the deep diff addresses sub-fields the top-level
 * write model can't target.
 */
export function computePatch(before: Doc, after: Doc): Patch {
  const patch: Patch = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const path of keys) {
    const inBefore = Object.hasOwn(before, path);
    const inAfter = Object.hasOwn(after, path);
    if (inBefore && !inAfter) {
      patch.push({ op: "unset", path });
    } else if (!inBefore || !deepEqual(before[path], after[path])) {
      patch.push({ op: "set", path, value: after[path] });
    }
  }
  return patch;
}

/**
 * Apply a {@link Patch} to a document, returning a new document (the input is
 * never mutated). Unknown ops are ignored defensively.
 */
export function applyPatch(doc: Doc, patch: Patch): Doc {
  const next: Doc = { ...doc };
  for (const op of patch) {
    if (op.op === "set") {
      next[op.path] = op.value;
    } else if (op.op === "unset") {
      delete next[op.path];
    }
  }
  return next;
}
