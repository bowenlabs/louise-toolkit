---
"louise-toolkit": minor
---

A publish no longer reports failure after it has committed, and a Workflow started from it can be keyed per publish (#531).

- **`deferReindex` learns the version.** On a publish, `DeferReindex` gets a second argument, `{ versionId }`, naming the version that went live. Key per-publish work by it: the row ID repeats on every publish of the same page.
- **A follow-up failure is a degrade.** When the reindex, or the `deferReindex` hook, throws after the publish batch commits, `publish` returns the live page and logs `content.publish.reindex` through `reportDegraded`. Before, the route answered 422 for a page that was already live.
- **`startWorkflow` checks the instance ID.** An ID outside Cloudflare's pattern (at most 100 letters, digits, hyphens, and underscores, not starting with a hyphen) now throws `LouiseWorkflowError` before `create`. The new `isWorkflowInstanceId` runs the same check.

**Upgrading:** the documented example ID, `publish:pages:<id>`, has colons, which Cloudflare rejects, and repeats on every publish of a page. If you copied it, switch to `publish-pages-<id>-v<versionId>`, read from the new second argument. A site that relied on a `deferReindex` throw to fail the publish request now gets a success and a degrade log line instead.
