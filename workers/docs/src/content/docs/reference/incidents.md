---
title: incidents
description: "louise-toolkit/incidents—the report every failure becomes, and its fingerprint."
sidebar:
  order: 7.25
---

```ts
import {
  buildIncidentReport,
  fingerprintFailure,
  incidentFromDegraded,
  MAX_INCIDENT_MESSAGE,
  redactMessage,
  type IncidentInput,
  type IncidentKind,
  type IncidentReport,
  type IncidentSink,
} from "louise-toolkit/incidents";
```

A throw from a route, a queue handler, or a cron, and a fallback that fired
([`reportDegraded`](/reference/errors/)), each become one `IncidentReport`.
Reports with the same fingerprint are one incident, so a sink can count them.
This subpath is the pure part: the report's shape, the fingerprint, and the
redaction. No bindings and no peers.

The design is [ADR 0022](https://github.com/bowenlabs/louise-toolkit/blob/main/docs/adr/0022-incident-capture.md).
Capture in `composeWorker` and the sinks that store and forward reports build on
these pieces.

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
characters that includes a digit with `[redacted]`. Every report's `message` and
`path` go through it. It's a floor, not a guarantee: never put personal data in
an error message or a degrade's details.

## `IncidentSink`

```ts
type IncidentSink = (report: IncidentReport) => void | Promise<void>;
```

Takes each report. Capture runs a sink after the response, and a sink that
throws or rejects is logged and ignored, so it can't fail the request it's
reporting on.
