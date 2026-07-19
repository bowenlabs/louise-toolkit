// The per-page live editing session Durable Object (ADR 0002 / #71). Mirrors the
// Workflows pattern (src/workflows/publish.ts): the SITE owns the runtime class +
// the wrangler `durable_objects` binding (it imports `cloudflare:workers`), while
// louise-toolkit/realtime ships the framework-agnostic session LOGIC this class
// delegates to. Keep it exported from src/worker.ts so wrangler's `class_name`
// resolves.
//
// This class injects the coalesced flush: on the alarm, the session hands its
// dirty field snapshot to `applySaveDraft` — the SAME merge-over-pending-draft
// path the fetch auto-save + the saveDraft Astro Action use (shared deps via
// `pagesDraftDeps`), so realtime and the fallback write through one write path.

import { DurableObject } from "cloudflare:workers";
import { applySaveDraft } from "louise-toolkit/editor";
import { createEditSession, type EditSession } from "louise-toolkit/realtime";
import { pagesDraftDeps } from "../lib/louise/versioned-pages.js";
import { pagesCollection } from "../pages-collection.js";

export class EditSessionDO extends DurableObject<CloudflareEnv> {
  #session?: EditSession;

  // Lazy so it's rebuilt after a hibernation wake (a fresh instance); the
  // authoritative field/lock/presence state lives in ctx.storage + socket
  // attachments, not this reference.
  #s(): EditSession {
    this.#session ??= createEditSession(this.ctx, {
      // Allowlist = the collection's editable fields; a `change` for anything else
      // is dropped (applySaveDraft re-validates on persist).
      fields: Object.keys(pagesCollection.fields),
      // The rich-text body is the one field where character-level merge matters —
      // soft-lock it (single editor at a time) rather than LWW-clobber it.
      lockFields: ["body"],
      // Coalesced flush → the versioned draft path. Only "pages" is realtime today;
      // guard the slug so a stray target can never write the wrong collection.
      persist: async (snapshot, editor, target) => {
        if (target.slug !== "pages") return;
        const result = await applySaveDraft(this.env, pagesDraftDeps, editor, target.id, snapshot);
        // applySaveDraft THROWS on a transient failure (D1 down) — that propagates
        // so the alarm keeps the snapshot dirty and retries. A returned `ok:false`
        // is a terminal outcome (404 row gone / 422 invalid) that a retry can't fix,
        // so we let the alarm clear the snapshot; surface it for logs rather than
        // dropping it silently.
        if (!result.ok) {
          console.warn(
            `[realtime] draft flush for pages:${target.id} rejected: ${result.status} ${result.error}`,
          );
        }
      },
    });
    return this.#session;
  }

  fetch(request: Request): Promise<Response> {
    return this.#s().fetch(request);
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.#s().webSocketMessage(ws, message);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    return this.#s().webSocketClose(ws, code, reason, wasClean);
  }

  webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    return this.#s().webSocketError(ws, error);
  }

  alarm(): Promise<void> {
    return this.#s().alarm();
  }
}
