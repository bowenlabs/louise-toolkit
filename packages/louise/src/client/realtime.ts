// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/client — the realtime WebSocket client (ADR 0002 / #71, task 4).
// The browser half of the per-page edit session: it connects to the authed
// upgrade route (`/api/louise/realtime/:slug/:id`), receives presence + field
// changes + locks, and publishes local edits — with a **degradation-first**
// contract: while the socket is down (or the DO binding is absent → the route
// 503s → the upgrade fails) it reports `connected() === false` so the editing
// surface keeps using its debounced-fetch auto-save. The DO is the coalescer only
// while connected.
//
// Framework-agnostic (no Solid, no DOM) like `autosave.ts`: the surfaces hand it
// callbacks and it owns the socket lifecycle (handshake, heartbeat, reconnect,
// outbound throttle). The message shapes mirror `core/realtime` (the server); they
// are versioned by `v` and kept small, so a copy here keeps the client bundle free
// of any server-module import.

/** Public option shape (mirrors `AutoSaveOption`). `true` enables with defaults; an
 *  object tunes the outbound throttle; `false`/`undefined` disable (off by default). */
export type RealtimeOption = boolean | { throttleMs?: number };

/** Normalize the public `realtime` option once, so both editing surfaces agree on
 *  the default (OFF — realtime is opt-in). */
export function resolveRealtime(opt: RealtimeOption | undefined): {
  enabled: boolean;
  throttleMs: number | undefined;
} {
  if (opt === true) return { enabled: true, throttleMs: undefined };
  if (opt && typeof opt === "object") return { enabled: true, throttleMs: opt.throttleMs };
  return { enabled: false, throttleMs: undefined };
}

/** WS envelope version (see `core/realtime`'s `REALTIME_PROTOCOL_VERSION`). */
const PROTOCOL_V = 1;

export interface RealtimePeer {
  id: string;
  name: string;
}
/** Held soft-locks: field name → the editor id currently holding it. */
export type RealtimeLocks = Record<string, string>;

/** The minimal `WebSocket` surface the client drives — so tests can inject a fake
 *  without a real socket. A DOM `WebSocket` satisfies it structurally. */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export interface RealtimeHandlers {
  /** Presence changed — the full peer list (includes you; the UI dedupes/excludes). */
  onPresence?(peers: RealtimePeer[]): void;
  /** Held soft-locks changed. */
  onLocks?(locks: RealtimeLocks): void;
  /** A peer edited a (non-lock-guarded) field — apply it optimistically. */
  onRemoteChange?(field: string, value: unknown): void;
  /** The current field snapshot at connect time (pending edits since the last flush). */
  onSnapshot?(snapshot: Record<string, unknown>): void;
  /** Socket up/down — the surface flips between publishing here and its fetch fallback. */
  onStatus?(connected: boolean): void;
}

export interface RealtimeSession {
  /** Publish a local field edit (trailing-throttled; coalesced per field). No-op
   *  while disconnected — the surface uses its debounced fetch then. */
  publish(field: string, value: unknown): void;
  /** Acquire a rich-text soft-lock (sent immediately). */
  claim(field: string): void;
  /** Release a soft-lock (sent immediately). */
  release(field: string): void;
  /** Whether the socket is currently open. */
  connected(): boolean;
  /** This editor's own presence, once the `welcome` handshake has landed. */
  you(): RealtimePeer | null;
  /** Close intentionally — stops heartbeat + reconnect. */
  close(): void;
}

export interface ConnectRealtimeOptions extends RealtimeHandlers {
  slug: string;
  id: number;
  /** Mount base. Default `/api/louise/realtime`. */
  path?: string;
  /** Trailing-throttle window for outbound changes, ms. Default 150. */
  throttleMs?: number;
  /** Heartbeat ping interval, ms. Default 25000 (keeps proxies from idling out). */
  heartbeatMs?: number;
  /** Cap on the reconnect backoff, ms. Default 15000. */
  maxBackoffMs?: number;
  /** Test seam — build the socket. Default `(url) => new WebSocket(url)`. */
  socketFactory?: (url: string) => WebSocketLike;
}

/** Up-to-two-letter initials for a presence avatar (e.g. "Ada Lovelace" → "AL"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** The presence peers to render — everyone but yourself, de-duped by id (the same
 *  editor can hold more than one socket, e.g. inline + sections on one page). */
export function otherPeers(peers: RealtimePeer[], meId: string | undefined): RealtimePeer[] {
  const seen = new Set<string>();
  const out: RealtimePeer[] = [];
  for (const p of peers) {
    if (p.id === meId || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

const OPEN = 1; // WebSocket.OPEN

type ServerMessage =
  | {
      t: "welcome";
      you: RealtimePeer;
      peers: RealtimePeer[];
      snapshot: Record<string, unknown>;
      locks: RealtimeLocks;
    }
  | { t: "presence"; peers: RealtimePeer[] }
  | { t: "change"; field: string; value: unknown; rev: number; from: string }
  | { t: "ack"; rev: number }
  | { t: "locks"; locks: RealtimeLocks }
  | { t: "pong" };

/** Resolve the WS URL from `location` (browser only). Tolerates a missing
 *  `location` (tests inject a `socketFactory` and ignore the URL). */
function wsUrl(path: string, slug: string, id: number): string {
  const loc = typeof location !== "undefined" ? location : undefined;
  const scheme = loc?.protocol === "https:" ? "wss:" : "ws:";
  const host = loc?.host ?? "localhost";
  return `${scheme}//${host}${path}/${encodeURIComponent(slug)}/${id}`;
}

/**
 * Open a realtime edit session. Returns immediately with a {@link RealtimeSession}
 * handle; the socket connects in the background and the handlers fire as messages
 * arrive. On an unexpected close it reconnects with exponential backoff and
 * re-handshakes, so a transient blip self-heals; `close()` stops it for good.
 */
export function connectRealtime(opts: ConnectRealtimeOptions): RealtimeSession {
  const path = opts.path ?? "/api/louise/realtime";
  const throttleMs = opts.throttleMs ?? 150;
  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 15_000;
  const makeSocket = opts.socketFactory ?? ((url: string) => new WebSocket(url) as WebSocketLike);

  let socket: WebSocketLike | null = null;
  let you: RealtimePeer | null = null;
  let closed = false; // intentional close — stop reconnecting
  let backoff = 1_000;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Trailing-throttle: latest pending value per field, flushed together.
  const pending = new Map<string, unknown>();
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  const isOpen = () => socket != null && socket.readyState === OPEN;

  const sendRaw = (msg: Record<string, unknown>): void => {
    if (!isOpen()) return;
    try {
      socket?.send(JSON.stringify({ v: PROTOCOL_V, ...msg }));
    } catch {
      /* socket raced closed */
    }
  };

  const flushPending = (): void => {
    throttleTimer = null;
    if (!isOpen()) return;
    for (const [field, value] of pending) sendRaw({ t: "change", field, value });
    pending.clear();
  };

  const stopTimers = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    if (throttleTimer) clearTimeout(throttleTimer);
    heartbeat = throttleTimer = null;
  };

  const handleMessage = (raw: unknown): void => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : String(raw)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.t) {
      case "welcome":
        you = msg.you;
        opts.onPresence?.(msg.peers);
        opts.onLocks?.(msg.locks);
        opts.onSnapshot?.(msg.snapshot);
        break;
      case "presence":
        opts.onPresence?.(msg.peers);
        break;
      case "change":
        opts.onRemoteChange?.(msg.field, msg.value);
        break;
      case "locks":
        opts.onLocks?.(msg.locks);
        break;
      // `ack` / `pong` are liveness only — nothing to apply.
    }
  };

  const open = (): void => {
    if (closed) return;
    let sock: WebSocketLike;
    try {
      sock = makeSocket(wsUrl(path, opts.slug, opts.id));
    } catch {
      scheduleReconnect(); // couldn't even construct — retry later
      return;
    }
    socket = sock;
    sock.onopen = () => {
      backoff = 1_000; // healthy connection resets the backoff
      sendRaw({ t: "hello" });
      heartbeat = setInterval(() => sendRaw({ t: "ping" }), heartbeatMs);
      opts.onStatus?.(true);
    };
    sock.onmessage = (ev) => handleMessage(ev?.data);
    sock.onclose = () => {
      stopTimers();
      socket = null;
      opts.onStatus?.(false);
      scheduleReconnect();
    };
    sock.onerror = () => {
      // Let onclose drive the reconnect; just make sure we're tearing down.
      try {
        sock.close();
      } catch {
        /* already closing */
      }
    };
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, backoff);
    backoff = Math.min(backoff * 2, maxBackoffMs);
  };

  open();

  return {
    publish(field, value) {
      pending.set(field, value);
      if (!isOpen()) {
        pending.clear(); // disconnected — the surface's fetch fallback owns this edit
        return;
      }
      if (throttleTimer == null) throttleTimer = setTimeout(flushPending, throttleMs);
    },
    claim(field) {
      sendRaw({ t: "claim", field });
    },
    release(field) {
      // Flush any throttled change FIRST: a release that overtook the field's last
      // pending edit would make the DO drop that edit (the lock is gone), losing
      // the final ≤throttleMs of typing. Same-socket order guarantees the change
      // lands while we still hold the lock, then the release.
      if (throttleTimer != null) {
        clearTimeout(throttleTimer);
        flushPending();
      }
      sendRaw({ t: "release", field });
    },
    connected: isOpen,
    you: () => you,
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      stopTimers();
      try {
        socket?.close(1000, "bye");
      } catch {
        /* already closing */
      }
      socket = null;
    },
  };
}
