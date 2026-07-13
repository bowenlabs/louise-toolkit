// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/editor — the generic `save` route: the inline field-save endpoint
// the client posts a single changed field to (`{ collection, key, field, value }`).
// The session comes from `resolveEditor` (never the page's edit mode); field
// names are allowlisted per collection so a forged request can't touch an
// unintended column; rich fields are sanitized (louise/security) before store.
//
// Scope: collection rows keyed by id. Settings edits go through the `settings`
// route (structured panel), not here — so `save` has no settings branch.

import { eq } from "drizzle-orm";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import { sanitizeRichHtml } from "../security/index.js";
import type { WorkerRoute } from "../worker/index.js";
import { type EditorRouteEnv, guardEditor, json, matchPath, type ResolveEditor } from "./shared.js";

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
  /** Rich-HTML sanitizer; defaults to louise/security's `sanitizeRichHtml`. */
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

    const payload = (await request.json().catch(() => null)) as {
      collection?: string;
      key?: string;
      field?: string;
      value?: unknown;
    } | null;
    if (!payload) return json({ error: "Invalid JSON" }, 400);
    const { collection, key, field, value } = payload;
    if (typeof collection !== "string" || typeof key !== "string" || typeof field !== "string") {
      return json({ error: "Bad payload" }, 400);
    }

    const collConfig = config.collections[collection];
    if (!collConfig) return json({ error: "Unknown collection" }, 400);

    const resolved = resolveFieldValue(collConfig, field, value, sanitize);
    if (!resolved.ok) return json({ error: resolved.error }, resolved.status);

    const id = Number(key);
    if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);

    const pkCol = getTableConfig(collConfig.table).columns.find((c) => c.primary) as
      | SQLiteColumn
      | undefined;
    const setBuilder = db(env.DB)
      .update(collConfig.table)
      .set({ [field]: resolved.stored } as never);
    const [updated] = await (pkCol
      ? setBuilder.where(eq(pkCol, id)).returning()
      : setBuilder.returning());
    if (!updated) return json({ error: "Not found" }, 404);
    return json({ ok: true });
  };
}
