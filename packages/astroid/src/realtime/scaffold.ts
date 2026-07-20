// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The realtime module (ADR 0002 / #71): per-page live editing over a Durable
// Object, opt-in via `modules: ["realtime"]`.
//
// The package description has claimed "multi-editor sites" since 0.1.0, and this
// is the half that makes it true for two people on the SAME page. (The other
// axis — multi-EDITOR, i.e. an org of accounts — was always real.) Without it
// two editors on one page clobber each other; the server-side draft merge
// narrows the window but there is no live channel, no presence, and no signal
// that someone else is in the same field.
//
// What Astroid generates and what it deliberately does NOT:
//
//   - The DO SUBCLASS is scaffold-once (`src/edit-session.ts`), because it must
//     import `cloudflare:workers` — a runtime-only specifier the toolkit can't
//     carry — and because its `persist` is the seam a project tunes. Louise
//     ships the session LOGIC it delegates to; this is the boilerplate around it.
//   - The wrangler `durable_objects` binding + `migrations` block, which is the
//     part nobody gets right from memory: a DO class needs a migration tag, and
//     a SQLite-backed one needs `new_sqlite_classes` rather than `new_classes`.
//   - The `realtimeRoute` upgrade endpoint, in the generated worker.
//
// Persistence goes through `applySaveDraft` — the SAME path the fetch auto-save
// uses. One write path, per the ADR: the DO is a new front end to it, not a
// parallel store, so drafts, version history, publish, and read-your-writes all
// stay intact.

import type { AstroidConfig } from "../config.js";

/** The DO namespace binding name. Fixed, like the portal's prefixes: the client
 *  and the route both address it, and a rename is a silent 503. */
export const ASTROID_REALTIME_BINDING = "EDIT_SESSION";

/** The exported class name wrangler resolves for the binding. Must match the
 *  `class_name` in wrangler.jsonc AND be re-exported from the worker entry. */
export const ASTROID_EDIT_SESSION_CLASS = "EditSessionDO";

/** Migration tag for the DO class. Wrangler requires one; `v1` is the first. */
export const ASTROID_REALTIME_MIGRATION_TAG = "v1";

/** Is the realtime module switched on for this project? */
export function usesRealtime(config: AstroidConfig): boolean {
  return (config.modules ?? []).includes("realtime");
}

/**
 * `src/edit-session.ts` — the site-owned Durable Object subclass.
 *
 * Scaffold-once: `persist` is where a project decides what a flush means, and
 * the lock/field sets are tuning. What Astroid fixes is the delegation shape,
 * because getting it wrong fails in ways that look like anything but a bug in
 * this file — a missing `webSocketClose` leaks presence forever, a non-lazy
 * session breaks after the first hibernation wake.
 *
 * Returns null when the project has no realtime module.
 */
export function generateAstroidEditSession(config: AstroidConfig): string | null {
  if (!usesRealtime(config)) return null;

  return [
    "// The per-page live editing session Durable Object (ADR 0002 / #71).",
    "//",
    "// Scaffolded once and yours to edit — `persist` in particular. What should NOT",
    "// change is the delegation: every handler forwards to the session object, and",
    "// the session is built LAZILY. A Durable Object is re-instantiated after a",
    "// hibernation wake, so a session captured in a field initializer would be",
    "// rebuilt anyway; the authoritative state lives in `ctx.storage` and the socket",
    "// attachments, never in this class.",
    "//",
    "// This class must stay EXPORTED FROM src/worker.ts (it is, via a re-export) or",
    "// wrangler can't resolve the `class_name` in the durable_objects binding.",
    "",
    'import { DurableObject } from "cloudflare:workers";',
    'import { applySaveDraft } from "louise-toolkit/editor";',
    'import { createEditSession, type EditSession } from "louise-toolkit/realtime";',
    'import { astroidPagesCollection } from "astroidjs";',
    'import astroidConfig from "../astroid.config.js";',
    'import { pages, pagesVersions } from "./schema.js";',
    "",
    "const pagesCollection = astroidPagesCollection(astroidConfig);",
    "",
    `export class ${ASTROID_EDIT_SESSION_CLASS} extends DurableObject<CloudflareEnv> {`,
    "  #session?: EditSession;",
    "",
    "  #s(): EditSession {",
    "    this.#session ??= createEditSession(this.ctx, {",
    "      // Allowlist = the collection's editable fields. A `change` for anything",
    "      // else is dropped here as a cheap first gate; applySaveDraft re-validates",
    "      // the merged draft on persist, so this is not the security boundary.",
    "      fields: Object.keys(pagesCollection.fields),",
    "      // The rich-text body is the one field where character-level merge matters,",
    "      // so it takes a soft-lock (one editor at a time) instead of being",
    "      // last-writer-wins clobbered. Locked values are never fanned out to peers,",
    "      // so raw rich text doesn't cross sockets.",
    '      lockFields: ["body"],',
    "      persist: async (snapshot, editor, target) => {",
    "        // Guard the collection: only `pages` is realtime, and a stray target",
    "        // must never write into the wrong table.",
    '        if (target.slug !== "pages") return;',
    "        // The SAME merge-over-pending-draft path the fetch auto-save uses —",
    "        // one write path, so drafts/history/publish semantics are identical.",
    "        //",
    "        // No `bufferKv` here on purpose: the DO's alarm IS the coalescer for",
    "        // this page, so routing through the KV write-buffer as well would be",
    "        // two layers of coalescing over one stream of edits.",
    "        const result = await applySaveDraft(",
    "          this.env,",
    "          { table: pages, versionsTable: pagesVersions, config: pagesCollection },",
    "          editor,",
    "          target.id,",
    "          snapshot,",
    "        );",
    "        // A THROW (D1 down) propagates so the alarm keeps the snapshot dirty",
    "        // and retries. An `ok: false` is terminal — a deleted row, an invalid",
    "        // draft — which a retry can't fix, so let the alarm clear it, but say",
    "        // so rather than dropping it silently.",
    "        if (!result.ok) {",
    "          console.warn(",
    "            `[realtime] draft flush for pages:${target.id} rejected: ${result.status} ${result.error}`,",
    "          );",
    "        }",
    "      },",
    "    });",
    "    return this.#session;",
    "  }",
    "",
    "  fetch(request: Request): Promise<Response> {",
    "    return this.#s().fetch(request);",
    "  }",
    "",
    "  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {",
    "    return this.#s().webSocketMessage(ws, message);",
    "  }",
    "",
    "  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {",
    "    return this.#s().webSocketClose(ws, code, reason, wasClean);",
    "  }",
    "",
    "  webSocketError(ws: WebSocket, error: unknown): Promise<void> {",
    "    return this.#s().webSocketError(ws, error);",
    "  }",
    "",
    "  alarm(): Promise<void> {",
    "    return this.#s().alarm();",
    "  }",
    "}",
    "",
  ].join("\n");
}

/**
 * The `CloudflareEnv` member the realtime module adds, as a block
 * `create-astroid` substitutes into `src/env.d.ts`. Empty without the module —
 * a project that types a binding its wrangler.jsonc never creates is making a
 * promise it doesn't keep.
 */
export function generateAstroidRealtimeEnv(config: AstroidConfig): string {
  if (!usesRealtime(config)) return "";
  return [
    "  /** Durable Object namespace for the per-page live editing session (ADR 0002).",
    "   *  The realtime route answers 503 without it, so realtime is cleanly absent",
    "   *  rather than erroring. */",
    `  ${ASTROID_REALTIME_BINDING}: DurableObjectNamespace;`,
  ].join("\n");
}
