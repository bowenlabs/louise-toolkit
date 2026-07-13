// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/editor — the generic `editors` route: manage who can edit the CMS.
// Editors are the DB-managed admin allowlist — rows in the Better Auth user
// table with role 'admin'. A row here IS an editor: they can request a magic
// link at /louise and edit the live site (pair with getLouiseAuth's
// `resolveAdmins` reading the same table, so this list is also the allowlist).
//
// The user table is owned by Better Auth (getLouiseAuth), not Drizzle, so this
// uses raw D1 on a configurable table NAME rather than a Drizzle table. Editor-
// guarded: only a signed-in editor can list, invite, or remove editors. The
// first editor is seeded out-of-band (e.g. a seed script); from then on editors
// invite each other here.

import type { WorkerRoute } from "../worker/index.js";
import {
  type EditorRouteEnv,
  guardEditor,
  ident,
  json,
  matchPath,
  type ResolveEditor,
} from "./shared.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EditorsRouteConfig<Env extends EditorRouteEnv> {
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /** Better Auth user table name. Default `"user"` (getLouiseAuth's default);
   *  pass e.g. `"louise_user"` when a `tablePrefix`/modelName renames it. */
  table?: string;
  /** Mount path. Default `/api/louise/editors`. */
  path?: string;
}

interface EditorRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  email: string;
  role: string | null;
  createdAt: string | number | null;
}

/**
 * Build the `editors` editor route. GET (read) lists editors oldest-first;
 * POST (mutation) invites one by `{ name?, email }`; DELETE (mutation) removes
 * one by `?id=` but never the last. Returns `undefined` for a non-matching
 * path so `composeWorker` falls through to the next route / SSR.
 *
 * ```ts
 * // Astro: the session is already on locals; hand it back via resolveEditor.
 * export const ALL: APIRoute = (ctx) =>
 *   runEditorRoute(
 *     editorsRoute({ table: "louise_user", resolveEditor: () => ctx.locals.editor }),
 *     ctx.request,
 *     env,
 *   );
 * ```
 */
export function editorsRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: EditorsRouteConfig<Env>,
): WorkerRoute<Env> {
  const path = config.path ?? "/api/louise/editors";
  // ident() validates + double-quotes the (schema-owned, non-user) table name.
  const table = ident(config.table ?? "user");

  return async (request, env) => {
    if (!matchPath(request, path)) return undefined;

    if (request.method === "GET") {
      const g = await guardEditor(request, env, config.resolveEditor, false);
      if ("response" in g) return g.response;
      const { results } = await env.DB.prepare(
        `SELECT id, firstName, lastName, name, email, role, createdAt FROM ${table} ORDER BY createdAt ASC`,
      ).all<EditorRow>();
      return json({ editors: results ?? [] });
    }

    if (request.method === "POST") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const body = (await request.json().catch(() => null)) as {
        firstName?: unknown;
        lastName?: unknown;
        email?: unknown;
      } | null;
      const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
      const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!EMAIL_RE.test(email)) return json({ error: "A valid email is required." }, 400);
      // Derive the required display `name` from the parts; fall back to the email.
      const name = [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0];
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO ${table} (id, name, email, emailVerified, createdAt, updatedAt, role, firstName, lastName)
           VALUES (?, ?, ?, 1, ?, ?, 'admin', ?, ?)`,
        )
          .bind(id, name, email, now, now, firstName || null, lastName || null)
          .run();
      } catch (err) {
        // Unique email constraint → already an editor.
        if (String(err).includes("UNIQUE")) {
          return json({ error: "That email is already an editor." }, 409);
        }
        return json({ error: "Could not add the editor." }, 500);
      }
      return json({
        ok: true,
        editor: { id, firstName, lastName, name, email, role: "admin", createdAt: now },
      });
    }

    if (request.method === "DELETE") {
      const g = await guardEditor(request, env, config.resolveEditor, true);
      if ("response" in g) return g.response;
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return json({ error: "Missing editor id." }, 400);
      // Never orphan the editor — refuse to remove the last editor.
      const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
        n: number;
      }>();
      if ((count?.n ?? 0) <= 1) {
        return json({ error: "You can't remove the last editor." }, 400);
      }
      await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
