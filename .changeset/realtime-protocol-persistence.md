---
"louise-toolkit": minor
---

Real-time multi-editor sessions — change-broadcast protocol + coalesced persistence (ADR 0002 / #71, tasks 2 + 3). The per-page `EditSessionDO` skeleton (#153/#156) grows from a presence handshake into a live editing session: authoritative field state, field-change broadcast, a rich-text soft-lock, and a hibernation-safe alarm that coalesces edits to D1 through the **existing** draft path.

- **Protocol (`louise-toolkit/realtime`).** Extends the versioned WS envelope with `change {field, value, rev}`, `claim`/`release {field}`, and `bye` (c→s) and `change {field, value, rev, from}`, `ack {rev}`, and `locks` (s→c); `welcome` now carries `{you, peers, snapshot, locks}`. `parseClientMessage` validates the new frames.
- **Authoritative state in `ctx.storage`.** Field values, the rev counter, held locks, the page target, and the last writer live in Durable Object storage, so they survive hibernation (an in-memory-only map would be lost when the DO sleeps). Presence is still rebuilt from `getWebSockets()` + each socket's attachment; the attachment now carries the full `EditorSession` (email/role never leave the DO — only `{id, name}` is fanned out).
- **Rich-text soft-lock.** `lockFields` (e.g. `["body"]`) are single-editor: only the lock holder may `change` them and their raw values are never broadcast (peers render them read-only and reload on release), so rich-text never crosses sockets un-sanitized. Other fields are last-writer-wins broadcast.
- **Coalesced flush = one write path.** `createEditSession(ctx, { fields, lockFields, persist, flushMs })` arms an alarm on the first dirtying edit; the `alarm()` handler hands the coalesced snapshot to a site-injected `persist`. The site wires `persist` to `applySaveDraft` (now re-exported from `louise-toolkit/editor`) with the same `pagesDraftDeps` the fetch auto-save + `saveDraft` Action use — same merge-over-pending-draft, same `${slug}_versions` write, same KV buffer. On failure the snapshot stays dirty and the alarm re-arms.
- **`realtime` collection flag.** `CollectionConfig.realtime` (sibling to `versions`); `defineCollection` rejects `realtime` without `versions.drafts` (realtime persists as drafts).
- The upgrade route now stamps the full editor identity (id/name/email/role) so the coalesced draft version is faithfully attributed.

Off by default and degradation-first: with no `EDIT_SESSION` binding the route 503s and nothing changes. Client wiring (presence UI, subscribe/publish with debounced-fetch fallback, soft-lock UI) lands next (task 4).
