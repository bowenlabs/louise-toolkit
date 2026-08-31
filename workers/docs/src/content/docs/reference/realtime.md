---
title: realtime
description: "louise-toolkit/realtime—per-page multi-editor sessions over a Durable Object: presence, change broadcast, a rich-text soft-lock, and coalesced persistence."
sidebar:
  order: 15
---

```ts
import {
  createEditSession,
  realtimeRoute,
  REALTIME_PROTOCOL_VERSION,
} from "louise-toolkit/realtime";
```

Per-page live editing: presence, field-change broadcast, a rich-text soft-lock,
and coalesced flushes to D1. Binding: a Durable Object namespace (the **site**
declares it). No required peers. See [ADR 0002](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0002-realtime-collab-durable-object.md).

## The ownership split—read this first

This is the one thing you cannot guess from the export list, and getting it wrong
is the difference between a working session and a build error:

- **The site owns the `DurableObject` subclass and the wrangler binding.** It is
  the side that imports `cloudflare:workers`.
- **This module owns the session logic** the subclass delegates to
  (`createEditSession`), plus the `WorkerRoute` that guards and forwards the
  upgrade.

Same pattern as [`louise-toolkit/workflows`](/reference/workflows/), and for the
same reason: a framework-agnostic library cannot import the Workers runtime
module that defines the base class.

```ts
// site worker.ts — the site owns this class
import { DurableObject } from "cloudflare:workers";
import { applySaveDraft } from "louise-toolkit/editor";
import { createEditSession } from "louise-toolkit/realtime";

export class EditSessionDO extends DurableObject<Env> {
  #s = createEditSession(this.ctx, {
    fields: Object.keys(pagesCollection.fields),
    lockFields: ["body"],
    persist: (snapshot, editor, target) =>
      applySaveDraft(this.env, pagesDraftDeps, editor, target.id, snapshot),
  });
  fetch(r: Request) {
    return this.#s.fetch(r);
  }
  webSocketMessage(ws, m) {
    return this.#s.webSocketMessage(ws, m);
  }
  webSocketClose(ws, c, r, w) {
    return this.#s.webSocketClose(ws, c, r, w);
  }
  webSocketError(ws, e) {
    return this.#s.webSocketError(ws, e);
  }
  alarm() {
    return this.#s.alarm();
  }
}
```

Every delegated method must be forwarded. `alarm()` is the one most easily
forgotten, and omitting it means edits broadcast fine and **never persist**.

## The route

```ts
function realtimeRoute<Env>(cfg: RealtimeRouteConfig<Env>): WorkerRoute<Env>;
```

Mounts `GET /api/louise/realtime/:slug/:id` as a WebSocket handshake. It guards
the upgrade as a same-origin, session-gated mutation (browsers do send `Origin` on
a WS handshake), then forwards to the per-page DO via `idFromName("<slug>:<id>")`—one Durable Object per page.

**The client never supplies its own identity.** The route resolves the editor
server-side and stamps it on the forwarded upgrade URL, so presence can't be
spoofed by a client that edits its own `hello`.

Return `undefined` from `namespace` (binding not provisioned) and the route
answers `503`, so realtime is cleanly absent rather than erroring.

## Session behaviour

`createEditSession(ctx, config)` handles:

| Message             |                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ |
| connect             | accepts a **hibernatable** socket, attaches identity, broadcasts presence                  |
| `hello`             | replies `welcome`—you, peers, the field snapshot, held locks                               |
| `change`            | validates the field, records it, `ack`s the rev, broadcasts to peers, arms the flush alarm |
| `claim` / `release` | acquires or releases a rich-text soft-lock, broadcasts locks                               |
| `alarm`             | flushes the coalesced snapshot through `persist`, re-arms if still dirty                   |
| disconnect          | releases that editor's locks, re-broadcasts presence and locks                             |

**All authoritative state lives in `ctx.storage`**—fields, rev counter, locks,
target, last writer—so it survives hibernation. An in-memory field map would be
lost the moment the DO sleeps between messages. Presence is rebuilt from
`ctx.getWebSockets()` plus each socket's attachment.

### The rich-text soft-lock

Fields named in `lockFields` behave differently from ordinary ones: only the lock
holder may `change` them, and **their values are not fanned out to peers at all**.
Peers render them read-only and reload on release.

That is deliberate—it keeps raw rich-text markup off the wire between sockets
rather than attempting to merge concurrent prose edits, which is the problem this
design avoids rather than solves.

### Coalesced persistence

`persist` is site-injected so the write path stays in your DO subclass—this
module never touches D1. It fires on an alarm every `flushMs` (default 10 s),
matching the KV draft-buffer cadence so both paths write at the same rhythm.

Omit `persist` for a presence-only session.

## The wire protocol is versioned

```ts
const REALTIME_PROTOCOL_VERSION = 1;
```

Every server message carries `v`. Bump it when the message shape changes so a
stale client can detect the mismatch instead of misreading fields. On inbound
messages `v` is optional and advisory.

`RealtimeServerMessage` is `welcome | presence | change | ack | locks | pong`;
`RealtimeClientMessage` is `hello | ping | change | claim | release | bye`.
`parseClientMessage` returns `null` on anything malformed rather than throwing—a garbage frame must not take down the session.

**Presence exposes only `{ id, name }`.** Email and role stay in the socket's
attachment and never leave the DO, so an editor's address isn't broadcast to
everyone else on the page.

## Types

`EditSession`, `EditSessionConfig`, `EditSessionPersist`, `EditSessionTarget`,
`RealtimePeer`, `RealtimeLocks`, `RealtimeServerMessage`, `RealtimeClientMessage`,
`RealtimeRouteConfig`. Constants: `REALTIME_PROTOCOL_VERSION`. Also
`presenceMessage` and `parseClientMessage`.
