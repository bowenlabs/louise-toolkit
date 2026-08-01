---
"astroidjs": minor
---

Add `media.maxUploadBytes` — the media library's upload ceiling is now configurable.

The generated `mediaRoute(...)` call was a fixed string with no `maxBytes`, so every project was pinned to louise-toolkit's 10 MB default and had no seam to change it: hand-editing the generated worker is undone by the next `astroid generate`.

That default is wrong for the projects where the masters ARE the product — a painter's or photographer's portfolio uploads 40 MB camera files and serves only Cloudflare-resized derivatives, so the master's size costs storage, not page weight.

```ts
export default defineAstroid({
  // …
  media: { maxUploadBytes: 40 * 1024 * 1024 },
});
```

Omitted, nothing changes: the generated line is byte-identical to before and the route keeps `DEFAULT_MAX_BYTES`.

Validated at generate time rather than in production: a value above Cloudflare's 100 MB request-body limit is rejected with an explanation (the edge drops an oversized body before the Worker runs, so the media route never gets to return its own 413), as are zero, negatives, and non-integers — the last catching the common megabytes-not-bytes slip.
