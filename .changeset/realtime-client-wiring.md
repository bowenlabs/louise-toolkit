---
"louise-toolkit": minor
---

Real-time multi-editor client wiring (ADR 0002 / #71, task 4) — the browser half of the per-page edit session, completing #71. Opt-in, versioned pages only, degradation-first.

- **WS client** (`client/realtime.ts`): `connectRealtime()` — handshake, heartbeat, exponential-backoff reconnect, and trailing-throttled outbound `change` publishing, over the authed `/api/louise/realtime/:slug/:id` route. `connected()` gates the surface between publishing here and its debounced-fetch fallback; a `release` flushes any pending change first so the final ≤throttle of typing isn't dropped. Framework-agnostic and fully unit-tested (fake-socket lifecycle).
- **Inline surface** (`mountLouise({ realtime })`): presence avatars in the edit bar; publishes field edits over the socket when connected (the DO coalesces + persists — no debounced fetch, no double write); applies a peer's plain-text edits live (skipping a field you're focused in); and soft-locks the rich body — claim on focus, release on blur, with a "locked by X" badge + read-only state when a peer holds it (the server enforces the lock and never broadcasts the body). Publish snapshots the current field values into a fresh draft first, so it promotes the latest even before the DO's alarm fires.
- **Sections surface** (`mountSections({ realtime })`): presence in the shared bar. Sections persistence stays on the proven debounced-fetch draft path for now — a live canvas sync is a follow-up.
- Exposes `connectRealtime`, `resolveRealtime`, `RealtimeOption`, `RealtimePeer`, `RealtimeSession`, and the `initials`/`otherPeers` presence helpers.

Degrades silently: with no `EDIT_SESSION` binding the upgrade 503s, `connected()` stays false, and editing keeps using the debounced-fetch auto-save exactly as before. The site's `LouiseEditIsland` / `SectionsMount` stamp the flag from the collection's `realtime` option.
