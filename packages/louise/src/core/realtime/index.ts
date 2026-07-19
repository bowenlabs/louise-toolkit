// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/realtime — per-page live editing session over a Durable Object
// (ADR 0002 / #71). This is the change-broadcast + coalesced-persistence slice
// (tasks 2 + 3): the session now owns authoritative field state, broadcasts field
// changes, mediates a rich-text soft-lock, and flushes coalesced edits to D1 on a
// hibernation-safe alarm through a site-injected `persist` callback.
//
// Following the louise-toolkit/workflows pattern, the SITE owns the `DurableObject`
// subclass + the wrangler binding (it imports `cloudflare:workers`); this module
// provides the session LOGIC the subclass delegates to (`createEditSession`) and
// the `WorkerRoute` that guards + forwards the upgrade. The runtime types
// (`DurableObjectState`, `DurableObjectNamespace`, `WebSocket`, `WebSocketPair`)
// are ambient (@cloudflare/workers-types), so nothing runtime-only is imported.
//
//   // site worker.ts (owns the class + wrangler `durable_objects` binding):
//   import { DurableObject } from "cloudflare:workers";
//   import { applySaveDraft } from "louise-toolkit/editor";
//   import { createEditSession } from "louise-toolkit/realtime";
//   export class EditSessionDO extends DurableObject<Env> {
//     #s = createEditSession(this.ctx, {
//       fields: Object.keys(pagesCollection.fields),
//       lockFields: ["body"],
//       persist: (snapshot, editor, target) =>
//         applySaveDraft(this.env, pagesDraftDeps, editor, target.id, snapshot),
//     });
//     fetch(r: Request) { return this.#s.fetch(r); }
//     webSocketMessage(ws, m) { return this.#s.webSocketMessage(ws, m); }
//     webSocketClose(ws, c, r, w) { return this.#s.webSocketClose(ws, c, r, w); }
//     webSocketError(ws, e) { return this.#s.webSocketError(ws, e); }
//     alarm() { return this.#s.alarm(); }
//   }

import type { EditorSession } from "../auth/types.js";
import { type EditorRouteEnv, guardEditor, json, type ResolveEditor } from "../editor/shared.js";
import type { WorkerRoute } from "../worker/index.js";

/** WS envelope version; bump if the message shape changes (clients check `v`). */
export const REALTIME_PROTOCOL_VERSION = 1;

/** Who is in a session — broadcast for presence. Resolved from the editor session
 *  by the route (see {@link realtimeRoute}), never trusted from the client. Only
 *  the display slice ({@link RealtimePeer}) is fanned out — email/role stay in the
 *  socket's attachment and never leave the DO. */
export interface RealtimePeer {
  id: string;
  name: string;
}

/** Held soft-locks: field name → the editor id currently holding it. */
export type RealtimeLocks = Record<string, string>;

/** Server → client messages (ADR §4). */
export type RealtimeServerMessage =
  | {
      v: number;
      t: "welcome";
      you: RealtimePeer;
      peers: RealtimePeer[];
      snapshot: Record<string, unknown>;
      locks: RealtimeLocks;
    }
  | { v: number; t: "presence"; peers: RealtimePeer[] }
  | { v: number; t: "change"; field: string; value: unknown; rev: number; from: string }
  | { v: number; t: "ack"; rev: number }
  | { v: number; t: "locks"; locks: RealtimeLocks }
  | { v: number; t: "pong" };

/** Client → server messages (ADR §4). `v` is optional/advisory on the way in. */
export type RealtimeClientMessage =
  | { v?: number; t: "hello" }
  | { v?: number; t: "ping" }
  | { v?: number; t: "change"; field: string; value: unknown; rev?: number }
  | { v?: number; t: "claim"; field: string }
  | { v?: number; t: "release"; field: string }
  | { v?: number; t: "bye" };

// The route stamps these on the forwarded upgrade URL so the DO can attach the
// server-resolved identity — the client never provides its own presence. Carried
// as query params (not headers): forwarding a WebSocket upgrade must reuse the
// original request so its `Upgrade`/`Connection` headers survive — those are
// forbidden header names, so they can't be re-set on a reconstructed request —
// and the DO is only reachable through this authed route, never by the client.
const EDITOR_ID_PARAM = "_eid";
const EDITOR_NAME_PARAM = "_ename";
const EDITOR_EMAIL_PARAM = "_eemail";
const EDITOR_ROLE_PARAM = "_erole";

/** Fallback identity for a socket with no (or a corrupt) attachment. */
const DEFAULT_EDITOR: EditorSession = { userId: "", email: "", name: "Editor", role: "" };

/** DO-side coalescing cadence, ms. Mirrors the #70 KV buffer flush window so the
 *  DO front-end and the fetch-fallback path write D1 at the same rhythm. */
const DEFAULT_FLUSH_MS = 10_000;

// Durable-storage keys. Field state + the rev counter + the held locks + the page
// target + the last writer all live in `ctx.storage`, so they survive hibernation
// (an in-memory-only field map would be lost when the DO sleeps between messages).
const FIELD_PREFIX = "field:";
const LOCK_PREFIX = "lock:";
const REV_KEY = "rev";
const TARGET_KEY = "target";
const LAST_WRITER_KEY = "lastWriter";

/** Which page a session persists to — parsed from the upgrade path, stashed so the
 *  alarm flush (no request in scope) knows where to write. */
export interface EditSessionTarget {
  slug: string;
  id: number;
}

/** The site-injected coalesced flush. Kept out of this framework-agnostic module
 *  so persistence (D1 / the versioned draft path) stays in the site's DO subclass. */
export type EditSessionPersist = (
  snapshot: Record<string, unknown>,
  editor: EditorSession,
  target: EditSessionTarget,
) => void | Promise<void>;

export interface EditSessionConfig {
  /** Allowlist — a `change` for any other field is dropped (mirrors the collection
   *  config; the persist path re-validates, so this is a cheap first gate). */
  fields: readonly string[];
  /** Fields under the rich-text soft-lock (e.g. `["body"]`): only the lock holder
   *  may `change` them and their values are NOT fanned out to peers (peers render
   *  them read-only and reload on release), so raw rich-text never crosses sockets. */
  lockFields?: readonly string[];
  /** Coalesced flush to D1. Omit for a presence-only session (no persistence). */
  persist?: EditSessionPersist;
  /** Alarm cadence, ms. Default {@link DEFAULT_FLUSH_MS} (10s). */
  flushMs?: number;
  /** Injectable clock for tests. Default `Date.now`. */
  now?: () => number;
}

/** The editor attached to a socket (full session, set at accept time), or a safe
 *  default. The attachment carries email/role for the persist author; presence
 *  only ever exposes {@link peerOf}. */
function editorOf(ws: WebSocket): EditorSession {
  return (ws.deserializeAttachment() as EditorSession | null) ?? DEFAULT_EDITOR;
}

/** The display-only presence slice of a socket's attached editor. */
function peerOf(ws: WebSocket): RealtimePeer {
  const e = editorOf(ws);
  return { id: e.userId, name: e.name };
}

/** The last two non-empty path segments are `<slug>/<id>` regardless of the mount
 *  base — robust to a re-pointed base. */
function targetFromUrl(rawUrl: string): { slug?: string; id?: string } {
  const parts = new URL(rawUrl).pathname.split("/").filter(Boolean);
  const id = parts.pop();
  const slug = parts.pop();
  return { slug, id };
}

/** The presence message for a set of connected sockets. Exported for tests. */
export function presenceMessage(sockets: readonly WebSocket[]): RealtimeServerMessage {
  return { v: REALTIME_PROTOCOL_VERSION, t: "presence", peers: sockets.map(peerOf) };
}

/** Parse a raw WS frame into a known client message, or `null`. Exported for tests. */
export function parseClientMessage(raw: string | ArrayBuffer): RealtimeClientMessage | null {
  try {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const msg = JSON.parse(text) as {
      t?: unknown;
      field?: unknown;
      value?: unknown;
      rev?: unknown;
    };
    switch (msg?.t) {
      case "hello":
      case "ping":
      case "bye":
        return { t: msg.t };
      case "change":
        if (typeof msg.field !== "string") return null;
        return {
          t: "change",
          field: msg.field,
          value: msg.value,
          rev: typeof msg.rev === "number" ? msg.rev : undefined,
        };
      case "claim":
      case "release":
        if (typeof msg.field !== "string") return null;
        return { t: msg.t, field: msg.field };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** The hibernatable-WebSocket handlers a site's DO subclass delegates to. */
export interface EditSession {
  fetch(request: Request): Promise<Response>;
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void>;
  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void>;
  webSocketError(ws: WebSocket, error: unknown): Promise<void>;
  /** Fires on the coalescing alarm — flushes dirty fields through `config.persist`. */
  alarm(): Promise<void>;
}

/**
 * Build the per-page edit-session logic over a Durable Object's `ctx`
 * (`DurableObjectState`):
 *  - **connect** → accept a *hibernatable* socket (`ctx.acceptWebSocket`), attach
 *    the editor identity from the forwarded params, stash the page target,
 *    broadcast presence;
 *  - **`hello`** → reply `welcome` (you + peers + the current field snapshot +
 *    held locks); **`ping`** → `pong`;
 *  - **`change`** → validate the field, record it in `ctx.storage`, `ack` the rev,
 *    broadcast to peers (except lock-guarded fields), and arm the coalescing alarm;
 *  - **`claim`/`release`** → acquire/release a rich-text soft-lock, broadcast locks;
 *  - **`alarm`** → flush the coalesced dirty snapshot through `config.persist`
 *    (the existing `applySaveDraft` path — one write path), re-arm if still dirty;
 *  - **disconnect** → release that editor's locks, re-broadcast presence + locks.
 *
 * All authoritative state (fields, rev, locks, target, last writer) lives in
 * `ctx.storage`, so it survives hibernation — presence itself is rebuilt from
 * `ctx.getWebSockets()` + each socket's `serializeAttachment`.
 */
export function createEditSession(ctx: DurableObjectState, config: EditSessionConfig): EditSession {
  const fields = new Set(config.fields);
  const lockFields = new Set(config.lockFields ?? []);
  const flushMs = config.flushMs ?? DEFAULT_FLUSH_MS;
  const now = config.now ?? (() => Date.now());
  const storage = ctx.storage;

  const send = (ws: WebSocket, msg: RealtimeServerMessage): void => {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already gone */
    }
  };
  const broadcast = (sockets: readonly WebSocket[], msg: RealtimeServerMessage): void => {
    const raw = JSON.stringify(msg);
    for (const ws of sockets) {
      try {
        ws.send(raw);
      } catch {
        /* skip a closed socket */
      }
    }
  };

  const readSnapshot = async (): Promise<Record<string, unknown>> => {
    const entries = await storage.list<unknown>({ prefix: FIELD_PREFIX });
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k.slice(FIELD_PREFIX.length)] = v;
    return out;
  };
  const readLocks = async (): Promise<RealtimeLocks> => {
    const entries = await storage.list<string>({ prefix: LOCK_PREFIX });
    const out: RealtimeLocks = {};
    for (const [k, v] of entries) out[k.slice(LOCK_PREFIX.length)] = v;
    return out;
  };
  const broadcastLocks = async (sockets: readonly WebSocket[]): Promise<void> => {
    broadcast(sockets, { v: REALTIME_PROTOCOL_VERSION, t: "locks", locks: await readLocks() });
  };
  // Arm the coalescing alarm on the first dirtying edit and leave it — so it fires
  // `flushMs` after the burst STARTED, coalescing everything in between into one
  // flush (resetting on every edit would starve a continuous typer's saves).
  const armAlarm = async (): Promise<void> => {
    if (!config.persist) return;
    if ((await storage.getAlarm()) == null) await storage.setAlarm(now() + flushMs);
  };
  const releaseEditorLocks = async (editorId: string): Promise<void> => {
    const entries = await storage.list<string>({ prefix: LOCK_PREFIX });
    const drop: string[] = [];
    for (const [k, holder] of entries) if (holder === editorId) drop.push(k);
    if (drop.length > 0) await storage.delete(drop);
  };

  const onChange = async (ws: WebSocket, field: string, value: unknown): Promise<void> => {
    if (!fields.has(field)) return; // unknown field — drop (persist path re-validates)
    const me = peerOf(ws).id;
    const locked = lockFields.has(field);
    if (locked) {
      const holder = await storage.get<string>(`${LOCK_PREFIX}${field}`);
      if (holder && holder !== me) return; // someone else holds the soft-lock
    }
    const rev = ((await storage.get<number>(REV_KEY)) ?? 0) + 1;
    await storage.put(`${FIELD_PREFIX}${field}`, value);
    await storage.put(REV_KEY, rev);
    await storage.put(LAST_WRITER_KEY, editorOf(ws)); // authors the coalesced draft
    await armAlarm();
    send(ws, { v: REALTIME_PROTOCOL_VERSION, t: "ack", rev });
    // Peers get live structured-field changes; lock-guarded rich fields stay
    // single-editor (peers render them read-only), so raw rich-text is never fanned out.
    if (!locked) {
      const others = ctx.getWebSockets().filter((s) => s !== ws);
      broadcast(others, { v: REALTIME_PROTOCOL_VERSION, t: "change", field, value, rev, from: me });
    }
  };

  const onClaim = async (ws: WebSocket, field: string): Promise<void> => {
    if (!lockFields.has(field)) return;
    const me = peerOf(ws).id;
    const holder = await storage.get<string>(`${LOCK_PREFIX}${field}`);
    if (holder === me) return;
    if (holder) {
      await broadcastLocks([ws]); // already held — tell the asker who has it
      return;
    }
    await storage.put(`${LOCK_PREFIX}${field}`, me);
    await broadcastLocks(ctx.getWebSockets());
  };

  const onRelease = async (ws: WebSocket, field: string): Promise<void> => {
    const me = peerOf(ws).id;
    const holder = await storage.get<string>(`${LOCK_PREFIX}${field}`);
    if (holder !== me) return; // only the holder can release
    await storage.delete(`${LOCK_PREFIX}${field}`);
    await broadcastLocks(ctx.getWebSockets());
  };

  const onDisconnect = async (ws: WebSocket): Promise<void> => {
    await releaseEditorLocks(peerOf(ws).id);
    const others = ctx.getWebSockets().filter((s) => s !== ws);
    broadcast(others, presenceMessage(others));
    await broadcastLocks(others);
  };

  return {
    async fetch(request) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const params = new URL(request.url).searchParams;
      const editor: EditorSession = {
        userId: params.get(EDITOR_ID_PARAM) ?? "",
        email: params.get(EDITOR_EMAIL_PARAM) ?? "",
        name: params.get(EDITOR_NAME_PARAM) || "Editor",
        role: params.get(EDITOR_ROLE_PARAM) ?? "",
      };
      // Hibernatable accept — the DO can sleep between messages without dropping
      // this client. Attach identity so presence rebuilds after a wake.
      ctx.acceptWebSocket(server);
      server.serializeAttachment(editor);
      // Remember which page this DO serves, for the alarm flush (no request there).
      const { slug, id: idStr } = targetFromUrl(request.url);
      const id = Number(idStr);
      if (slug && Number.isInteger(id))
        await storage.put<EditSessionTarget>(TARGET_KEY, { slug, id });
      broadcast(ctx.getWebSockets(), presenceMessage(ctx.getWebSockets()));
      return new Response(null, { status: 101, webSocket: client });
    },

    async webSocketMessage(ws, message) {
      const msg = parseClientMessage(message);
      if (!msg) return;
      switch (msg.t) {
        case "hello":
          send(ws, {
            v: REALTIME_PROTOCOL_VERSION,
            t: "welcome",
            you: peerOf(ws),
            peers: ctx.getWebSockets().map(peerOf),
            snapshot: await readSnapshot(),
            locks: await readLocks(),
          });
          break;
        case "ping":
          send(ws, { v: REALTIME_PROTOCOL_VERSION, t: "pong" });
          break;
        case "change":
          await onChange(ws, msg.field, msg.value);
          break;
        case "claim":
          await onClaim(ws, msg.field);
          break;
        case "release":
          await onRelease(ws, msg.field);
          break;
        case "bye":
          try {
            ws.close(1000, "bye");
          } catch {
            /* already closing */
          }
          break;
      }
    },

    async webSocketClose(ws, code, reason) {
      try {
        ws.close(code, reason);
      } catch {
        /* already closing */
      }
      await onDisconnect(ws);
    },

    async webSocketError(ws) {
      try {
        ws.close(1011, "error");
      } catch {
        /* already closing */
      }
      await onDisconnect(ws);
    },

    async alarm() {
      const entries = await storage.list<unknown>({ prefix: FIELD_PREFIX });
      if (entries.size > 0 && config.persist) {
        const snapshot: Record<string, unknown> = {};
        const keys: string[] = [];
        for (const [k, v] of entries) {
          snapshot[k.slice(FIELD_PREFIX.length)] = v;
          keys.push(k);
        }
        const target = await storage.get<EditSessionTarget>(TARGET_KEY);
        const editor = (await storage.get<EditorSession>(LAST_WRITER_KEY)) ?? DEFAULT_EDITOR;
        if (target) {
          try {
            await config.persist(snapshot, editor, target);
            // Clear only what we flushed — edits that arrived mid-flush stay dirty.
            await storage.delete(keys);
          } catch {
            // Persist failed — leave the snapshot dirty and re-arm below to retry.
          }
        }
      }
      // Re-arm if anything is still pending (a retry, or edits during the flush).
      const remaining = await storage.list<unknown>({ prefix: FIELD_PREFIX });
      if (remaining.size > 0) await armAlarm();
    },
  };
}

export interface RealtimeRouteConfig<Env extends EditorRouteEnv = EditorRouteEnv> {
  /** Resolve the editor session (site wraps its own auth). */
  resolveEditor: ResolveEditor<Env>;
  /**
   * The DO namespace binding — typically `(env) => env.EDIT_SESSION`. Return
   * `undefined` (binding not provisioned) and the route answers 503, so realtime
   * is cleanly absent rather than erroring.
   */
  namespace: (env: Env) => DurableObjectNamespace | undefined;
  /** Mount base. Default `/api/louise/realtime`. */
  path?: string;
}

/**
 * Build the realtime upgrade route: `GET /api/louise/realtime/:slug/:id` (a
 * WebSocket handshake). It guards the upgrade as a same-origin, session-gated
 * mutation (a browser sends `Origin` on a WS handshake), then forwards it to the
 * per-page Durable Object (`idFromName("<slug>:<id>")`), stamping the
 * server-resolved editor identity so the DO never trusts the client for presence.
 * Returns `undefined` for a path it doesn't own so `composeWorker` falls through.
 */
export function realtimeRoute<Env extends EditorRouteEnv = EditorRouteEnv>(
  cfg: RealtimeRouteConfig<Env>,
): WorkerRoute<Env> {
  const base = cfg.path ?? "/api/louise/realtime";

  return async (request, env) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${base}/`)) return undefined;
    const [slug, idStr, ...extra] = url.pathname.slice(base.length + 1).split("/");
    if (!slug || !idStr || extra.length > 0) return undefined;

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade" }, 426);
    }
    const ns = cfg.namespace(env);
    if (!ns) return json({ error: "Realtime not available" }, 503);

    const g = await guardEditor(request, env, cfg.resolveEditor, true);
    if ("response" in g) return g.response;

    const id = Number(idStr);
    if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);

    // One DO per page. Forward the *original* request (so the WebSocket upgrade
    // headers survive), just re-pointed at a URL carrying the resolved identity —
    // the full session (id/name/email/role) so the coalesced flush is attributed.
    const stub = ns.get(ns.idFromName(`${slug}:${id}`));
    const doUrl = new URL(url);
    doUrl.searchParams.set(EDITOR_ID_PARAM, g.editor.userId);
    doUrl.searchParams.set(EDITOR_NAME_PARAM, g.editor.name ?? "Editor");
    doUrl.searchParams.set(EDITOR_EMAIL_PARAM, g.editor.email ?? "");
    doUrl.searchParams.set(EDITOR_ROLE_PARAM, g.editor.role ?? "");
    return stub.fetch(new Request(doUrl, request));
  };
}
