---
title: health
description: "louise-toolkit/health—the site-health snapshot: broken links, missing alt text, SEO gaps, and Core Web Vitals, persisted to KV."
sidebar:
  order: 14.75
---

```ts
import {
  summarizeHealth,
  writeHealthSummary,
  readHealthSummary,
  healthIssueCount,
} from "louise-toolkit/health";
```

The site-health co-pilot's data layer: one owner-facing snapshot composed from
primitives the toolkit already has. Binding: a KV namespace. No required peers.

:::caution[The card stays hidden until the first scan]
`readHealthSummary` returns `null` until something has written one, and both the
Health card and `overview.health` treat absent as "nothing to show". Wire this up,
load the dashboard, and see nothing—that is the expected state, not a broken
integration. Run the scan once and it appears.
:::

## Why it's persisted rather than computed

The three inputs have very different costs, and the split follows from that:

- **Broken links** come from a crawl—network, seconds, driven by a Cron
  Trigger. Far too slow for a dashboard request.
- **Missing alt** and **SEO gaps** are cheap `COUNT`s the site computes at scan
  time.

So a scheduled scan assembles everything and writes it; the dashboard only ever
reads. That is why the module is a summarize/write/read triple rather than a
"get health" call.

## Assembling and storing

```ts
function summarizeHealth(input: HealthInput): HealthSummary;
function writeHealthSummary(kv, summary, opts?: { key?; ttlSeconds? }): Promise<void>;
function readHealthSummary(kv, key?): Promise<HealthSummary | null>;
```

```ts
// in a scheduled handler
const broken = await checkLinks({ base, paths });
await writeHealthSummary(
  env.HEALTH_KV,
  summarizeHealth({ brokenLinks: broken, missingAlt, seoGaps }),
);
```

Counts are guarded to non-negative integers, so a bad input can't skew the traffic
light. `now` is injectable for deterministic tests.

`brokenLinkDetails` is capped at `MAX_BROKEN_LINK_DETAILS` (50)—**the counts
stay exact**, the details are a sample for a list view, so one badly broken deploy
can't bloat the stored blob.

Omit `ttlSeconds` to keep the summary until the next scan overwrites it. A stale
snapshot is more useful than none, and `checkedAt` tells the dashboard how old it
is.

`readHealthSummary` returns `null` for both "nothing stored" and "stored blob is
unparseable"—a corrupt value degrades to no-data rather than throwing inside a
dashboard request.

## Folding in Core Web Vitals

`HealthSummary.cwv` holds a [`CwvSummary`](/reference/analytics/) once a scan adds
one. Absent means "not measured yet" and the panel says so—distinct from
measured-and-poor, which is a real result.

## Reading it

```ts
function healthIssueCount(summary: HealthSummary): number;
```

The "N things need attention" number: broken links + missing alt + SEO gaps. CWV
is deliberately **not** in it—a slow LCP is not a countable defect the way a
404 is, and adding it would make the number jump for something you can't fix by
editing one page.

`HealthSummary` is shape-compatible with `overview.health` (the extra detail field
is ignored there), so the overview route can return a stored summary directly
rather than re-mapping it.

## Types

`HealthSummary`, `HealthInput`, `HealthKV`. Constants: `HEALTH_KV_KEY`
(`"louise:health:summary"`), `MAX_BROKEN_LINK_DETAILS`.

`HealthKV` is structural—`get`/`put`—so a real `KVNamespace` satisfies it
without this module importing Workers types.
