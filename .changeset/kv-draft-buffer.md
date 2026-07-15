---
"louise-toolkit": minor
---

Add a Workers KV write-buffer for auto-save to coalesce high-frequency draft writes (#70) — a burst of edits no longer hits D1 with a version row per debounce tick.

- New `louise-toolkit/editor` draft-buffer primitives: `draftBufferKey`, `readDraftBuffer` / `writeDraftBuffer` / `clearDraftBuffer` (with a self-expiry TTL), and `shouldFlushBuffer`. The buffer holds the freshest working-draft snapshot per page; the consistency model is deliberately simple — the buffer is only ever ahead of or equal to the D1 draft and is cleared on publish, so "the freshest pending draft" is `buffer ?? D1 draft`.
- `versionsRoute` gains an opt-in `bufferKv?: (env) => DraftBufferKV | undefined` (+ `bufferFlushMs`, default 10s). When set: each auto-save `POST …/versions` updates the KV buffer and only flushes to D1 on the first write of a session, every `bufferFlushMs`, and on publish (which flushes the freshest work, publishes it, then clears the buffer). Discarding a draft clears the buffer too. Unset → every draft writes straight to D1, unchanged.

Resume reads should prefer the buffer (it holds edits not yet flushed) — feed `readDraftBuffer` into your draft-render path. KV is eventually consistent and caps ~1 sustained write/sec per key, so it's a scratch buffer; D1 stays authoritative.

Site: bind a `DRAFTS` KV namespace, enable `bufferKv` on the pages collection, and make the draft-render helpers (`latestDraftBody` / `latestDraftSections`) consult the buffer first. Provision `wrangler kv namespace create DRAFTS` before deploying.
