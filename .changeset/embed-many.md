---
"louise-toolkit": patch
---

`louise-toolkit/ai` adds `embedMany` and `indexContents`, for embedding many texts in one Workers AI call instead of one call per text.

**What's new.** `embedMany(runner, texts, opts?)` sends texts in batches of `batchSize`, 100 by default (`EMBED_MANY_BATCH`, the most the BGE embedding models take per request). It returns one entry per input, in input order: the vector, or `null` for a blank text or a batch that failed, so you can retry only the `null` entries. Like the rest of `core/ai`, it never throws on a runtime failure. `indexContents(index, runner, namespace, items, opts?)` is the batch form of `indexContent`: it embeds rows with `embedMany`, upserts their vectors at most 1,000 at a time, and returns the IDs it stored. Use it to backfill a collection's vectors, for example when you first turn on Vectorize.

**What you have to do.** Nothing. `embed` and `indexContent` are unchanged and stay the calls for one row at a time, such as on publish.
