// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/astro` — the editor `save` mutation as an Astro Action (#72):
// a typed, Zod-validated server function so a site calls `actions.louise.save(...)`
// and gets end-to-end types + automatic input validation, instead of hand-building
// a `fetch("/api/louise/save")` JSON body and re-parsing it server-side.
//
//   // site: src/actions/index.ts
//   import { defineAction, ActionError } from "astro:actions";
//   import { louiseSaveAction } from "louise-toolkit/astro";
//
//   export const server = {
//     louise: { save: defineAction(louiseSaveAction({ collections, ActionError })) },
//   };
//
// Why a factory that returns `{ input, handler }` instead of a ready `defineAction`:
// `defineAction`/`ActionError` live in Astro's VIRTUAL `astro:actions` module,
// which only resolves inside an Astro app — a library can't import it (this subpath
// imports only real `astro/*` subpaths, e.g. `astro/zod`). So the adapter ships the
// ingredients and the SITE assembles `defineAction`, and it takes the `ActionError`
// class by injection so the handler can still throw framework-correct 400/401/404.
//
// CSRF: Astro enforces same-origin on Action POSTs by default, so this ports only
// the AUTH guard (a `locals.editor` check). The store logic itself is shared with
// the raw `saveRoute` via `applyFieldSave`, so nothing is parsed or written twice.

import { z } from "astro/zod";
import { applyFieldSave, type SaveCollectionConfig } from "../core/editor/save.js";
import type { EditorRouteEnv } from "../core/editor/shared.js";
import { sanitizeRichHtml } from "../core/security/index.js";

/** The subset of Astro's `ActionError` codes the `save` handler emits. */
type ActionErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR";

/** The shape of Astro's `ActionError` constructor the handler depends on —
 *  injected (see file header) so the toolkit needn't import `astro:actions`. */
export interface ActionErrorCtor {
  new (opts: { code: ActionErrorCode; message?: string }): Error;
}

/** The slice of an Astro `ActionAPIContext` the `save` handler reads: the resolved
 *  editor and the Cloudflare bindings, both off `locals`. A real context (which
 *  carries much more) structurally satisfies this. */
export interface SaveActionContext {
  locals: {
    editor?: unknown;
    runtime?: { env: unknown };
  };
}

/** The validated `save` input — the inline field-save body, same keys the raw
 *  route's `SAVE_BODY` uses. `value` stays `unknown`; its non-empty-string check
 *  needs the collection config and so lives in `applyFieldSave`. */
export interface SaveActionInput {
  collection: string;
  key: string;
  field: string;
  value: unknown;
}

export interface LouiseSaveActionConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** Editable collections keyed by the client's `collection` slug — the same
   *  shape the raw {@link import("../core/editor/save.js").saveRoute} takes. */
  collections: Record<string, SaveCollectionConfig>;
  /** Astro's `ActionError` class, injected (see file header). */
  ActionError: ActionErrorCtor;
  /** Resolve the editor session from the Action context. Default: `locals.editor`
   *  (set by `createLouiseMiddleware`). A falsy result answers 401. */
  getEditor?: (ctx: SaveActionContext) => unknown;
  /** Resolve the Worker `env` (the D1 binding) from the Action context. Default:
   *  `locals.runtime.env` — the Cloudflare adapter's binding location. */
  getEnv?: (ctx: SaveActionContext) => Env;
  /** Rich-HTML sanitizer; defaults to louise-toolkit/security's `sanitizeRichHtml`. */
  sanitize?: (html: string) => string;
}

/** Map an `applyFieldSave` HTTP status onto an Astro `ActionError` code. */
function statusToCode(status: number): ActionErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status >= 500) return "INTERNAL_SERVER_ERROR";
  return "BAD_REQUEST";
}

/**
 * Build the `{ input, handler }` config for the editor `save` Action. The site
 * drops the result into `defineAction` (see file header). The `input` schema is
 * validated by Astro *before* the handler runs — replacing the raw route's manual
 * `request.json()` + `standardValidate` — and the handler shares the raw route's
 * store path via {@link applyFieldSave}, so a field is validated once and written
 * in exactly one place.
 */
export function louiseSaveAction<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: LouiseSaveActionConfig<Env>,
) {
  const { ActionError } = config;
  const sanitize = config.sanitize ?? sanitizeRichHtml;
  const getEditor = config.getEditor ?? ((ctx: SaveActionContext) => ctx.locals.editor);
  const getEnv = config.getEnv ?? ((ctx: SaveActionContext) => ctx.locals.runtime?.env as Env);

  return {
    input: z.object({
      collection: z.string(),
      key: z.string(),
      field: z.string(),
      value: z.unknown(),
    }),
    handler: async (input: SaveActionInput, context: SaveActionContext): Promise<{ ok: true }> => {
      // Auth: the middleware already resolved the session onto locals; a missing
      // one is a 401 (CSRF/same-origin is Astro's default for Action POSTs).
      if (!getEditor(context)) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Editor session required" });
      }
      const result = await applyFieldSave(getEnv(context), config.collections, sanitize, input);
      if (!result.ok) {
        throw new ActionError({ code: statusToCode(result.status), message: result.error });
      }
      return { ok: true };
    },
  };
}
