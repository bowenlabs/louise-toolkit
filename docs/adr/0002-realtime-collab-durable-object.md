# ADR 0002 — Real-time multi-editor collaboration via a per-page Durable Object

- **Status:** Proposed (2026-07-15)
- **Deciders:** Baylee (solo maintainer)
- **Issue:** #71 (milestone: Platform features push, epic #102)
- **Related:** #68 (auto-save), #70 (KV write-buffer), #69 (D1 Sessions API), #109 (drawer action footer)

## Context

Today the editor saves are **independent HTTP POSTs**. Each auto-save (#68) debounces
and `fetch`es `/api/louise/pages/:id/versions`; the server merges the partial edit over
the newest pending draft (`applySaveDraft`) and either buffers it in KV (#70) or writes a
D1 draft version. Two editors on the same page can still clobber each other — the
server-side draft-merge narrows the window but there is no live channel between clients, no
presence, and no signal that someone else is editing the same field.

#71 proposes turning editing into a **live-synced session**: a per-page **Durable Object**
(DO) using the **WebSocket Hibernation API** holds in-memory edit state, clients connect
over WebSocket, and the DO broadcasts presence + field changes and coalesces persistence to
D1. The issue flags this as "a real architectural addition… best delivered behind a flag,
versioned pages first," and lists four tasks: (1) DO skeleton, (2) presence + broadcast
protocol, (3) coalesced persistence, (4) client wiring behind an opt-in flag.

This ADR resolves the open design forks **before** any code so the four implementation PRs
have a fixed target. It follows ADR 0001's rule — *opinionated where it's expensive,
framework-agnostic where it's free* — so the DO is a first-class Cloudflare-native
primitive, and reuses the existing draft/versions machinery rather than forking a second
write path.

## Decision

Introduce **`EditSessionDO`**, a per-page Durable Object (keyed by collection + row id) that
acts as the live editing session for **versioned, realtime-opted-in** pages. Clients connect
over a hibernatable WebSocket; the DO owns authoritative in-memory field state + a presence
map, broadcasts changes to peers, and **coalesces persistence through the existing
`applySaveDraft` path**. It is **off by default**, opt-in per collection, and **degrades to
today's debounced-fetch auto-save** whenever the flag is off or the socket is unavailable.

The five forks, resolved:

### 1. DO ↔ auto-save relationship — **augment, don't replace**

The DO is the realtime coordinator **when the flag is on and the socket is connected**. The
existing debounced-fetch auto-save (#68) + KV buffer (#70) remain as the **fallback** for:
non-realtime pages, sites without the DO binding, and any client whose socket fails or drops.

- **Realtime on + connected:** the client publishes field changes over the socket; the DO
  broadcasts to peers and becomes the **coalescer** for that page (subsuming the per-page KV
  buffer's role — see #70), flushing to D1 on an idle/interval alarm.
- **Realtime off or socket down:** the client uses the current `saveDraft()` fetch path,
  unchanged.

Crucially, **persistence still lands through `applySaveDraft`** — the same merge-over-pending
snapshot, the same `${slug}_versions` write, the same publish/superseded-skip semantics, and
the same #69 D1 session. There is **one write path**; the DO is a new *front end* to it, not a
parallel store. This keeps drafts, version history, publish, and read-your-writes intact.

### 2. Reconciliation model — **field-level last-writer-wins + awareness/soft-locks, not a CRDT (yet)**

The editing surfaces are already **field-scoped** (a sections field value, an inline field),
and the server draft-merge is already field-level LWW. So v1 reconciliation matches that grain:

- **Structured fields** (text/number/select/sections field values): **LWW broadcast** — the
  last `change` for a field wins and is echoed to peers, with **awareness** ("Baylee is
  editing the hero") rendered from presence so a same-field collision is *visible*, not silent.
- **Rich-text body** (ProseMirror / the `[...slug]` body): LWW on a whole-document field is
  lossy if two people type at once, so v1 applies a **soft field-lock** — the first editor to
  focus the body claims it (`claim`), peers see it read-only + a "locked by Baylee" badge until
  `release`/disconnect. This is the v1 answer for the one field where character-level merge
  matters.

**Why not a CRDT now:** Yjs/Automarge would add a substantial dependency and rich-text
merge/transport complexity for a tool whose common case is *two editors on different fields*.
Field-level LWW + presence + a rich-text soft-lock covers that case and makes conflicts
observable. A **CRDT upgrade for the body field is an explicit future path** (swap the
soft-lock for a Yjs doc synced through the same DO), not a v1 requirement.

### 3. Flag surface — **opt-in, per collection, versioned pages first**

- **Server/codegen:** a `realtime: true` option on the collection config, sibling to
  `versions.drafts` (realtime **requires** drafts — the DO persists as drafts). This gates the
  DO route + any codegen.
- **Client:** `mountLouise({ realtime: true })` gates subscription; when the DO binding or
  socket is absent it silently falls back (§1).
- **Binding gate:** the server only advertises realtime when the `EDIT_SESSION` DO binding
  exists, so a site that hasn't provisioned the DO is unaffected.
- **Scope:** **versioned pages only** in v1 (per the issue). Non-versioned "edit on the live
  row" pages keep the direct-save path. Default **off** everywhere.

### 4. WS protocol — **small, versioned JSON envelope; server authoritative**

Envelope: `{ v: 1, t: <type>, ... }`. Types:

| type | dir | payload | purpose |
|------|-----|---------|---------|
| `hello` | c→s | `{ editorName }` | post-auth handshake (identity comes from the session, see §Auth; `editorName` is display only) |
| `welcome` | s→c | `{ you, peers, snapshot, locks }` | current presence + latest field snapshot + held locks |
| `presence` | s→c | `{ peers }` | join/leave/heartbeat diff |
| `change` | c→s / s→c | `{ field, value, rev }` | a field edit; server assigns/checks `rev`, rebroadcasts to peers |
| `claim` / `release` | c↔s | `{ field }` | acquire/release the rich-text soft-lock |
| `ack` | s→c | `{ rev }` | change persisted-intent acknowledged |
| `bye` | c→s | — | graceful close |

The DO holds authoritative field state + a `Map<socket, presence>`; it validates every
`change` (field is in the collection config; `claim` respected for locked fields), rebroadcasts
to the other sockets, and marks the page dirty for the next flush. Clients are **optimistic**
(apply locally, reconcile on the echoed `change`). The protocol is versioned (`v`) so it can
evolve.

### 5. Lifecycle, hibernation & persistence

- **Accept:** authenticate the upgrade (§Auth), then `this.ctx.acceptWebSocket(server)` — the
  hibernatable accept, so the DO sleeps between messages without dropping clients.
- **Handlers:** `webSocketMessage(ws, msg)`, `webSocketClose(ws, …)`, `webSocketError(ws, …)`.
- **Presence across hibernation:** stash each connection's identity with
  `ws.serializeAttachment({ editorId, editorName })` (≤16 KB) and rebuild the presence map from
  `this.ctx.getWebSockets()` + `deserializeAttachment()` on wake — no in-memory-only state.
- **Coalesced flush:** on the first dirtying `change`, schedule a flush via
  `this.ctx.storage.setAlarm(now + FLUSH_MS)` (alarms survive hibernation; a plain
  `setTimeout` would not). The `alarm()` handler calls **`applySaveDraft`** with the coalesced
  field snapshot, reusing #70's flush cadence semantics, then re-arms if still dirty. Publish
  stays an **explicit HTTP action** (unchanged) — the DO never auto-publishes.

## Auth & security

- The WebSocket **upgrade request** passes the **same guard as the editor routes** —
  `resolveEditor` + the same-origin check (`guardEditor`) — *before* `acceptWebSocket`. An
  unauthenticated or cross-origin upgrade is rejected with 401/403; no socket is accepted.
- Identity is taken from the **server-resolved editor session**, never from the client's
  `hello` payload (which is display-only), so a client can't spoof another editor.
- The DO is addressed by `EDIT_SESSION.idFromName(`${slug}:${id}`)`; the `{slug,id}` are
  validated + authorized server-side (mirroring `versionsRoute`), so there is no cross-page
  reach.
- `change` payloads are validated against the collection config (allowlisted fields) and
  sanitized on the persistence path exactly as `applySaveDraft` does today — the DO adds no new
  sanitizer bypass.

## Staging — four PRs (map to the issue's task list)

1. **DO skeleton + infra** (task 1): `EditSessionDO` with hibernatable accept, the auth'd
   upgrade route (mounted like the other `/api/louise/*` routes), wrangler binding + migration,
   a trivial echo + connection count, behind the `realtime` flag. No persistence yet.
2. **Presence + change-broadcast protocol** (task 2): the envelope above, authoritative field
   state, presence map (+ hibernation attachment), and the presence UI in the edit chrome
   (avatars / "editing the hero"). Still no D1 writes (in-memory session).
3. **Coalesced persistence** (task 3): alarm-driven flush through `applySaveDraft`, plus the
   rich-text soft-lock (`claim`/`release`). This is where realtime pages start persisting
   drafts via the DO instead of the client KV buffer.
4. **Client wiring** (task 4): the inline + sections surfaces (`packages/louise/src/client/`)
   subscribe/publish through the DO when `realtime` is on and the socket connects, with the
   debounced-fetch fallback wired for the off/failure paths.

Each PR is independently reviewable and shippable behind the default-off flag.

## Draft wrangler config (to apply at implementation time — not run here)

Modern declarative form (wrangler ≥ recent; SQLite-backed DO):

```jsonc
// workers/site/wrangler.jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "EDIT_SESSION", "class_name": "EditSessionDO" }]
  },
  "exports": {
    "EditSessionDO": { "type": "durable-object", "storage": "sqlite" }
  }
}
```

Legacy equivalent (if the installed wrangler still wants `migrations`):

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "EDIT_SESSION", "class_name": "EditSessionDO" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["EditSessionDO"] }]
}
```

DOs deploy with the Worker (no separate provisioning call), so — unlike D1 replication (#69)
or Queues (#77) — there is no pre-merge dashboard/API step; the binding + migration ship in the
deploy. Confirm the exact `exports`-vs-`migrations` form against the pinned wrangler version
when PR 1 lands.

## Consequences

**Positive**
- Real multi-editor collaboration + presence; same-field conflicts become visible.
- One write path — the DO reuses `applySaveDraft`, so drafts/versions/publish/#69 sessions all
  keep working; no second store to reconcile.
- Off by default and degradation-first, so it can ship incrementally with zero risk to
  existing sites.
- The DO's coalescing further relieves auto-save write volume (the #68/#70 motivation).

**Negative / risks**
- A new stateful primitive (DO) to own and test; WebSocket + hibernation + alarm code is
  trickier to test than a stateless route (mitigate with `getWebSockets`/attachment-level unit
  tests + an E2E in the astro-preview harness).
- Field-level LWW is intentionally not conflict-free for the rich-text body; the soft-lock is a
  UX compromise until a CRDT lands.
- Client complexity: two publish paths (socket vs fetch) with a fallback seam to keep correct.

**Non-goals (v1)**
- Not a CRDT / character-level rich-text merge (future upgrade path noted).
- Not realtime for non-versioned "edit the live row" pages.
- Not a third-party realtime service (see Alternatives).
- The DO never auto-publishes — publish stays explicit.

## Alternatives considered

- **CRDT-first (Yjs/Automerge through the DO).** Best-in-class rich-text merge, but a large
  dependency + transport/complexity cost for a mostly-different-fields workload. Deferred as the
  body-field upgrade path, not the v1 baseline.
- **Third-party realtime (Liveblocks / PartyKit / Ably).** Faster to presence, but adds an
  external dependency + cost + data-egress, and contradicts ADR 0001's Cloudflare-native core
  and the #103 self-hosted framing. A per-page DO *is* the native answer.
- **Keep polling / short-poll the drafts endpoint.** No new primitive, but no true presence, no
  live cursors, and it re-introduces the write-volume problem #70 fixed. Rejected.

## Open questions (to settle during PR 1–2)

- Presence heartbeat interval + idle-disconnect window.
- Flush cadence for the DO alarm vs. #70's `DEFAULT_FLUSH_MS` (reuse vs. tune for realtime).
- Whether `realtime` implies a specific `bufferKv` interaction on the fallback path, or the DO
  fully owns coalescing when connected (leaning: DO owns it when connected; KV buffer only on
  the fetch-fallback path).
