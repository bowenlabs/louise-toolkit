// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/editor — the generic `media` route: the site's media library.
//   GET    /api/louise/media          list tracked assets (the `media` table)
//   POST   /api/louise/media          upload a verified image + register it
//   PATCH  /api/louise/media          set an asset's alt/caption by key
//   DELETE /api/louise/media?key=…     delete after a delete-safety reference scan
// Wraps louise-toolkit/media's R2 helpers (magic-byte-sniffed uploads, the LIKE
// reference scan); the `media` table + bindings (MEDIA, MEDIA_URL) are the
// site's. The table is all-scalar, so the registry rows use raw D1.

import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { type AiRunner, type AltTextOptions, generateAltText } from "../ai/index.js";
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
   * `alt` from the image; return `undefined` (or omit) to skip — uploads then
   * behave exactly as before (empty `alt`, set by hand in the media panel).
   * Best-effort: a model error or missing binding never fails the upload.
   */
  altText?: (env: Env) => AiRunner | undefined;
  /** Model/prompt/token options for {@link altText} generation. */
  altTextOptions?: AltTextOptions;
}

// PATCH body: `key` identifies the asset; `alt`/`caption` are the only editable
// fields and are coerced (any value → string), so they stay `unknown` here.
const MEDIA_PATCH_BODY = s.object({
  key: s.string({ min: 1 }),
  alt: s.unknown(),
  caption: s.unknown(),
});

/**
 * Build the `media` editor route. GET lists the registry newest-first (each
 * item carries its public `url`), POST uploads + registers a verified image,
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
    if (!matchPath(request, path)) return undefined;
    const method = request.method;

    if (method === "GET") {
      const g = await guardEditor(request, env, config.resolveEditor, false);
      if ("response" in g) return g.response;
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
      // just leaves `alt` empty — the upload still succeeds. `file` is a Blob, so
      // re-reading its bytes here (after putMedia) is safe.
      const aiRunner = config.altText?.(env);
      const alt =
        aiRunner && put.contentType.startsWith("image/")
          ? await generateAltText(aiRunner, await file.arrayBuffer(), config.altTextOptions)
          : null;
      // Register the asset. uploaded_at is unix seconds to match Drizzle's
      // `integer({ mode: "timestamp" })` reads on the same column. width/height
      // are recorded when the header could be read (else NULL — "when known");
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
      // Only alt/caption are editable here; both are optional text (empty string
      // clears, undefined leaves unchanged). Nothing else on the row is writable.
      const alt = altRaw === undefined ? undefined : String(altRaw ?? "");
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
