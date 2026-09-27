// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor—the generic `media` route: the site's media library.
//   GET    /api/louise/media          list tracked assets (the `media` table)
//   POST   /api/louise/media          upload a verified image + register it
//   PATCH  /api/louise/media          set an asset's alt/caption by key
//   DELETE /api/louise/media?key=…     delete after a delete-safety reference scan
// Wraps louise-toolkit/media's R2 helpers (magic-byte-sniffed uploads, the LIKE
// reference scan); the `media` table + bindings (MEDIA, MEDIA_URL) are the
// site's. The table is all-scalar, so the registry rows use raw D1.

import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  type AiRunner,
  aiUnavailableReason,
  type AltTextOptions,
  generateAltText,
} from "../ai/index.js";
import {
  deleteMedia,
  findMediaReferences,
  type MediaRefSource,
  mediaUrl,
  putMedia,
} from "../media/index.js";
import { s, standardValidate } from "../schema/index.js";
import type { WorkerRoute } from "../worker/index.js";
import {
  type EditorRouteEnv,
  guardEditor,
  ident,
  json,
  matchPath,
  type ResolveEditor,
  tableMeta,
} from "./shared.js";

/** Env for the media route: the D1 binding plus the R2 bucket + its public URL.
 *  An optional `IMAGES` binding, when present, is used to read upload dimensions
 *  via `.info()` (covers AVIF/TIFF). */
export interface MediaRouteEnv extends EditorRouteEnv {
  MEDIA: R2Bucket;
  MEDIA_URL: string;
  IMAGES?: ImagesBinding;
}

export interface MediaRouteConfig<Env extends MediaRouteEnv = MediaRouteEnv> {
  /** The `media` table (composed from `mediaColumns` or the ready-made `media`). */
  table: SQLiteTable;
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Delete-safety sources: which `(table, columns)` to scan for a key before
   *  deleting it (rich-text embeds, image-URL arrays, settings JSON). */
  referenceSources?: MediaRefSource[];
  /** Upload key prefix. Default `"web"`. */
  scope?: string;
  /** Max accepted upload size in bytes (passed to `putMedia`). */
  maxBytes?: number;
  /** Max rows returned by GET. Default 500. */
  limit?: number;
  /** Mount path. Default `/api/louise/media`. */
  path?: string;
  /**
   * Auto-generate alt text for uploaded images via Workers AI (#75). Given the
   * runtime `env`, return the AI runner (`env.AI`) to fill each new upload's
   * `alt` from the image; return `undefined` (or omit) to skip—uploads then
   * behave exactly as before (empty `alt`, set by hand in the media panel).
   * Best-effort: a model error or missing binding never fails the upload.
   */
  altText?: (env: Env) => AiRunner | undefined;
  /** Model/prompt/token options for {@link altText} generation. */
  altTextOptions?: AltTextOptions;
  /** Max images the one-click alt backfill (`POST /generate-alt`) fixes per call,
   *  so a big library can't blow the Worker's subrequest/AI budget in one go;
   *  the client re-runs until the count reaches zero. Default {@link DEFAULT_ALT_FIX_BATCH}. */
  altFixBatch?: number;
}

/** Default per-call cap for the alt backfill (#106 Phase 2b). */
export const DEFAULT_ALT_FIX_BATCH = 12;

// PATCH body: `key` identifies the asset; `alt`/`caption` are the only editable
// fields and are coerced (any value → string), so they stay `unknown` here.
/**
 * The SQL condition for an image whose alt text hasn't been written (#599).
 * Only NULL counts: `""` is an image the owner marked decorative, which HTML
 * says to skip. A site's health scan should count with this, so a decorative
 * image leaves the "missing a description" list.
 */
export const MEDIA_ALT_MISSING_SQL = `("alt" IS NULL)`;

/**
 * The one-time migration for the three alt states (#599). Before, an empty
 * alt meant both "not written" and "cleared", so an existing `''` is
 * ambiguous; this makes each one "not written", and the owner marks what's
 * decorative. Run it before the new count goes live, with the table your
 * media registry uses.
 */
export const MEDIA_ALT_UNDECIDED_SQL = (table = "media") =>
  `UPDATE "${table.replaceAll('"', '""')}" SET "alt" = NULL WHERE "alt" = '';`;

const MEDIA_PATCH_BODY = s.object({
  key: s.string({ min: 1 }),
  alt: s.unknown(),
  caption: s.unknown(),
});

/**
 * Build the `media` editor route. GET lists the registry newest-first (each
 * item carries its public `url`), and `GET ?references=<key>` returns
 * `{ references }` for one file. POST uploads + registers a verified image,
 * DELETE removes an asset after the reference scan (`409 in_use` unless
 * `?force=1`). Returns `undefined` for a non-matching path.
 */
export function mediaRoute<Env extends MediaRouteEnv = MediaRouteEnv>(
  config: MediaRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/media";
  const limit = config.limit ?? 500;
  const sources = config.referenceSources ?? [];
  const { name } = tableMeta(config.table);

  return async (request, env) => {
    const method = request.method;
    // One-click AI alt backfill (#106 Phase 2b): a sub-path action off the base.
    if (new URL(request.url).pathname === `${path}/generate-alt`) {
      return generateAltFix(request, env, config, name);
    }
    if (!matchPath(request, path)) return undefined;

    if (method === "GET") {
      const g = await guardEditor(request, env, config.resolveEditor, false);
      if ("response" in g) return g.response;
      // `?references=<key>`: what uses this file, so the Media panel can name
      // it in its one delete prompt (#541) before anything is deleted.
      const refKey = new URL(request.url).searchParams.get("references");
      if (refKey !== null) {
        return json({
          references: sources.length > 0 ? await findMediaReferences(env.DB, refKey, sources) : [],
        });
      }
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${ident(name)} ORDER BY "uploaded_at" DESC LIMIT ?1`,
      )
        .bind(limit)
        .all<Record<string, unknown>>();
      const items = results.map((row) => ({
        ...row,
        url: mediaUrl(env.MEDIA_URL, String(row.key)),
      }));
      return json({ media: items });
    }

    if (method === "POST") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return json({ error: "No file" }, 400);
      const put = await putMedia(env.MEDIA, file, {
        scope: config.scope,
        maxBytes: config.maxBytes,
        images: env.IMAGES,
      });
      if (!put.ok) return json({ error: put.error }, put.status);
      // Best-effort AI alt text (#75), opt-in via `altText`. `generateAltText`
      // never throws and returns null on any failure, so a slow/erroring model
      // just leaves `alt` empty—the upload still succeeds. `file` is a Blob, so
      // re-reading its bytes here (after putMedia) is safe.
      const aiRunner = config.altText?.(env);
      const alt =
        aiRunner && put.contentType.startsWith("image/")
          ? await generateAltText(aiRunner, await file.arrayBuffer(), config.altTextOptions)
          : null;
      // Register the asset. uploaded_at is unix seconds to match Drizzle's
      // `integer({ mode: "timestamp" })` reads on the same column. width/height
      // are recorded when the header could be read (else NULL—"when known");
      // `alt` is the AI suggestion when generated, else NULL (set later via PATCH).
      await env.DB.prepare(
        `INSERT INTO ${ident(name)} ("key","content_type","size","width","height","alt","uploaded_at") VALUES (?1,?2,?3,?4,?5,?6,?7)`,
      )
        .bind(
          put.key,
          put.contentType,
          put.size,
          put.width,
          put.height,
          alt,
          Math.floor(Date.now() / 1000),
        )
        .run();
      return json(
        {
          ok: true,
          key: put.key,
          url: mediaUrl(env.MEDIA_URL, put.key),
          width: put.width,
          height: put.height,
          alt,
        },
        201,
      );
    }

    if (method === "PATCH") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const parsed = await standardValidate(
        MEDIA_PATCH_BODY,
        await request.json().catch(() => null),
      );
      if (!parsed.ok) return json({ error: "No key" }, 400);
      const { key, alt: altRaw, caption: captionRaw } = parsed.value;
      // Only alt/caption are editable here; undefined leaves either unchanged.
      // Alt has three states (#599): null is "not written yet", "" is
      // decorative, and anything else is the description. A null stays NULL
      // rather than becoming "", so clearing the field doesn't mark an image
      // decorative. Nothing else on the row is writable.
      const alt = altRaw === undefined ? undefined : altRaw === null ? null : String(altRaw);
      const caption = captionRaw === undefined ? undefined : String(captionRaw ?? "");
      const sets: string[] = [];
      const binds: (string | null)[] = [];
      if (alt !== undefined) {
        binds.push(alt);
        sets.push(`"alt" = ?${binds.length}`);
      }
      if (caption !== undefined) {
        binds.push(caption);
        sets.push(`"caption" = ?${binds.length}`);
      }
      if (sets.length === 0) return json({ error: "Nothing to update" }, 400);
      binds.push(key);
      const { meta } = await env.DB.prepare(
        `UPDATE ${ident(name)} SET ${sets.join(", ")} WHERE "key" = ?${binds.length}`,
      )
        .bind(...binds)
        .run();
      if (!meta.changes) return json({ error: "Not found" }, 404);
      return json({ ok: true });
    }

    if (method === "DELETE") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const url = new URL(request.url);
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "No key" }, 400);
      if (url.searchParams.get("force") !== "1" && sources.length > 0) {
        const refs = await findMediaReferences(env.DB, key, sources);
        if (refs.length > 0) return json({ error: "in_use", references: refs }, 409);
      }
      await deleteMedia(env.MEDIA, key);
      await env.DB.prepare(`DELETE FROM ${ident(name)} WHERE "key" = ?1`)
        .bind(key)
        .run();
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}

/**
 * AI alt suggestions (#106 Phase 2b, #549): suggest `alt` for images that lack
 * it, capped at {@link MediaRouteConfig.altFixBatch} per call so a big library
 * can't exhaust the Worker's subrequest/AI budget in one go. An optional
 * `{ key }` in the body targets one asset (else newest-first). Editor-guarded;
 * 503 when no AI runner is wired (the client hides the assist).
 *
 * It writes nothing. Returns `{ suggestions: [{ key, alt }] }` for the owner to
 * edit, accept, or skip; an accepted one is saved with the media `PATCH`. Model
 * output doesn't reach a page the owner hasn't seen.
 */
async function generateAltFix<Env extends MediaRouteEnv>(
  request: Request,
  env: Env,
  config: MediaRouteConfig<Env>,
  name: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const g = await guardEditor(request, env, config.resolveEditor, true);
  if ("response" in g) return g.response;
  const runner = config.altText?.(env);
  if (!runner) return json({ error: "unavailable", reason: aiUnavailableReason(env) }, 503);

  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  const onlyKey = typeof body.key === "string" ? body.key : undefined;
  const batch = config.altFixBatch ?? DEFAULT_ALT_FIX_BATCH;
  const missing = MEDIA_ALT_MISSING_SQL;
  const sql = onlyKey
    ? `SELECT "key","content_type","caption" FROM ${ident(name)} WHERE "key" = ?1 AND ${missing}`
    : `SELECT "key","content_type","caption" FROM ${ident(name)} WHERE ${missing} ORDER BY "uploaded_at" DESC LIMIT ?1`;
  const { results } = await env.DB.prepare(sql)
    .bind(onlyKey ?? batch)
    .all<{ key: string; content_type?: string | null; caption?: string | null }>();

  const suggestions: { key: string; alt: string }[] = [];
  for (const row of results) {
    // Skip non-images—a stored PDF/font has no visual alt to generate.
    if (row.content_type && !row.content_type.startsWith("image/")) continue;
    const object = await env.MEDIA.get(row.key);
    if (!object) continue; // registry row without its R2 object—nothing to read
    // The caption is the one piece of context a library image carries (#599).
    const alt = await generateAltText(runner, await object.arrayBuffer(), {
      ...config.altTextOptions,
      context: { ...config.altTextOptions?.context, caption: row.caption ?? undefined },
    });
    if (!alt) continue; // model returned nothing → leave it for a manual fix
    suggestions.push({ key: row.key, alt });
  }
  return json({ suggestions });
}
