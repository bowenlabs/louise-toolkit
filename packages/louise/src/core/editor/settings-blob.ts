// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/editor — the blob-mode `settings` route. The structured
// `settingsRoute` (see ./settings) maps settings to `siteSettingsColumns` + a
// `custom` JSON column. This variant is for sites that keep ALL site config in
// a single JSON blob column (e.g. `site_settings.data`) and drive the framework
// Settings panel with `settingsBaseGroups: []` + extension render fields.
//
// GET returns `{ settings: <blob> }` (optionally passed through a site `read`
// transform, e.g. seed-merge so the panel shows every known key). POST/PATCH
// merges an allowlisted set of top-level keys into the blob — the allowlist is
// a `{ key: sanitize }` map, so per-key clamping/normalization lives with the
// site and a forged key the site didn't declare is ignored, never written.

import { eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, matchPath, type ResolveEditor } from "./shared.js";

/** A blob key's sanitizer: clamp/normalize the incoming value before it's
 *  merged into the blob (mirrors the structured route's column coercion). */
export type BlobSanitize = (value: unknown) => unknown;

/**
 * Merge an incoming patch into a settings blob through an allowlist. For each
 * patch key present in `allow`, the sanitized value overwrites the blob key;
 * keys outside `allow` are collected in `ignored` (never written). Pure — the
 * allowlist enforcement lives here so it's unit-testable independently of D1
 * (mirrors {@link partitionSettingsPatch} for the structured route).
 */
export function mergeBlobPatch(
  blob: Record<string, unknown>,
  patch: Record<string, unknown>,
  allow: Record<string, BlobSanitize>,
): { blob: Record<string, unknown>; ignored: string[]; changed: number } {
  const next = { ...blob };
  const ignored: string[] = [];
  let changed = 0;
  for (const [key, value] of Object.entries(patch)) {
    const sanitize = allow[key];
    if (!sanitize) {
      ignored.push(key);
      continue;
    }
    next[key] = sanitize(value);
    changed++;
  }
  return { blob: next, ignored, changed };
}

export interface BlobSettingsRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The singleton `site_settings` table. */
  table: SQLiteTable;
  /** Drizzle property name of the JSON blob column (e.g. `"data"`). */
  column: string;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Allowlisted top-level blob keys, each mapped to a sanitizer. Keys outside
   *  this map are ignored (never written). */
  allow: Record<string, BlobSanitize>;
  /** Optional GET transform for the stored blob — e.g. seed-merge so the panel
   *  shows every known key even on an older row. Pure; must not mutate. */
  read?: (blob: Record<string, unknown>) => Record<string, unknown>;
  /** Mount path. Default `/api/louise/settings`. */
  path?: string;
  /** Singleton row id. Default 1. */
  id?: number;
}

/**
 * Build the blob-mode `settings` editor route. GET (read) returns the merged
 * blob; POST/PATCH (mutation, same-origin-guarded) sanitizes + merges the
 * allowlisted keys into the blob and persists it via Drizzle (so the JSON
 * column serializes correctly). Returns `undefined` for a non-matching path so
 * `composeWorker` falls through.
 */
export function blobSettingsRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: BlobSettingsRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/settings";
  const rowId = config.id ?? 1;
  const table = config.table;
  const blobCol = config.column;
  const pkCol = getTableConfig(table).columns.find((c) => c.primary) as SQLiteColumn | undefined;

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;
    const method = request.method;
    if (method !== "GET" && method !== "POST" && method !== "PATCH") {
      return json({ error: "Method not allowed" }, 405);
    }
    const isRead = method === "GET";

    const g = await guardEditor(request, env, config.resolveEditor, !isRead);
    if ("response" in g) return g.response;

    const database = db(env.DB);
    const rows = (await database.select().from(table).limit(1)) as Record<string, unknown>[];
    const current = rows[0];

    if (isRead) {
      const blob = ((current?.[blobCol] as Record<string, unknown> | null) ?? {}) as Record<
        string,
        unknown
      >;
      return json({ settings: config.read ? config.read(blob) : blob });
    }

    if (!current) return json({ error: "No settings row" }, 404);

    const patch = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return json({ error: "Invalid JSON" }, 400);
    }

    const stored = ((current[blobCol] as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >;
    const { blob, ignored, changed } = mergeBlobPatch(stored, patch, config.allow);
    if (changed === 0) return json({ error: "Nothing to update", ignored }, 400);

    const updates: Record<string, unknown> = { [blobCol]: blob };
    if ("updatedAt" in current) updates.updatedAt = new Date();
    const setBuilder = database.update(table).set(updates as never);
    await (pkCol ? setBuilder.where(eq(pkCol, rowId)) : setBuilder);

    return json({ ok: true, ignored });
  };
}
