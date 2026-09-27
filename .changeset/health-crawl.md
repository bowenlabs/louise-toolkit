---
"louise-toolkit": minor
---

The health scan can crawl the whole site and report redirects, indexing directives, shared titles, and the slowest pages (#588).

- **`crawlSite(options)`** (`louise-toolkit/browser`) reads pages and reports broken links, internal links that redirect (against the page that holds the link, with the hop count and final status), pages that say `noindex` or name a canonical on another origin or page, and titles more than one page shares.
  - **Caps:** `crawl: { maxPages, maxDepth }` follows same-origin links from the start paths, and `maxRequests` keeps the scan under the Worker's subrequest limit, with `truncated` when it stops early.
- **`checkLinks` now follows redirects itself,** with `redirect: "manual"`, and returns `crawlSite`'s broken links. A link that reaches a live page through a redirect still isn't broken. A redirect loop, more than five hops, now reports as `"error"`.
- **`pageSignals(html, headers, url)`** reads a page's robots directives, canonical link, title, and description.
- **`summarizeHealth`** takes optional `redirects`, `indexing`, and `duplicateTitles`, and stores a count and a capped sample of each; `healthIssueCount` counts them. The Health panel lists each, and hides them when a scan didn't crawl.
- **Vitals by page:** `cwvSqlQuery(dataset, hours, { byPath: true, minSamples })` groups by the beacon's path too, `parseCwvPathRows` keeps the slowest pages, and `summarizeCwv({ …, slowestPaths })` stores them for the panel's "Slowest pages" list.

**Upgrading:** nothing is required, and a stored summary from before still reads. To use the crawl, swap `checkLinks` for `crawlSite` in the scheduled scan and pass its findings to `summarizeHealth`. Count `seoGaps` over pages that aren't `noindex`.
