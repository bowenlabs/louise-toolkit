---
"louise-toolkit": minor
---

`embedMany` and `indexContents` no longer change a text's vector by batching it. Under Workers AI's default mean pooling, a BGE model returns a different vector for a text embedded in a batch than for the same text embedded alone. A short text batched with a longer one came back at 0.96 to 0.97 cosine against its own vector, and its match to a query fell by 0.04 to 0.06. `semanticSearch` scores those vectors against queries that `embed` makes one at a time, so the batched vectors matched less well than they should.

- **`pooling`** is a new option on `embed`, `embedMany`, `indexContent`, `indexContents`, and `semanticSearch`: `"mean"`, Workers AI's default, or `"cls"`, the pooling BGE was trained with. Under CLS pooling a text gets the same vector in a batch as alone.
- **`embedMany` batches only with `pooling: "cls"`.** With mean pooling, the default, it sends one text per call, so its vectors match `embed`'s. `batchSize` applies only under CLS pooling.

**What to do:** if you called `embedMany` or `indexContents` on 0.31.3, the vectors they stored are slightly off. Re-index those rows. Pick one of these:

- **Keep mean pooling:** re-run `indexContents` without `pooling`. It makes one Workers AI call per row, and your searches don't change.
- **Move to CLS pooling (recommended for a backfill):** re-run `indexContents` with `pooling: "cls"` to re-embed every row in the index, then pass `pooling: "cls"` to `semanticSearch` and `indexContent` as well. Mean and CLS vectors don't mix, so switch the searches only after every row is re-embedded.

If you only ever used `embed`, `indexContent`, and `semanticSearch`, nothing changes.
