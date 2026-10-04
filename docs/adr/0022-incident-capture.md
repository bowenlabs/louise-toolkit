# ADR 0022: Incident capture

- **Status:** Accepted (2026-09-27). **Amended 2026-09-27** (see _Amendment (2026-09-27, before § 4)_ below): Sentry is the operator's issue system for Monitored and Supported sites, Watchtower pulls incidents instead of sites pushing them, § 5's summary sink is withdrawn, and `incidentsRoute` serves editors only. **Amended again 2026-09-27** (see _Amendment (2026-09-27, at § 7)_ below): `processBatch` and the dead-letter consumer report through capture's buffer instead of taking `onIncident`. **Amended 2026-09-27** (see _Amendment (2026-09-27, at § 8)_ below): the AI reason is part of the degrade's name, not only its details. **Amended 2026-10-04** (see _Amendment (2026-10-04, at § 2)_ below): a failed query's error is reduced to its statement and its database's error before it's reported, is named for its class, and is re-thrown and handed to sinks and `onDegraded` listeners as a reduced copy.
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

## Amendment (2026-09-27, before § 4)

Sentry Team is already paid for, inside the tier fee (ADR 0016 § 7). It groups errors, counts them per release, marks a resolved issue that comes back, runs alert rules that can post to Discord, and opens a GitHub issue with the commits it suspects. § 5 and part of § 6 would have rebuilt that in louise-ops. This amendment lands before § 4's code, so nothing built is thrown away.

### Sentry is the operator's issue system

For a Monitored or Supported site, Sentry is where Baylee triages an incident, replacing § 9's "a copy." The Sentry sink stays in astroidjs, never in the core, with `sendDefaultPii` off and request bodies and headers scrubbed. Two things change:

- **It sends the original error.** A stack is what makes a Sentry issue useful, and an `IncidentReport` doesn't carry one. `IncidentSink` gains a second argument, `{ env, cause }`: the Worker's bindings, which the D1 sink needs too, and the value that was thrown, in memory only and never serialized.
- **It shares the report's fingerprint.** The sink sets the Sentry event's fingerprint to the report's, and tags it with `kind`, `critical`, and the site. So one row in the site's D1 is one Sentry issue, and Watchtower joins the two on the fingerprint. Sentry's stack-based grouping would split and merge differently from the site's record.

Sentry doesn't become the record. The site's D1 still is (ADR 0016 § 1): owners never see Sentry, a site on the Included tier has no Sentry project, and a client who leaves keeps their incident history.

### Watchtower pulls; sites don't push

§ 5 is withdrawn: there's no `httpIncidents` sink, no `/ingest/incident`, and no per-site ingest token. Watchtower reads with credentials it already has:

- **Every site's `incidents` table,** through Cloudflare's D1 query API on its cron, with the read-only account token ADR 0017 gives it for each site. That token's `D1 Read` permission covers a `SELECT`.
- **Sentry's organization issues endpoint,** filtered to the site's project, for a Monitored or Supported site. It uses an internal integration's token with `event:read`. The same integration's issue webhooks (created, resolved, unresolved, assigned, and archived) update the dashboard between polls. A regression arrives as `unresolved`.

Watchtower keeps, for the monthly report: the fingerprint, `kind`, `name`, count, first and last times seen, `critical`, and the Sentry issue's ID and link. An incident's message or a Sentry issue's title is read when a page shows it, and isn't stored. The first three are ADR 0016 § 1's list; `name`, the count, and the times are the additions § 5 proposed, now held by Watchtower instead of an ingest endpoint.

### `incidentsRoute` serves editors only

§ 4 gave `incidentsRoute` to a scoped read-only token for Watchtower. ADR 0009's amendment of the same date keeps agent tokens to the MCP route, and Watchtower now reads the table through D1, so the route takes the editor session only. The Health panel and #480 read it. An agent that needs incidents can get an MCP tool later, through `mcpRoute` and its scopes.

### Alerts come from Sentry where there is Sentry

§ 6 stands: `critical` is a site parameter, stored on the row and sent as a Sentry tag. A Sentry alert rule on that tag posts a site's critical incidents to Discord. For a site without Sentry, Watchtower alerts when its poll finds a new or reopened critical row. A failed probe alerts from Watchtower, as it already does.

## Amendment (2026-09-27, at § 7)

§ 7 gave `processBatch` and `deadLetterConsumer` an `onIncident` of their own. Neither has the Worker's `env` or `ctx`: `processBatch` takes only a batch and a handler, and a sink like `d1Incidents` needs the bindings. Passing them in would repeat the site's `onIncident` configuration at every call.

Instead, both hand their incident to an internal isolate channel, and capture buffers it the way it buffers a degrade (§ 3). When the Worker's `queue` handler finishes, the report goes to the same sinks, with the same `critical` list and release. So:

- **`processBatch`** gains `maxRetries` only, defaulting to 3. On delivery `maxRetries + 1` it reports a `queue` incident, named for the error, with the queue's name as its path.
- **`deadLetterConsumer(database, table?)`** takes the D1 binding the way `d1Incidents` does. It reports each kept message as a `queue` incident named `DeadLetter`, so one dead-letter queue is one incident with a count.
- **Without `onIncident`,** nothing listens, and the log line each already writes is the only trace, as before.

`listDeadLetters` and `replayDeadLetter` are the runbook's read and replay. The Health panel's dead-letter count waits for the Health panel's incident view.

## Amendment (2026-09-27, at § 8)

§ 8 put the `reason` in `runAi`'s degrade details. A report doesn't carry details (§ 1), so the reason wouldn't reach the incident row, its fingerprint, or Sentry. It's part of the name instead: `ai.run.model-retired`, `ai.run.rate-limited`, and so on, with the reason still in the details for the log line. A search for `ai.run`, and a `critical` entry of `ai.run`, still match every one. An unusable reply is reported as `ai.invalid-output`, beside the existing `ai.truncated`.

The helpers keep returning `null`, and tell a caller why through an `onFailure` option, which `aiRoute` uses for its `502` body.

## Amendment (2026-10-04, at § 2)

§ 2's redaction missed a failed query. Starting with its 0.44 release, drizzle-orm wraps one in `DrizzleQueryError`, whose message is `Failed query: <sql>` with a `params: <bound values>` line after it, and whose stack repeats that message. The values are whatever the query wrote or matched on, such as a name, an address, or a note, and neither the email rule nor the token rule recognizes them. So a query error that reached reporting, caught or uncaught, put them in Workers Logs, the `incidents` table, and Sentry.

- **A query error's message is reduced before any redaction.** It keeps the statement's kind and first table (`Failed query: insert into inquiries`) and the first line of the database's error from `cause`, cut at its first quoted literal, because D1 quotes a rejected value (`D1_TYPE_ERROR: Type <value>`). The SQL and the bound values are dropped. The reduction happens where every cause is read, an `UpstreamError`'s included, so the `reportDegraded` log line, which § 2's redaction never covered, gets it too.
- **`redactMessage` gains a third rule.** A failed query quoted in free text shrinks the same way, with or without its `params:` marker, since a clipped line or SQL with an inlined value can still hold one. Text that's already reduced stays as it is. Email addresses and token runs are redacted as before, after it.
- **A query error is named for its class.** drizzle-orm doesn't set `name`, so its errors read `Error`. A report names one `DrizzleQueryError`, from its constructor, and § 2's fingerprint hashes that name and the reduced message. The same query failing with different values is one incident. Incidents recorded before this change keep their old fingerprint, so a failing query opens a new row and a new Sentry issue once.
- **A reduced copy goes everywhere the original would leave the Worker.** `loggableError`, now on the `errors` subpath, copies an error that holds a query error anywhere (its `cause` chain, an `AggregateError`'s `errors`, or another own field, array, or plain object), with each query error reduced and its stack frames kept. When it can't be sure a part holds no values, such as a field holding a `Map`, it leaves that part out. A query error's `cause`, the driver's own error, becomes that error's first line cut at the first quoted literal, with only code-shaped fields and no `cause` of its own, since a driver can quote a value. An error too big or too deep to check, a `cause` chain past ten levels or more than 5,000 fields or values, is copied whether or not it holds a query error, and what's past the limit is left out: the check fails closed. Redaction never changes an error's class or its public fields: every error in the copy keeps its original's prototype and its own fields, such as `name`, `code`, and `status`, and only a query error's message and stack change, with its `query` and `params` left out. The kit's own `console.error` calls log the copy, and `reportDegraded` hands `onDegraded` listeners the copy as `event.cause`, since a listener can forward it to an error tracker. `composeWorker` re-throws the copy in place of the original, which changes § 3's "re-thrown," because the runtime writes an uncaught exception's message and stack to Workers Logs; the Astro adapter's middleware reports and re-throws it too. Any other thrown value is re-thrown as it was. So a `LouiseContentError` that wraps a failed write is still a `LouiseContentError` above `composeWorker`, and its incident keeps its name, its `CONTENT_ERROR` code, and its fingerprint; only an identity check against the original object, and code that read the query error's `query` or `params`, see a difference.
- **A sink's `context.cause` is the copy for a query error.** The amendment before § 4 gave sinks the thrown value so the Sentry sink could send its stack frames. A query error's stack holds its bound values, and a value shaped like a frame would be parsed as one, so a sink now gets the copy. Every other cause is still passed as it was.

A copy has only its original's own data fields, so a wrapper class that keeps state in `#private` fields throws when its methods read them on the copy. The kit's errors don't use them.

Every way the kit lets an error or its text leave the Worker has a test that a bound value, and a value the driver quotes, can't appear: the `reportDegraded` log line, the `onDegraded` event, what `composeWorker` and the adapter's middleware re-throw, each sink's report and `context.cause`, the kit's `console` calls (with a check that none logs a caught value as it was), `describeFailure`, and `runMigration`'s `errors`.

What this can't reach: an error a site logs, returns, or sends itself without `loggableError` (a `withHealing` fallback's `ctx.error` included), a database error thrown without drizzle-orm, such as a raw D1 call's, text a site passes in as a report's `message` or a degrade's `details`, an error from a page or endpoint when the adapter's `reportErrors` is `false`, and an error a streamed page throws after its first bytes, which no middleware sees.

## Consequences

- **Six PRs in this repository, in order:** the report and fingerprint (§ 1 and § 2), capture in `composeWorker` (§ 3), the table, sink, and editor route, with the sink's `{ env, cause }` argument (§ 4 and the amendment), the queue changes (§ 7), the AI reasons (§ 8), and an Analytics Engine sink. Each is a `minor` changeset with no new dependency.
- **`@louise-toolkit/astro`**'s middleware reports what a page, an endpoint, or the middleware throws, through `reportIncident`, then re-throws it. Astro catches that error outside every middleware and renders its own 500, so `composeWorker` never sees a throw; this is how an Astro site's route errors reach the same sinks.
- **astroidjs** wires the sinks by default in its scaffold, generates a dead-letter consumer for each declared dead-letter queue, and adds the Sentry sink as a per-site setting, turned on for every Monitored and Supported site.
- **louise-ops** records each site's Sentry project in the site registry. Watchtower reads incidents from each site's D1 and from Sentry, and the `search_incidents`, `get_incident`, and `site_status` tools read the same two sources.
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
- **Sites pushing summaries to louise-ops (§ 5 as first written).** Withdrawn by the amendment: pulling with the tokens Watchtower already holds needs no ingest endpoint and no per-site token, and Sentry already counts and alerts.
- **Sentry's own grouping.** Rejected by the amendment: it would group differently from the site's D1, so a row and an issue couldn't be matched.
- **Sentry's user feedback for owner tickets.** Rejected: its widget is a browser script on the page, which ADR 0016 § 2 rules out; a ticket's body would sit in the Bowen Labs Sentry organization, which § 1 rules out; and it has no way to reply to the owner. Tickets stay in the site's D1, as the support module plans, and a ticket can link to a Sentry issue.
