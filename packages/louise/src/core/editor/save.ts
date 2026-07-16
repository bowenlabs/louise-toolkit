// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — the generic `save` route: the inline field-save endpoint
// the client posts a single changed field to (`{ collection, key, field, value }`).
// The session comes from `resolveEditor` (never the page's edit mode); field
// names are allowlisted per collection so a forged request can't touch an
// unintended column; rich fields are sanitized (louise-toolkit/security) before store.
//
// Scope: collection rows keyed by id. Settings edits go through the `settings`
// route (structured panel), not here — so `save` has no settings branch.

import { eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import { s, standardValidate } from "../schema/index.js";
import { sanitizeRichHtml } from "../security/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, matchPath, type ResolveEditor } from "./shared.js";

// The inline field-save body. `collection`/`key`/`field` are the routing keys;
// `value` stays `unknown` — its non-empty-string check + per-field sanitize
// belong to {@link resolveFieldValue}, which needs the collection config.
const SAVE_BODY = s.object({
  collection: s.string(),
  key: s.string(),
  field: s.string(),
  value: s.unknown(),
});

export interface SaveCollectionConfig {
  /** The collection's table (site-composed or ready-made). */
  table: SQLiteTable;
  /** Editable field (Drizzle property key) allowlist. */
  fields: string[];
  /** Subset of `fields` whose value is rich HTML → sanitized before store. */
  richFields?: string[];
}

export interface SaveRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** Editable collections keyed by the client's `collection` slug. */
  collections: Record<string, SaveCollectionConfig>;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Rich-HTML sanitizer; defaults to louise-toolkit/security's `sanitizeRichHtml`. */
  sanitize?: (html: string) => string;
  /** Mount path. Default `/api/louise/save`. */
  path?: string;
}

export type ResolvedField =
  | { ok: true; stored: string }
  | { ok: false; status: number; error: string };

/**
 * Allowlist-check a field for a collection and sanitize it when it's a rich
 * field. Pure — the allowlist + sanitize decision lives here so it's
 * unit-testable independently of D1.
 */
export function resolveFieldValue(
  collection: SaveCollectionConfig,
  field: string,
  value: unknown,
  sanitize: (html: string) => string,
): ResolvedField {
  if (!collection.fields.includes(field)) {
    return { ok: false, status: 400, error: "Unknown field" };
  }
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, status: 400, error: "Value must be a non-empty string" };
  }
  const rich = collection.richFields?.includes(field) ?? false;
  return { ok: true, stored: rich ? sanitize(value) : value };
}

/**
 * Apply an already-validated field save: look up the collection, allowlist-check
 * + sanitize the field ({@link resolveFieldValue}), then write it to the row's
 * primary key. Carries no transport/parse concern — the raw {@link saveRoute} and
 * the Astro `save` Action each validate their own input, then converge here, so
 * the store logic (and the #96 body-validation contract about where parsing
 * happens) lives in exactly one place rather than being duplicated per adapter.
 */
export async function applyFieldSave<Env extends EditorRouteEnv = EditorRouteEnv>(
  env: Env,
  collections: Record<string, SaveCollectionConfig>,
  sanitize: (html: string) => string,
  body: { collection: string; key: string; field: string; value: unknown },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const collConfig = collections[body.collection];
  if (!collConfig) return { ok: false, status: 400, error: "Unknown collection" };

  const resolved = resolveFieldValue(collConfig, body.field, body.value, sanitize);
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };

  const id = Number(body.key);
  if (!Number.isInteger(id)) return { ok: false, status: 400, error: "Bad id" };

  const pkCol = getTableConfig(collConfig.table).columns.find((c) => c.primary) as
    | SQLiteColumn
    | undefined;
  const setBuilder = db(env.DB)
    .update(collConfig.table)
    .set({ [body.field]: resolved.stored } as never);
  const [updated] = await (pkCol
    ? setBuilder.where(eq(pkCol, id)).returning()
    : setBuilder.returning());
  if (!updated) return { ok: false, status: 404, error: "Not found" };
  return { ok: true };
}

/**
 * Build the `save` editor route. POST only, same-origin-guarded. Returns
 * `undefined` for a non-matching path so `composeWorker` falls through.
 */
export function saveRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: SaveRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/save";
  const sanitize = config.sanitize ?? sanitizeRichHtml;

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const g = await guardEditor(request, env, config.resolveEditor, true);
    if ("response" in g) return g.response;

    const parsed = await standardValidate(SAVE_BODY, await request.json().catch(() => null));
    if (!parsed.ok) return json({ error: "Bad payload" }, 400);

    const result = await applyFieldSave(env, config.collections, sanitize, parsed.value);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true });
  };
}
