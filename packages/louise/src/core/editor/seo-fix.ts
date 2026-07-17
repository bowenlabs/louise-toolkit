// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — the one-click SEO backfill (#106 Phase 2c). A pages-side
// companion to the media route's alt backfill: generate an SEO title/description
// for published pages missing them, via Workers AI (louise-toolkit/ai `suggestSeo`).
//
//   POST /api/louise/pages/generate-seo   (editor-only) → { fixed, results }
//
// Config-driven and best-effort: 503 when no AI runner is wired; only the missing
// field(s) are filled (an existing seoTitle is never overwritten); a page whose
// content is empty, or where the model returns nothing, is skipped, not failed.
// Mount BEFORE pagesRoute — its `/:id` matcher would else claim `/generate-seo`.

import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { type AiGatewayOptions, type AiRunner, type SeoOptions, suggestSeo } from "../ai/index.js";
import type { WorkerRoute } from "../worker/index.js";
import {
  type EditorRouteEnv,
  guardEditor,
  ident,
  json,
  type ResolveEditor,
  tableMeta,
} from "./shared.js";

/** Default per-call cap for the SEO backfill (bounds AI/subrequest budget). */
export const DEFAULT_SEO_FIX_BATCH = 8;

export interface SeoFixRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The pages-like table (needs `id`, `status`, `seo_title`, `seo_description`). */
  table: SQLiteTable;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** The Workers AI runner — typically `(env) => env.AI`. `undefined` → 503. */
  ai: (env: Env) => AiRunner | undefined;
  /** Columns concatenated (HTML-stripped) as the model's content. Default `["title","body"]`. */
  contentColumns?: string[];
  /** Max pages fixed per call. Default {@link DEFAULT_SEO_FIX_BATCH}. */
  batch?: number;
  /** Model/token options for `suggestSeo`. */
  seoOptions?: SeoOptions;
  /** Optional AI Gateway routing (#87) for the SEO call. */
  gateway?: (env: Env) => AiGatewayOptions | undefined;
  /** Mount path. Default `/api/louise/pages/generate-seo`. */
  path?: string;
}

/** Collapse HTML to plain text so the model spends its budget on words, not tags. */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === "";

/**
 * Build the SEO backfill route. Returns `undefined` for a non-matching path so
 * `composeWorker` falls through. Only POST is served; an optional `{ id }` in the
 * body targets one page (else a bulk backfill of published pages missing SEO).
 */
export function seoFixRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: SeoFixRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/pages/generate-seo";
  const { name } = tableMeta(config.table);
  const contentColumns = config.contentColumns ?? ["title", "body"];

  return async (request, env) => {
    if (new URL(request.url).pathname !== path) return undefined;
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const g = await guardEditor(request, env, config.resolveEditor, true);
    if ("response" in g) return g.response;
    const runner = config.ai(env);
    if (!runner) return json({ error: "unavailable" }, 503);

    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const onlyId = typeof body.id === "number" ? body.id : undefined;
    const batch = config.batch ?? DEFAULT_SEO_FIX_BATCH;

    // De-duped, quoted column list to read; the WHERE finds SEO-gap published rows.
    const cols = [...new Set(["id", "seo_title", "seo_description", ...contentColumns])]
      .map(ident)
      .join(",");
    const missing = `("seo_title" IS NULL OR "seo_title" = '' OR "seo_description" IS NULL OR "seo_description" = '')`;
    const sql = onlyId
      ? `SELECT ${cols} FROM ${ident(name)} WHERE "id" = ?1 AND "status" = 'published' AND ${missing}`
      : `SELECT ${cols} FROM ${ident(name)} WHERE "status" = 'published' AND ${missing} ORDER BY "id" DESC LIMIT ?1`;
    const { results } = await env.DB.prepare(sql)
      .bind(onlyId ?? batch)
      .all<Record<string, unknown>>();

    const gateway = config.gateway?.(env);
    const opts: SeoOptions = gateway
      ? { ...config.seoOptions, gateway }
      : (config.seoOptions ?? {});
    const fixed: { id: unknown; title: string | null; description: string | null }[] = [];

    for (const row of results) {
      const content = contentColumns
        .map((c) => htmlToText(String(row[c] ?? "")))
        .filter(Boolean)
        .join("\n");
      if (!content) continue; // nothing to summarize
      const seo = await suggestSeo(runner, content, opts);
      if (!seo) continue; // model returned nothing → leave for a manual fill

      // Fill ONLY the missing field(s) — never clobber an existing value.
      const sets: string[] = [];
      const binds: (string | number)[] = [];
      if (isBlank(row.seo_title) && seo.title) {
        binds.push(seo.title);
        sets.push(`"seo_title" = ?${binds.length}`);
      }
      if (isBlank(row.seo_description) && seo.description) {
        binds.push(seo.description);
        sets.push(`"seo_description" = ?${binds.length}`);
      }
      if (sets.length === 0) continue;
      binds.push(row.id as number);
      await env.DB.prepare(
        `UPDATE ${ident(name)} SET ${sets.join(", ")} WHERE "id" = ?${binds.length}`,
      )
        .bind(...binds)
        .run();
      fixed.push({ id: row.id, title: seo.title, description: seo.description });
    }
    return json({ fixed: fixed.length, results: fixed });
  };
}
