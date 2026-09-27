// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the one-click SEO backfill (#106 Phase 2c). A pages-side
// companion to the media route's alt backfill: generate an SEO title/description
// for published pages missing them, via Workers AI (louise-toolkit/ai `suggestSeo`).
//
//   POST /api/louise/pages/generate-seo         (editor-only) → { suggestions }
//   POST /api/louise/pages/generate-seo/apply   { id, seoTitle?, seoDescription? }
//
// Suggest, then apply what the owner accepted (#549): the first call writes
// nothing, and returns a suggestion for each missing field; the second saves the
// fields the owner kept, as a draft when `drafts` is set, so version history
// holds them and nothing is live until the page is published.
//
// Config-driven and best-effort: 503 when no AI runner is wired; only missing
// fields are suggested (an existing seoTitle is never replaced); a page whose
// content is empty, or where the model returns nothing, is skipped, not failed.

import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { toPageId } from "../content/ids.js";
import {
  type AiGatewayOptions,
  type AiRunner,
  aiUnavailableReason,
  type SeoOptions,
  suggestSeo,
} from "../ai/index.js";
import { s, standardValidate } from "../schema/index.js";
import type { WorkerRoute } from "../worker/index.js";
import {
  type EditorRouteEnv,
  guardEditor,
  ident,
  json,
  type ResolveEditor,
  tableMeta,
} from "./shared.js";
import { applySaveDraft, type SaveDraftDeps } from "./versions.js";

/** Default per-call cap for the SEO backfill (bounds AI/subrequest budget). */
export const DEFAULT_SEO_FIX_BATCH = 8;

export interface SeoFixRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** The pages-like table (needs `id`, `status`, `seo_title`, `seo_description`). */
  table: SQLiteTable;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** The Workers AI runner—typically `(env) => env.AI`. `undefined` → 503. */
  ai: (env: Env) => AiRunner | undefined;
  /** Columns concatenated (HTML-stripped) as the model's content. Default `["title","body"]`. */
  contentColumns?: string[];
  /** Max pages fixed per call. Default {@link DEFAULT_SEO_FIX_BATCH}. */
  batch?: number;
  /** Model/token options for `suggestSeo`. */
  seoOptions?: SeoOptions;
  /** Optional AI Gateway routing (#87) for the SEO call. */
  gateway?: (env: Env) => AiGatewayOptions | undefined;
  /** Mount path. Default `/api/louise/pages/generate-seo`; applying is at
   *  `<path>/apply`. */
  path?: string;
  /**
   * The draft dependencies of a versioned pages collection, as `versionsRoute`
   * takes them (#549). An accepted suggestion is then saved as a draft through
   * `applySaveDraft`, so version history holds it and a later publish can't
   * blank it again; without it, it's written to the live row.
   */
  drafts?: SaveDraftDeps<Env>;
}

const APPLY_BODY = s.object({
  id: s.number({ int: true }),
  seoTitle: s.optional(s.string({ min: 1 })),
  seoDescription: s.optional(s.string({ min: 1 })),
});

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
    const pathname = new URL(request.url).pathname;
    if (pathname !== path && pathname !== `${path}/apply`) return undefined;
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const g = await guardEditor(request, env, config.resolveEditor, true);
    if ("response" in g) return g.response;

    // Save what the owner accepted, and nothing they didn't.
    if (pathname === `${path}/apply`) {
      const parsed = await standardValidate(APPLY_BODY, await request.json().catch(() => null));
      if (!parsed.ok) return json({ error: "Invalid body" }, 400);
      const { id, seoTitle, seoDescription } = parsed.value;
      const fields: Record<string, string> = {};
      if (seoTitle) fields.seoTitle = seoTitle;
      if (seoDescription) fields.seoDescription = seoDescription;
      if (Object.keys(fields).length === 0) return json({ error: "Nothing to apply" }, 400);
      if (config.drafts) {
        const saved = await applySaveDraft(env, config.drafts, g.editor, toPageId(id), fields);
        if (!saved.ok) return json({ error: saved.error }, saved.status);
        return json({ ok: true, draft: true });
      }
      const sets: string[] = [];
      const binds: (string | number)[] = [];
      if (fields.seoTitle) {
        binds.push(fields.seoTitle);
        sets.push(`"seo_title" = ?${binds.length}`);
      }
      if (fields.seoDescription) {
        binds.push(fields.seoDescription);
        sets.push(`"seo_description" = ?${binds.length}`);
      }
      binds.push(id);
      await env.DB.prepare(
        `UPDATE ${ident(name)} SET ${sets.join(", ")} WHERE "id" = ?${binds.length}`,
      )
        .bind(...binds)
        .run();
      return json({ ok: true, draft: false });
    }

    const runner = config.ai(env);
    if (!runner) return json({ error: "unavailable", reason: aiUnavailableReason(env) }, 503);

    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const onlyId = typeof body.id === "number" ? body.id : undefined;
    const batch = config.batch ?? DEFAULT_SEO_FIX_BATCH;

    // De-duped, quoted column list to read; the WHERE finds SEO-gap published rows.
    const cols = [
      ...new Set(["id", "slug", "title", "seo_title", "seo_description", ...contentColumns]),
    ]
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
    const suggestions: {
      id: unknown;
      title: string;
      slug: string;
      seoTitle: string | null;
      seoDescription: string | null;
    }[] = [];

    for (const row of results) {
      const content = contentColumns
        .map((c) => htmlToText(String(row[c] ?? "")))
        .filter(Boolean)
        .join("\n");
      if (!content) continue; // nothing to summarize
      const seo = await suggestSeo(runner, content, opts);
      if (!seo) continue; // model returned nothing → leave for a manual fill

      // Suggest ONLY the missing fields; an existing value is never replaced.
      const seoTitle = isBlank(row.seo_title) ? seo.title : null;
      const seoDescription = isBlank(row.seo_description) ? seo.description : null;
      if (!seoTitle && !seoDescription) continue;
      suggestions.push({
        id: row.id,
        title: String(row.title ?? ""),
        slug: String(row.slug ?? ""),
        seoTitle,
        seoDescription,
      });
    }
    return json({ suggestions });
  };
}
