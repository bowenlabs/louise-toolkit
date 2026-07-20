---
"astroidjs": minor
"create-astroid": minor
---

Add the realtime module (ADR 0002 / #71) — live multi-editor editing on a page, opt-in via `modules: ["realtime"]` or `--realtime`.

The package description has advertised "multi-editor sites" since 0.1.0. That was true for the *org* axis — many editor accounts — and false for the one people mean: two editors on the same page. Without a live channel they clobber each other; the server-side draft merge narrows the window but there is no presence, no field sync, and no signal that someone else is in the same field. `louise-toolkit/realtime` had shipped the session logic and the upgrade route; nothing generated the Durable Object, the binding, or the migration that make them reachable.

Astroid now generates all three, plus `realtimeRoute` in the worker and the client opt-in on the boot marker. The DO subclass is scaffold-once (`src/edit-session.ts`) because it must import `cloudflare:workers` — a runtime-only specifier the toolkit can't carry — and because `persist` is the seam a project tunes.

**It augments rather than replaces.** With the module off, the socket unopened, or the connection dropped, the client falls back to the existing debounced auto-save. And there is still exactly one write path: the session's coalesced flush goes through `applySaveDraft`, the same merge-over-pending-draft the fetch auto-save uses, so drafts, version history, publish semantics, and read-your-writes are unchanged. The DO is a new front end to that path, not a parallel store — which is also why it does *not* pass `bufferKv`: its alarm is already the coalescer for that page, and the KV write-buffer would be a second layer over one stream of edits.

Three details are load-bearing and easy to get wrong from memory, so they're generated and asserted in CI rather than left to a reader:

- The migration block uses **`new_sqlite_classes`**, not `new_classes`. The session keeps authoritative state in `ctx.storage`, and a Durable Object's storage backend cannot be changed after the class is first deployed.
- The class is **re-exported from the worker entry**. Wrangler resolves a binding's `class_name` against the worker's exports, and the failure is a deploy error that points nowhere near the file that defines it.
- `realtimeRoute` is imported from **`louise-toolkit/realtime`**, not `/editor`. It is the one factory in the route plan that isn't an editor route; bundling it with the rest type-checks inside this package — the plan is only strings — and fails only in a scaffolded project. The clean-room `astro check` is what caught it.

The rich-text body takes a soft-lock (one editor at a time) rather than being last-writer-wins clobbered, and locked values are never fanned out to peers, so raw rich text doesn't cross sockets.
