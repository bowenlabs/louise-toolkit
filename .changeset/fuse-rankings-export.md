---
"louise-toolkit": patch
---

`louise-toolkit/ai` exports `fuseRankings`, the Reciprocal Rank Fusion merge behind hybrid search, and `semanticSearch` takes a `minScore` floor.

**What's new.** `fuseRankings(lists, options?)` merges any number of ranked ID lists into one, best-first. IDs can be numbers or strings, each list can carry a `weight`, and `options` takes `k` (default `RRF_K`, 60), `limit`, and `boost`, a per-ID multiplier for a signal that belongs to the document, such as an authority weight. The types `RankedList` and `FuseRankingsOptions` and the constant `RRF_K` are exported with it. Until now the function lived inside the search route, took two numeric lists only, and wasn't reachable from any public subpath, so a site with its own retrievers had to copy it.

`semanticSearch` and `searchRoute`'s `vector` config both accept `minScore`. A match scored below it is dropped, so a query that matches nothing adds nothing instead of the nearest `topK` records.

**What you have to do.** Nothing. `minScore` has no default, so search results are unchanged until you set one, and `searchRoute` ranks exactly as before. A useful floor depends on the embedding model and your content, so measure one against real queries before you set it.
