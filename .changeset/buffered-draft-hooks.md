---
"louise-toolkit": patch
---

A buffered draft save now runs the same checks a saved draft does. When `bufferKv` is on, an auto-save that KV absorbs (no D1 flush that time) skipped the collection's `update` access check and its `beforeChange` hooks, so the buffer could hold input the hooks would have changed, including rich text they sanitize. `resumeDraft` then returned that input for rendering in edit mode. Published content wasn't affected: a flush to D1 and every publish always ran the hooks.

- `applySaveDraft` runs the access check and the hooks before every buffer write, through a new `prepareDraft` method on the versioned Local API. A hook's `LouiseValidationError` now answers 422 on a buffered save too.
- `draftBufferKey` returns `draft:v2:<collection>:<id>`, so buffers written by earlier versions are never read. They expire on their existing 7-day TTL.

**Upgrade edge:** an edit that was still only in the buffer when you deploy, from the last 10 seconds or so of an editing session, isn't resumed. The page resumes from its latest D1 draft instead. Nothing else to do.
