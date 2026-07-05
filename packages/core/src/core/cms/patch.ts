// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

import type { JsonValue } from "./types.js";

/**
 * Patch model + field-level diff (issue #14) — adopts Sanity's mutation/patch
 * idea (pattern, not code): represent a content change as a small set of
 * field operations, and compute a field-level diff between two document
 * snapshots. Underpins version-history display (what changed between two
 * versions) and the content-migration runner (#18), which expresses a
 * transform's effect as a {@link Patch} and applies it.
 *
 * Scope: operations are keyed by **top-level field** (a document's own
 * fields), matching "field-level diff" — a changed `blocks` array reads as
 * one changed field, not a deep per-node diff. Deep/array-aware diffing is a
 * deliberate later extension, not built here.
 */

/** A single field operation. `set` writes a value; `unset` removes the field. */
export type PatchOp = { op: "set"; path: string; value: JsonValue } | { op: "unset"; path: string };

/** An ordered set of field operations transforming one document into another. */
export type Patch = PatchOp[];

export type FieldChangeKind = "added" | "removed" | "changed";

/** One field's difference between two document snapshots. */
export interface FieldChange {
  /** Top-level field key. */
  path: string;
  kind: FieldChangeKind;
  /** Value in the "before" snapshot (absent for `added`). */
  before?: JsonValue;
  /** Value in the "after" snapshot (absent for `removed`). */
  after?: JsonValue;
}

type Doc = Record<string, JsonValue>;

// Structural deep-equality over JSON values — order-sensitive for arrays
// (a reordered blocks array is a real change), key-order-insensitive for
// objects.
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

export interface DiffOptions {
  /**
   * Restrict the diff to these field keys. Omit to diff the union of both
   * documents' own keys. Useful for ignoring bookkeeping columns
   * (`id`/`createdAt`/`publishedVersionId`) in a version-history view.
   */
  fields?: readonly string[];
  /** Field keys to skip (e.g. `["id", "createdAt"]`). */
  ignore?: readonly string[];
}

/**
 * Field-level diff between two document snapshots — the per-field
 * added/removed/changed list a version-history UI renders. Values are
 * compared structurally (deep-equal), so a field only shows as `changed`
 * when its content actually differs.
 */
export function diffDocuments(before: Doc, after: Doc, options: DiffOptions = {}): FieldChange[] {
  const ignore = new Set(options.ignore ?? []);
  const keys = options.fields
    ? options.fields
    : [...new Set([...Object.keys(before), ...Object.keys(after)])];

  const changes: FieldChange[] = [];
  for (const path of keys) {
    if (ignore.has(path)) continue;
    const inBefore = Object.hasOwn(before, path);
    const inAfter = Object.hasOwn(after, path);
    if (inBefore && !inAfter) {
      changes.push({ path, kind: "removed", before: before[path] });
    } else if (!inBefore && inAfter) {
      changes.push({ path, kind: "added", after: after[path] });
    } else if (inBefore && inAfter && !deepEqual(before[path], after[path])) {
      changes.push({
        path,
        kind: "changed",
        before: before[path],
        after: after[path],
      });
    }
  }
  return changes;
}

/**
 * The {@link Patch} that transforms `before` into `after`: `set` for each
 * added/changed field, `unset` for each removed field. `applyPatch(before,
 * computePatch(before, after))` deep-equals `after`.
 */
export function computePatch(before: Doc, after: Doc): Patch {
  return diffDocuments(before, after).map((change) =>
    change.kind === "removed"
      ? { op: "unset", path: change.path }
      : { op: "set", path: change.path, value: change.after as JsonValue },
  );
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
