---
title: incidents
description: "louise-toolkit/incidents—the report every failure becomes, its fingerprint, and the site's D1 record."
sidebar:
  order: 7.25
---

```ts
import {
  analyticsIncidents,
  buildIncidentReport,
  d1Incidents,
  deadLetterConsumer,
  deadLetters,
  fingerprintFailure,
  getIncident,
  incidentFromDegraded,
  incidentCountsSqlQuery,
  incidents,
  incidentsColumns,
  isCriticalIncident,
  listDeadLetters,
  listIncidents,
  MAX_INCIDENT_MESSAGE,
  parseIncidentCountRows,
  redactMessage,
  replayDeadLetter,
  resolveIncident,
  upsertIncident,
  type DeadLetter,
  type Incident,
  type IncidentInput,
  type IncidentKind,
  type IncidentReport,
  type IncidentSink,
  type IncidentSinkContext,
} from "louise-toolkit/incidents";
```

A throw from a route, a queue handler, or a cron, and a fallback that fired
([`reportDegraded`](/reference/errors/)), each become one `IncidentReport`.
Reports with the same fingerprint are one incident, and the site's own D1 keeps
one row per incident, with a count. No peers.

The design is [ADR 0022](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0022-incident-capture.md).
[`composeWorker`'s `onIncident`](/reference/worker/#incident-capture-onincident)
captures reports from a Worker's handlers, and
[`incidentsRoute`](/reference/editor/#routes) shows the rows to the site's
editors.

## `IncidentReport`

| Field         | What it holds                                                                                |
| ------------- | -------------------------------------------------------------------------------------------- |
| `kind`        | `fetch`, `queue`, `scheduled`, or `degraded`                                                 |
| `fingerprint` | The grouping key from `fingerprintFailure`: 16 hex characters                                |
| `name`        | The error's class (`TypeError`), or a degrade's dotted name (`commerce.products`)            |
| `code`        | A `LouiseError`'s `code` (`DB_ERROR`), when the cause was one                                |
| `message`     | One line, redacted, at most `MAX_INCIDENT_MESSAGE` (500) characters                          |
| `path`        | The request's pathname, never its query string; a queue's name; a cron expression. Redacted. |
| `host`        | The request's host, so preview traffic stays apart from production                           |
| `release`     | The deployed version, when the site knows it                                                 |
| `critical`    | Whether the site marked this failure critical                                                |
| `at`          | Epoch milliseconds                                                                           |

It's flat and JSON-serializable, so it crosses a queue or an HTTP call
unchanged.

## `buildIncidentReport(input)`

```ts
function buildIncidentReport(input: IncidentInput): IncidentReport;
```

Builds a redacted report from whatever was thrown. `input.kind` is required;
`cause` fills the name, message, and code, and `request` fills the path and
host. Pass `path` instead when there's no request, such as a queue's name. It
never throws, whatever `cause` holds.

```ts
try {
  return await handle(request, env);
} catch (err) {
  const report = buildIncidentReport({ kind: "fetch", cause: err, request });
  ctx.waitUntil(sink(report));
  throw err;
}
```

## `incidentFromDegraded(event, options?)`

```ts
function incidentFromDegraded(
  event: DegradedEvent,
  options?: { release?: string; critical?: boolean; now?: number },
): IncidentReport;
```

The report for a `reportDegraded` call, as an `onDegraded` listener receives it:
kind `degraded`, named for the fallback that fired. The degrade's details stay
in its log line and aren't copied into the report.

## `fingerprintFailure(failure)`

```ts
function fingerprintFailure(failure: {
  kind: IncidentKind;
  name: string;
  code?: string;
  message: string;
}): string;
```

Hashes the kind, name, code, and the message with its variable parts replaced:
numbers, UUIDs, hex IDs, quoted values, email addresses, and tokens. So "row 41
not found" and "row 97 not found" share a fingerprint.

It leaves out the path, so one bug across many pages is one incident; the stack,
whose line numbers move with every deploy; and the release, so a failure that
comes back after a fix reads as the same incident. It's synchronous, and gives
the same answer for a raw message and for the redacted one a report stores.

## `redactMessage(text)`

```ts
function redactMessage(text: string): string;
```

Replaces email addresses with `[email]`, and any run of 24 or more token
characters that includes a digit with `[redacted]`. A failed query quoted in the
text, `Failed query: <sql> params: <values>`, shrinks to the statement's kind
and table, such as `Failed query: insert into inquiries`. The bound values are
often personal data, such as a name or a street address, that the other two rules
can't recognize. Every report's `message` and `path` go through
it. It's a floor, not a guarantee: never put personal data in an error message
or a degrade's details.

A report built from drizzle-orm's `DrizzleQueryError` itself, thrown or passed
to `reportDegraded`, is named `DrizzleQueryError` and keeps the first line of
the database's error from its `cause`:
`Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email`.
A database can quote the value in that line, as D1 does in
`D1_TYPE_ERROR: Type 'object' not supported for value '…'`, so the line stops
at its first quoted literal: `Cause: D1_TYPE_ERROR: Type <value>`. The same
query failing with different values is one incident.

## `isCriticalIncident(report, critical)`

```ts
function isCriticalIncident(
  report: Pick<IncidentReport, "name" | "path">,
  critical: readonly string[],
): boolean;
```

Whether a report matches a site's critical list. An entry that starts with `/`
is a path prefix: `/cart` matches `/cart` and `/cart/checkout`, not `/cartoon`.
Any other entry is a name, and matches that name and the dotted names under it:
`commerce.checkout` matches `commerce.checkout.session` too. `onIncident` runs it
for you when you pass `critical`.

## `IncidentSink`

```ts
type IncidentSink<Env> = (
  report: IncidentReport,
  context: { env: Env; cause?: unknown },
) => void | Promise<void>;
```

Takes each report. Capture runs a sink after the response, and a sink that
throws or rejects is logged and ignored, so it can't fail the request it's
reporting on.

`context.env` is the Worker's bindings, for a sink that writes somewhere.
`context.cause` is the value that was thrown, or a degrade's cause, as it was:
with its stack and unredacted. An error whose `cause` chain holds a failed
query is the exception: the sink gets
[`loggableError`](/reference/errors/#loggableerrorvalue)'s copy, of the same
class and with the same own fields, whose messages and stacks carry no bound
values, so a sink that reads stack frames can't pick one up. It lives in memory only. A sink that sends it
anywhere, such as an error tracker, owns scrubbing it first.

## The `incidents` table

The site's D1 is the record: one row per fingerprint. Add the table to the
schema drizzle-kit reads, and generate a migration:

```ts
// db/schema.ts
export { incidents } from "louise-toolkit/incidents";
```

To add columns, spread `incidentsColumns` into your own `sqliteTable` and pass
that table to each function below as its last argument.

| Column        | What it holds                                          |
| ------------- | ------------------------------------------------------ |
| `fingerprint` | The primary key                                        |
| `kind`        | `fetch`, `queue`, `scheduled`, or `degraded`           |
| `name`        | The error's class or the degrade's name                |
| `code`        | A `LouiseError`'s code, or `null`                      |
| `message`     | The latest report's message, redacted                  |
| `path`        | The latest report's path                               |
| `host`        | The latest report's host                               |
| `release`     | The latest report's release                            |
| `critical`    | Whether the latest report was marked critical          |
| `count`       | How many reports it has had                            |
| `first_seen`  | When it was first seen, in epoch milliseconds          |
| `last_seen`   | When it was last seen, in epoch milliseconds           |
| `resolved_at` | When someone resolved it, or `null` while it's open    |
| `reopened_at` | When it last came back after being resolved, or `null` |

Times are plain epoch milliseconds, so a `SELECT` through Cloudflare's D1 API,
as Watchtower runs, can compare them without a conversion.

## `d1Incidents(database, table?)`

```ts
function d1Incidents<Env>(
  database: (env: Env) => D1Database | D1DatabaseSession,
  table?: IncidentTable,
): IncidentSink<Env>;
```

The sink that keeps the record: each report is counted into the `incidents`
table with `upsertIncident`. Put it first in `onIncident`'s list, so the record
doesn't depend on any other sink.

```ts
export default composeWorker<Env>({
  fetch: ssrHandler,
  onIncident: {
    sinks: [d1Incidents((env) => env.DB)],
    critical: ["commerce.checkout", "/cart"],
  },
});
```

## `upsertIncident(d1, report, table?)`

Counts one report into its incident and returns the row as it now stands. The
first report for a fingerprint inserts the row. A later one adds to `count`,
moves `lastSeen` forward (never back, for a report that arrives late), and takes
the latest `message`, `path`, `host`, `release`, and `critical`. On a resolved
row it also clears `resolvedAt` and sets `reopenedAt`, so a failure that comes
back after a fix shows.

## `listIncidents(d1, options?, table?)` · `getIncident(d1, fingerprint, table?)` · `resolveIncident(d1, fingerprint, now?, table?)`

`listIncidents` returns incidents, most recently seen first. `status` is
`"open"` (the default), `"resolved"`, or `"all"`, and `limit` defaults to 100.
`getIncident` returns one row or `null`. `resolveIncident` marks an open
incident resolved and returns it, or `null` when there's no open incident with
that fingerprint; the next report for it reopens it.

## Dead letters

A message that spends its retries moves to its queue's dead-letter queue. With
no consumer there, it sits unseen until Cloudflare drops it. The dead-letter
consumer keeps each one in the site's D1, where its body stays in the client's
account, and reports it.

Add the table to the schema drizzle-kit reads, beside `incidents`:

```ts
// db/schema.ts
export { deadLetters, incidents } from "louise-toolkit/incidents";
```

| Column        | What it holds                                          |
| ------------- | ------------------------------------------------------ |
| `id`          | The row's ID, for `replayDeadLetter`                   |
| `queue`       | The dead-letter queue the message arrived on           |
| `message_id`  | Cloudflare's ID for the message                        |
| `body`        | The body, as JSON; a body JSON can't hold, as a string |
| `attempts`    | Deliveries on the dead-letter queue when it was kept   |
| `received_at` | When it was kept, in epoch milliseconds                |

### `deadLetterConsumer(database, table?)`

```ts
function deadLetterConsumer<Env, Body>(
  database: (env: Env) => D1Database | D1DatabaseSession,
  table?: DeadLetterTable,
): (batch: MessageBatch<Body>, env: Env, ctx: ExecutionContext) => Promise<void>;
```

A `queue` handler for a dead-letter queue. It writes each message to
`dead_letters`, reports a `queue` incident named `DeadLetter`, and acks the
message. One dead-letter queue that keeps filling is one incident with a rising
count. A message it can't write is retried, so it isn't lost. Declare the
dead-letter queue as a consumer of the Worker in `wrangler.jsonc`, then route
its batches here:

```ts
const keepDeadLetters = deadLetterConsumer((env: Env) => env.DB);

export default composeWorker<Env>({
  fetch: ssrHandler,
  queue: (batch, env, ctx) =>
    batch.queue === "side-effects-dlq"
      ? keepDeadLetters(batch, env, ctx)
      : processBatch(batch, (job) => runJob(job, env)),
  onIncident: [d1Incidents((env) => env.DB)],
});
```

### `listDeadLetters(d1, options?, table?)` · `replayDeadLetter(d1, id, queue, table?)`

`listDeadLetters` returns kept messages, newest first; pass `queue` to read one
dead-letter queue, and `limit` (default 100). `replayDeadLetter` sends one kept
message back onto a queue, usually the one it first failed on, then deletes the
row. It returns `false` when there's no row with that ID, and keeps the row if
the send fails. Fix the cause first, or the message dead-letters again.

## Counts over time: `analyticsIncidents(dataset)`

```ts
function analyticsIncidents<Env>(
  dataset: (env: Env) => AnalyticsEngineDataset | undefined,
): IncidentSink<Env>;
```

A row's `count` is a running total. Whether a failure is happening more often
this week than last is a question for [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/),
which is first-party and lives in the client's account. This sink writes one
data point per report: `index1` is the fingerprint, the blobs are the kind,
name, path, host, release, and `"critical"` or `""`, and `double1` is 1.
`incidentDataPoint(report)` builds that point, for a sink of your own.

Give it a dataset of its own rather than the one [Core Web Vitals](/reference/analytics/)
use, so neither query reads the other's rows. An unprovisioned dataset drops the
report.

```ts
onIncident: [
  d1Incidents((env) => env.DB),
  analyticsIncidents((env) => env.INCIDENT_EVENTS),
],
```

### `incidentCountsSqlQuery(dataset, options?)` · `parseIncidentCountRows(rows)`

`incidentCountsSqlQuery` builds the Analytics Engine SQL for each incident's
count per `"day"` (the default) or `"hour"`, over `sinceHours` (default 168, a
week), weighted by `_sample_interval` for sampling. Days start at midnight UTC
unless you pass the site's `timeZone`, since a time zone is a site fact. It
refuses a dataset name or time zone that isn't a plain identifier.
`parseIncidentCountRows` reads the result into
`{ fingerprint, kind, name, bucket, count }` rows, skipping any that don't fit.
