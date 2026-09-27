# ADR 0022: Incident capture

- **Status:** Proposed (2026-09-27)
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0012 (API boundary), ADR 0016 (privacy-first, § 1 and § 7), ADR 0017 (client accounts and access), issues #480, #556, #557, #558, #559, #235, the platform plan's A5 track in louise-ops

## Context

A site on the kit reports trouble in three ways today, and none of them leaves a record anyone reads:

- **A degrade logs one line.** `reportDegraded` (#556) gives every fallback the same greppable line, and `onDegraded` is a listener seam with nothing listening. `runAi` and the vector helpers already report through it, so a retired model or a failed upsert shows in `wrangler tail`.
- **A throw logs, or doesn't.** An uncaught error in a route, the fallback `fetch`, a `queue` handler, or a `scheduled` handler reaches Workers Logs when observability is on, and nowhere else. `processBatch` logs each failed message (#558), but a message that spends its retries lands in a dead-letter queue that nothing consumes.
- **`withHealing` builds a `FailureReport`** for an `escalate` hook, but its `url` is the full request URL, query string included, which can carry a token.

So an error has no count, no grouping, and no home. Workers Logs keeps a few days, and nobody searches it until something is already wrong. The operations review behind the platform plan found a site whose sign-in failed for about a day, and migrations that went unapplied through green deploys for days, with nothing watching either one.

The owner's needs-attention list (#480) and Watchtower in louise-ops both need the same thing: each distinct problem, how often it happened, and when it started. ADR 0016 § 1 decides where that lives. Incidents stay in the site's own D1, in the client's account, and louise-ops receives only what it needs to act on.

## Decision

Every failure a site's Worker sees becomes an `IncidentReport`. Reports with the same fingerprint are one incident, counted in the site's D1. The site forwards a small summary to louise-ops, and optional sinks get scrubbed copies.

### 1. One report shape

`IncidentReport` is flat and JSON-serializable, so it crosses a queue or an HTTP call unchanged:

| Field         | What it holds                                                                            |
| ------------- | ---------------------------------------------------------------------------------------- |
| `kind`        | Where it came from: `fetch`, `queue`, `scheduled`, or `degraded`                         |
| `fingerprint` | The grouping key from § 2                                                                |
| `name`        | The error's class, or a degrade's dotted name (`commerce.products`)                      |
| `code`        | A `LouiseError`'s `code` (`DB_ERROR`), when there's one                                  |
| `message`     | One line, clipped to 500 characters and redacted as § 2 says                             |
| `path`        | The request's pathname for `fetch`, never the query string; the queue's name for `queue` |
| `host`        | The request's host, so preview traffic on `workers.dev` stays apart from production      |
| `release`     | The deployed version, from the site's version metadata binding when it has one           |
| `critical`    | Whether the site marked it critical, from § 6                                            |
| `at`          | Epoch milliseconds                                                                       |

`describeFailure` records the pathname only, in the same changeset. A `FailureReport`'s `url` keeps its name so no caller breaks, and the upgrade note says what changed.

### 2. A fingerprint that survives a deploy

`fingerprintFailure(report)` is a pure, synchronous function that returns 16 hex characters. It hashes the `kind`, `name`, `code`, and a normalized `message`: numbers, UUIDs, hex IDs, and quoted strings become placeholders, so "row 41 not found" and "row 97 not found" are one incident.

It leaves out the path and the stack. One bug across a hundred product pages is one incident, not a hundred, and a bundled stack's line numbers move with every deploy. It leaves out the release too, so an incident that comes back after a fix shows as the same incident, reopened.

The same pass redacts the stored `message`: email addresses, and any run of 24 or more base64 or hex characters, become placeholders before a report reaches any sink. That's a floor, not a guarantee, so the docs for `reportDegraded` and for thrown messages still say never to put personal data in them.

### 3. Capture at the edges `composeWorker` already owns

`ComposeWorkerOptions` gains `onIncident`, one sink or a list. With it:

- **`fetch`:** a throw from a route or the fallback becomes a `fetch` report, then re-throws, so Cloudflare answers exactly as it does today. The report goes to the sinks through `ctx.waitUntil`, so it never delays or changes a response.
- **`queue` and `scheduled`:** the same, around the handlers `composeWorker` passes through.
- **Degrades:** `composeWorker` registers one `onDegraded` listener per isolate. A degrade has no `ctx` of its own, so each report waits in a small isolate buffer, and whichever `fetch`, `queue`, or `scheduled` call finishes next in that isolate flushes the buffer through its own `waitUntil`.

A sink that throws is logged and ignored. A capture that failed the request it was reporting on would be the crash it was built to count.

### 4. The site's D1 is the record

The kit exports an `incidents` Drizzle table and a `d1Incidents(db)` sink. The sink upserts by fingerprint: it adds to `count`, sets `lastSeen` and the latest `message`, `path`, and `release`, and reopens an incident that was resolved. The row is the incident; the reports behind it aren't kept.

`incidentsRoute` serves the rows behind the ADR 0012 gate: to an editor session for the Health panel and #480, and to a scoped read-only token (#235) for Watchtower. When Watchtower needs an incident's message, it fetches it here on demand rather than keeping a copy, the same way ADR 0016 § 1 treats a ticket's body.

### 5. louise-ops gets a summary, and only when it changes something

`httpIncidents({ url, token })` forwards a summary to louise-ops' `/ingest/incident`, with a per-site token. The summary is the site, `fingerprint`, `kind`, `name`, `path`, `release`, `critical`, `count`, and the first and last times seen. This adds `name`, the count, and the times to ADR 0016 § 1's list: none of them is client data, and without `name` an alert can say only that a hash happened. ADR 0016 takes that amendment when both are accepted.

It forwards on the first sighting, on a reopen, and when the count crosses 10, 100, or 1,000, read from the D1 upsert's result. So an error storm costs louise-ops four calls, not one per failing request. This sink needs `d1Incidents` ahead of it, and says so when it's configured without one.

### 6. Critical is a site fact

Only the site knows which failures matter most, so it's a parameter: `onIncident` takes a `critical` list of names and path prefixes (`commerce.checkout`, `/cart`). Watchtower sends a Discord alert for a critical incident and for a failed probe. Everything else counts toward #480 and the Watchtower dashboard, and alerts no one.

### 7. Queues report once, on the last attempt

`processBatch` gains `onIncident` and `maxRetries`, which defaults to 3, Cloudflare's default for a queue. A failed message reports a `queue` incident on its final delivery, not on each retry, so a transient failure that a retry clears is logged but never counted.

`deadLetterConsumer({ db, onIncident })` is the consumer for a dead-letter queue. It writes each message to a `dead_letters` table in the site's D1, with its queue, ID, body, and attempt count, then reports a `queue` incident and acks the message. The body stays in the client's account. A runbook step replays it, and the Health panel shows the count.

### 8. AI failures say why

`runAi` keeps its contract: it never throws, and it returns `null` on failure. It classifies the error into a `reason` (`model-retired`, `rate-limited`, `invalid-output`, `truncated`, `unavailable`, or `error`) and adds it to its degrade's details, so a retired model is its own incident rather than one of many `ai.run` lines. The editor's AI routes put the same `reason` in their `502` body, so the client can say what went wrong instead of only that something did.

### 9. Sentry is an astroidjs opt-in

A Sentry sink lives in astroidjs, behind a per-site setting, never in the zero-dependency core (ADR 0016 § 7). It sends the redacted report with `sendDefaultPii` off and request bodies and headers scrubbed. The site's D1 stays the record; Sentry gets a copy for stack traces and release tracking.

## Consequences

- **Six PRs in this repository, in order:** the report and fingerprint (§ 1 and § 2), capture in `composeWorker` (§ 3), the table, sink, and route (§ 4), the queue changes (§ 7), the AI reasons (§ 8), and the HTTP and Analytics Engine sinks (§ 5). Each is a `minor` changeset with no new dependency.
- **`@louise-toolkit/astro`** passes `onIncident` through its middleware, so an Astro site's route errors are captured too.
- **astroidjs** wires the sinks by default in its scaffold, generates a dead-letter consumer for each declared dead-letter queue, and adds the Sentry opt-in.
- **louise-ops** adds `/ingest/incident`, per-site tokens, and the `search_incidents`, `get_incident`, and `site_status` tools, and Watchtower reads the same summaries.
- **Each site adds one migration** for the two tables, and its runbook names its dead-letter queue and how to replay it.
- **Heartbeats stay separate.** A job that stops running never throws, so incident capture can't see it. #559's stale-job check and `statusRoute`'s age checks cover that.
- **Done when:** the full check suite passes; 100 identical throws produce one incident with a count of 100; and a simulated retired model is its own incident, which Louise matches to the lesson about a model's end of life.

## Alternatives considered

- **louise-ops as the record.** Rejected by ADR 0016 § 1: it would copy every site's error text into a Bowen Labs database, and a leak there is a leak across every client.
- **Sentry as the record.** Rejected by ADR 0016: the owner's data shouldn't depend on a vendor's retention, and a site without Sentry still needs incidents.
- **A queue sink.** Dropped from the earlier plan. The D1 upsert already runs under `waitUntil`, off the response path, and a queue would be one more binding every site has to provision for no gain.
- **Coalescing repeats in the isolate before writing.** Rejected: an isolate can't flush reliably after its last request, so coalesced counts would be lost. The D1 upsert counts instead, and § 5's thresholds keep louise-ops quiet.
- **A thrown `LouiseAiError`.** Rejected: `runAi` never throws, and every caller relies on that. The `reason` in the degrade details and the `502` body gives the same information without breaking the contract.
- **The path or stack in the fingerprint.** Rejected: the path splits one bug into many incidents, and a bundled stack changes with every deploy.
