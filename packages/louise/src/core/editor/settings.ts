// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/editor — the generic `settings` route. The `site_settings` singleton
// holds a Louise site's config. Storage model (issues #10/#11): a **structured
// base** (the framework `siteSettingsColumns`) plus a JSON **`custom`** column
// for site-specific settings. GET returns the merged config (custom flattened
// on top); PATCH/POST patches an allowlisted set — base keys → their columns,
// site-declared keys → merged into `custom`. Keys in neither allowlist are
// ignored (never written): a forged request can't touch an unintended column.
//
// Writes go through Drizzle (not raw SQL) so JSON-mode columns like `navLinks`
// and `custom` serialize correctly; the allowlist split is the pure,
// unit-tested `partitionSettingsPatch`.

import { eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import type { ValidationViolation } from "../errors.js";
import { isMediaUrl } from "../media/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, matchPath, type ResolveEditor } from "./shared.js";

export interface SettingsRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The `site_settings` table (composed from `siteSettingsColumns` or the
   *  ready-made `siteSettings`). */
  table: SQLiteTable;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Drizzle property keys of the base columns a site exposes for editing —
   *  only these structured columns are patched. */
  columns: string[];
  /** Site-specific setting keys, merged into the `custom` JSON object. */
  customKeys?: string[];
  /** Setting keys whose value must be a media-library URL (e.g. `logoUrl`,
   *  `defaultOgImageUrl`). A patched value that is a non-empty string not served
   *  from {@link mediaBase} is rejected `422`, so an external hotlink can't be
   *  stored. Requires {@link mediaBase}. */
  imageKeys?: string[];
  /** The site's `MEDIA_URL` base, used to validate {@link imageKeys}. */
  mediaBase?: string;
  /** Mount path. Default `/api/louise/settings`. */
  path?: string;
  /** Singleton row id. Default 1. */
  id?: number;
}

/**
 * Reject any patched {@link SettingsRouteConfig.imageKeys} value that isn't a
 * media-library URL — pure so the allowlist enforcement is unit-testable
 * independently of D1. Empty/absent/non-string values are skipped (clearing a
 * field is fine; type coercion isn't this check's job).
 */
export function validateSettingsImages(
  patch: Record<string, unknown>,
  imageKeys: Iterable<string>,
  mediaBase: string,
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  for (const key of imageKeys) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (typeof value === "string" && value !== "" && !isMediaUrl(mediaBase, value)) {
      violations.push({
        path: key,
        message: `${key} must be an uploaded media asset, not an external URL`,
        severity: "error",
      });
    }
  }
  return violations;
}

export interface SettingsPartition {
  /** Base columns to patch, keyed by Drizzle property name. */
  columnUpdates: Record<string, unknown>;
  /** Site-specific keys to merge into the `custom` JSON object. */
  customUpdates: Record<string, unknown>;
  /** Keys in neither allowlist — ignored, never written. */
  ignored: string[];
}

/**
 * Split an incoming settings patch into base-column updates, `custom`-extension
 * updates, and ignored (non-allowlisted) keys. Pure — the allowlist enforcement
 * lives here so it's unit-testable independently of D1.
 */
export function partitionSettingsPatch(
  patch: Record<string, unknown>,
  columns: Iterable<string>,
  customKeys: Iterable<string> = [],
): SettingsPartition {
  const cols = new Set(columns);
  const custom = new Set(customKeys);
  const out: SettingsPartition = { columnUpdates: {}, customUpdates: {}, ignored: [] };
  for (const [key, value] of Object.entries(patch)) {
    if (cols.has(key)) out.columnUpdates[key] = value;
    else if (custom.has(key)) out.customUpdates[key] = value;
    else out.ignored.push(key);
  }
  return out;
}

/** Merge the `custom` JSON object up into the top-level settings object so the
 *  panel sees one flat config; site-specific keys never collide with base ones. */
function flatten(row: Record<string, unknown>): Record<string, unknown> {
  const { custom, ...rest } = row;
  const extra =
    custom && typeof custom === "object" && !Array.isArray(custom)
      ? (custom as Record<string, unknown>)
      : {};
  return { ...rest, ...extra };
}

/**
 * Build the `settings` editor route. GET (read) returns the merged singleton
 * config; POST/PATCH (mutation, same-origin-guarded) patches the allowlisted
 * base columns + merges site-declared keys into `custom`. Returns `undefined`
 * for a non-matching path so `composeWorker` falls through.
 */
export function settingsRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: SettingsRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/settings";
  const rowId = config.id ?? 1;
  const table = config.table;
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
      return json({ settings: current ? flatten(current) : {} });
    }

    if (!current) return json({ error: "No settings row" }, 404);

    const patch = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return json({ error: "Invalid JSON" }, 400);
    }

    // Media-strictness: image settings (logo, favicon, share image…) must point
    // at a media-library URL — an external hotlink is rejected before write.
    if (config.imageKeys && config.imageKeys.length > 0 && config.mediaBase) {
      const violations = validateSettingsImages(patch, config.imageKeys, config.mediaBase);
      if (violations.length > 0) {
        return json({ error: "Invalid image field(s)", violations }, 422);
      }
    }

    const part = partitionSettingsPatch(patch, config.columns, config.customKeys ?? []);
    const updates: Record<string, unknown> = { ...part.columnUpdates };
    if (Object.keys(part.customUpdates).length > 0) {
      const prevCustom = (current.custom as Record<string, unknown> | null) ?? {};
      updates.custom = { ...prevCustom, ...part.customUpdates };
    }
    if ("updatedAt" in current) updates.updatedAt = new Date();
    if (Object.keys(updates).length === 0) {
      return json({ error: "Nothing to update", ignored: part.ignored }, 400);
    }

    const setBuilder = database.update(table).set(updates as never);
    await (pkCol ? setBuilder.where(eq(pkCol, rowId)) : setBuilder);

    return json({ ok: true, ignored: part.ignored });
  };
}
