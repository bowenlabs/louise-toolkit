// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/astro` — the editor mutations as Astro Actions (#72): typed,
// Zod-validated server functions so a site calls `actions.louise.save(...)` /
// `settings(...)` and gets end-to-end types + automatic input validation, instead
// of hand-building a `fetch("/api/louise/*")` JSON body and re-parsing it.
//
//   // site: src/actions/index.ts
//   import { defineAction, ActionError } from "astro:actions";
//   import { env } from "cloudflare:workers";
//   import { louiseSaveAction, louiseSettingsAction } from "louise-toolkit/astro";
//
//   export const server = {
//     louise: {
//       save: defineAction(louiseSaveAction({ collections, ActionError, getEnv: () => env })),
//       settings: defineAction(louiseSettingsAction({ ...settingsConfig, ActionError, getEnv: () => env })),
//     },
//   };
//
// The Worker `env` (the D1 binding) is injected via `getEnv`, not read off the
// context: Astro v6+ removed `Astro.locals.runtime.env`, so a site hands in its
// bindings — typically `() => env` from `cloudflare:workers` — the same way the
// core primitives take their bindings by injection (the library never reaches for
// `cloudflare:workers` itself).
//
// Why a factory that returns `{ input, handler }` instead of a ready `defineAction`:
// `defineAction`/`ActionError` live in Astro's VIRTUAL `astro:actions` module,
// which only resolves inside an Astro app — a library can't import it (this subpath
// imports only real `astro/*` subpaths, e.g. `astro/zod`). So the adapter ships the
// ingredients and the SITE assembles `defineAction`, and it takes the `ActionError`
// class by injection so the handler can still throw framework-correct 400/401/404.
//
// CSRF: Astro enforces same-origin on Action POSTs by default, so these port only
// the AUTH guard (a `locals.editor` check). The store logic itself is shared with
// the raw routes (`applyFieldSave`, `applySettingsPatch`), so nothing is parsed or
// written twice.

import { z } from "astro/zod";
import type { EditorSession } from "../core/auth/types.js";
import { D1_BOOKMARK_COOKIE } from "../core/db/index.js";
import { applyFieldSave, type SaveCollectionConfig } from "../core/editor/save.js";
import { applySettingsPatch, type SettingsPatchConfig } from "../core/editor/settings.js";
import type { EditorRouteEnv } from "../core/editor/shared.js";
import { applySaveDraft, type SaveDraftDeps } from "../core/editor/versions.js";
import { sanitizeRichHtml } from "../core/security/index.js";

/** The subset of Astro's `ActionError` codes the editor handlers emit. */
type ActionErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR";

/** The shape of Astro's `ActionError` constructor the handlers depend on —
 *  injected (see file header) so the toolkit needn't import `astro:actions`. */
export interface ActionErrorCtor {
  new (opts: { code: ActionErrorCode; message?: string }): Error;
}

/** The slice of an Astro `ActionAPIContext` the editor handlers read: the
 *  middleware-resolved `locals.editor`, plus `cookies` for the D1 bookmark. The
 *  Worker `env` is NOT read off the context — Astro v6+ removed
 *  `Astro.locals.runtime.env`, so it's supplied by the injected
 *  {@link EditorActionDeps.getEnv}. A real context (which carries much more)
 *  structurally satisfies this. */
export interface EditorActionContext {
  locals: {
    editor?: unknown;
  };
  /** Astro's `AstroCookies` (structurally). Used to persist the D1 session
   *  bookmark for read-your-writes on draft resume (#69). Optional so a bare
   *  test context still satisfies this type. */
  cookies?: {
    set(name: string, value: string, options?: Record<string, unknown>): void;
  };
}

/** The dependencies every editor Action shares: the injected `ActionError`, an
 *  optional reader for the editor session (defaulting to `locals.editor`), and the
 *  required `getEnv` that hands in the Worker bindings. */
export interface EditorActionDeps<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** Astro's `ActionError` class, injected (see file header). */
  ActionError: ActionErrorCtor;
  /** Resolve the editor session from the Action context. Default: `locals.editor`
   *  (set by `createLouiseMiddleware`). A falsy result answers 401. */
  getEditor?: (ctx: EditorActionContext) => unknown;
  /**
   * Resolve the Worker `env` (the D1 binding) for the Action. **Required** — Astro
   * v6+ removed `Astro.locals.runtime.env`, so there is no context field to default
   * to; inject the bindings explicitly, typically by closing over the Cloudflare
   * `env` (the `ctx` argument is available for per-request selection but usually
   * unused):
   *
   * ```ts
   * import { env } from "cloudflare:workers";
   * louiseSaveAction({ collections, ActionError, getEnv: () => env });
   * ```
   */
  getEnv: (ctx: EditorActionContext) => Env;
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

export interface LouiseSaveActionConfig<
  Env extends EditorRouteEnv = EditorRouteEnv,
> extends EditorActionDeps<Env> {
  /** Editable collections keyed by the client's `collection` slug — the same
   *  shape the raw `saveRoute` takes. */
  collections: Record<string, SaveCollectionConfig>;
  /** Rich-HTML sanitizer; defaults to louise-toolkit/security's `sanitizeRichHtml`. */
  sanitize?: (html: string) => string;
}

export interface LouiseSettingsActionConfig<Env extends EditorRouteEnv = EditorRouteEnv>
  extends EditorActionDeps<Env>, SettingsPatchConfig {}

/** The validated `saveDraft` input: which versioned row (`id`) plus the changed
 *  fields (`data`). The route takes `id` from the URL path + the fields as the
 *  body; the Action bundles both, since an Action call has no URL. */
export interface SaveDraftActionInput {
  id: number;
  data: Record<string, unknown>;
}

export interface LouiseSaveDraftActionConfig<Env extends EditorRouteEnv = EditorRouteEnv>
  extends EditorActionDeps<Env>, SaveDraftDeps<Env> {}

/** Map an `apply*` HTTP status onto an Astro `ActionError` code. */
function statusToCode(status: number): ActionErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status >= 500) return "INTERNAL_SERVER_ERROR";
  return "BAD_REQUEST";
}

type ResolvedDeps<Env extends EditorRouteEnv> = {
  ActionError: ActionErrorCtor;
  getEditor: (ctx: EditorActionContext) => unknown;
  getEnv: (ctx: EditorActionContext) => Env;
};

/** Resolve an editor Action's deps, filling the default `locals.editor` reader.
 *  `getEnv` has no default — Astro v6+ removed `locals.runtime.env`, so a safe one
 *  can't exist — and a missing one is a wiring error thrown here, at
 *  action-construction time, rather than a per-request 500 on an `undefined` env. */
function resolveDeps<Env extends EditorRouteEnv>(deps: EditorActionDeps<Env>): ResolvedDeps<Env> {
  if (typeof deps.getEnv !== "function") {
    throw new TypeError(
      "louise-toolkit/astro: `getEnv` is required — Astro v6+ removed " +
        "`Astro.locals.runtime.env`, so inject the Worker env explicitly, " +
        'e.g. `getEnv: () => env` from "cloudflare:workers".',
    );
  }
  return {
    ActionError: deps.ActionError,
    getEditor: deps.getEditor ?? ((ctx: EditorActionContext) => ctx.locals.editor),
    getEnv: deps.getEnv,
  };
}

/** Require the (middleware-resolved) editor session — a missing one is a 401 —
 *  and return it. CSRF/same-origin is Astro's default for Action POSTs, so only
 *  auth is ported. */
function requireEditor(
  resolved: ResolvedDeps<EditorRouteEnv>,
  ctx: EditorActionContext,
): EditorSession {
  const editor = resolved.getEditor(ctx);
  if (!editor) {
    throw new resolved.ActionError({ code: "UNAUTHORIZED", message: "Editor session required" });
  }
  return editor as EditorSession;
}

/** Throw the injected `ActionError` for an `apply*` failure — `never`, so a
 *  `if (!result.ok) throwActionError(...)` narrows the result to its ok branch. */
function throwActionError(ActionError: ActionErrorCtor, status: number, error: string): never {
  throw new ActionError({ code: statusToCode(status), message: error });
}

/**
 * Build the `{ input, handler }` config for the editor `save` Action (the inline
 * field-save). The site drops the result into `defineAction` (see file header).
 * The `input` schema is validated by Astro *before* the handler runs — replacing
 * the raw route's manual `request.json()` + `standardValidate` — and the handler
 * shares the raw route's store path via {@link applyFieldSave}, so a field is
 * validated once and written in exactly one place.
 */
export function louiseSaveAction<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: LouiseSaveActionConfig<Env>,
) {
  const resolved = resolveDeps(config);
  const sanitize = config.sanitize ?? sanitizeRichHtml;

  return {
    input: z.object({
      collection: z.string(),
      key: z.string(),
      field: z.string(),
      value: z.unknown(),
    }),
    handler: async (
      input: SaveActionInput,
      context: EditorActionContext,
    ): Promise<{ ok: true }> => {
      requireEditor(resolved, context);
      const result = await applyFieldSave(
        resolved.getEnv(context),
        config.collections,
        sanitize,
        input,
      );
      if (!result.ok) throwActionError(resolved.ActionError, result.status, result.error);
      return { ok: true };
    },
  };
}

/**
 * Build the `{ input, handler }` config for the editor `settings` Action (the
 * structured settings-panel patch). Mirrors {@link louiseSaveAction}: Astro
 * validates the patch object as `input`, and the handler shares the raw
 * `settingsRoute` store path via {@link applySettingsPatch} (media-strictness on
 * image keys, base-vs-`custom` partition, singleton write). Returns the `ignored`
 * (non-allowlisted) keys so the caller can surface what was dropped.
 */
export function louiseSettingsAction<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: LouiseSettingsActionConfig<Env>,
) {
  const resolved = resolveDeps(config);

  return {
    // A settings patch is an arbitrary object of allowlisted keys; the allowlist
    // (base columns + `custom` keys) is enforced in `applySettingsPatch`.
    input: z.record(z.string(), z.unknown()),
    handler: async (
      input: Record<string, unknown>,
      context: EditorActionContext,
    ): Promise<{ ok: true; ignored: string[] }> => {
      requireEditor(resolved, context);
      const result = await applySettingsPatch(resolved.getEnv(context), config, input);
      if (!result.ok) throwActionError(resolved.ActionError, result.status, result.error);
      return { ok: true, ignored: result.ignored };
    },
  };
}

/**
 * Build the `{ input, handler }` config for the editor `saveDraft` Action (the
 * versioned-page draft save). Mirrors {@link louiseSaveAction}, but the input
 * bundles the row `id` with the changed `data` (an Action call has no URL to carry
 * the id). The handler shares the raw `versionsRoute` store path via
 * {@link applySaveDraft} — the concurrent-surface merge base and the #70 KV
 * write-buffer — and returns that path's JSON body (a created `version`, or
 * `{ buffered: true }` when a write is coalesced into the buffer).
 */
export function louiseSaveDraftAction<Env extends EditorRouteEnv = EditorRouteEnv>(
  config: LouiseSaveDraftActionConfig<Env>,
) {
  const resolved = resolveDeps(config);

  return {
    input: z.object({
      id: z.number().int(),
      data: z.record(z.string(), z.unknown()),
    }),
    handler: async (
      input: SaveDraftActionInput,
      context: EditorActionContext,
    ): Promise<Record<string, unknown>> => {
      const editor = requireEditor(resolved, context);
      const result = await applySaveDraft(
        resolved.getEnv(context),
        config,
        editor,
        input.id,
        input.data,
      );
      if (!result.ok) throwActionError(resolved.ActionError, result.status, result.error);
      // Persist the D1 bookmark so this Action's draft is read-your-writes on the
      // next edit-mode load behind read replication (#69). Mirrors the raw
      // versionsRoute's Set-Cookie; no-op on a non-replicated D1.
      if (result.bookmark) {
        context.cookies?.set(D1_BOOKMARK_COOKIE, result.bookmark, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: true,
          maxAge: 60 * 60 * 8,
        });
      }
      return result.body;
    },
  };
}
