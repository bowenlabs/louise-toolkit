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
  isStale,
  HEALTH_STALE_AFTER_MS,
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

The "N things need attention" number: broken links + missing alt + SEO gaps +
pending migrations. CWV
is deliberately **not** in it—a slow LCP is not a countable defect the way a
404 is, and adding it would make the number jump for something you can't fix by
editing one page.

`HealthSummary` is shape-compatible with `overview.health` (the extra detail field
is ignored there), so the overview route can return a stored summary directly
rather than re-mapping it.

## Noticing a scan that stopped running

```ts
function isStale(
  timestamp: string | number | Date | null | undefined,
  maxAgeMs: number,
  now?: Date | number,
): boolean;
```

A scheduled job that stops succeeding doesn't report it, and the stored summary
quietly ages. `isStale` compares a last-success timestamp with a threshold,
so a scan that last ran a week ago doesn't look the same as one that ran an hour
ago. It's pure: pass `now` for a deterministic result in tests.

```ts
const summary = await readHealthSummary(env.HEALTH_KV);
if (summary && isStale(summary.checkedAt, HEALTH_STALE_AFTER_MS)) {
  // The Cron Trigger hasn't written a summary in over 36 hours.
}
```

It works for any job's last success, not only the health scan: a snapshot's
`fetchedAt`, say, or a sync's `lastRunAt`.

- A **missing or unparseable timestamp counts as stale.** A job with no readable
  record of success hasn't shown that it ran, and a monitor that stays quiet
  about that is the failure the check exists to catch.
- A **timestamp in the future counts as fresh**, so clock skew between the job
  and the reader doesn't raise a false alarm.
- The age has to **exceed** `maxAgeMs`, so an age of exactly `maxAgeMs` is
  fresh. Pass `Infinity` to turn the check off.

`HEALTH_STALE_AFTER_MS` is 36 hours: a daily scan can run late or miss one run
and still read as fresh, but two missed runs in a row read as stale.

### In the Health panel

Past the threshold, the Health panel's "Last checked" line turns amber and
starts with **Out of date**, then tells the owner the scheduled check might
have stopped and to ask their developer. The words carry the warning, not the
color alone, which WCAG 1.4.1 requires.

The threshold is a parameter. If your scan runs less often than daily, set it to
a bit more than the interval, or the panel marks every check as out of date:

```ts
import { mountSettings } from "louise-toolkit/client/settings";

mountSettings({
  userName,
  dashboard: { healthStaleAfterMs: 8 * 24 * 60 * 60 * 1000 }, // a weekly scan
});
```

`Studio` takes the same `dashboard.healthStaleAfterMs`, and `HealthPanel` takes it
as `staleAfterMs` when you mount the panel yourself.

## Pending migrations

Pass `pendingMigrations` to `summarizeHealth` (the `pending` list from
[`migrationStatus`](/reference/db/)) and the Health panel names each database
update the running code needs and tells the owner to ask their developer. The
section only appears when something is pending. A deploy can land between scans,
so check live when you read the summary, too, and replace the stored list.

## Types

`HealthSummary`, `HealthInput`, `HealthKV`. Constants: `HEALTH_KV_KEY`
(`"louise:health:summary"`), `MAX_BROKEN_LINK_DETAILS`, `HEALTH_STALE_AFTER_MS`
(36 hours).

`HealthKV` is structural—`get`/`put`—so a real `KVNamespace` satisfies it
without this module importing Workers types.
