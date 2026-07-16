// The per-page live editing session Durable Object (ADR 0002 / #71). Mirrors the
// Workflows pattern (src/workflows/publish.ts): the SITE owns the runtime class +
// the wrangler `durable_objects` binding (it imports `cloudflare:workers`), while
// louise-toolkit/realtime ships the framework-agnostic session LOGIC this class
// delegates to. Keep it exported from src/worker.ts so wrangler's `class_name`
// resolves.

import { DurableObject } from "cloudflare:workers";
import { createEditSession, type EditSession } from "louise-toolkit/realtime";

export class EditSessionDO extends DurableObject<CloudflareEnv> {
  #session?: EditSession;

  // Lazy so it's rebuilt after a hibernation wake (a fresh instance); presence
  // is reconstructed from ctx.getWebSockets() + attachments, not this reference.
  #s(): EditSession {
    this.#session ??= createEditSession(this.ctx);
    return this.#session;
  }

  fetch(request: Request): Response {
    return this.#s().fetch(request);
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.#s().webSocketMessage(ws, message);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
    this.#s().webSocketClose(ws, code, reason, wasClean);
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    this.#s().webSocketError(ws, error);
  }
}
