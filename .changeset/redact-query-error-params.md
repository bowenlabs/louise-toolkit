---
"louise-toolkit": minor
---

Security fix: incident reports, logs, and re-thrown errors no longer carry a failed query's bound values. It's a minor because a query error's incident changes name and fingerprint, and a site that matches on the old name has one edit to make (see **Upgrading** below).

Starting with its 0.44 release, drizzle-orm throws a `DrizzleQueryError` whose message is `Failed query: <sql>` followed by `params: <bound values>`, and whose stack repeats that message. Those values are whatever the query wrote or matched on, such as a customer's name, address, notes, or customer ID. The toolkit kept that message, so any query error that reached reporting, caught or uncaught, wrote the values to Workers Logs (through the `reportDegraded` log line and the runtime's record of an uncaught exception), to the `incidents` table, and to any sink that forwards a report or the error's stack, such as an error tracker. `redactMessage` only removed email addresses and token-like strings, so it couldn't catch a name or a street.

Now every report reduces a failed query to its statement's kind and table, plus the first line of the database's own error up to its first quoted literal, and drops the SQL and the values:

```text
DrizzleQueryError: Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email
```

A D1 type error, which quotes the value it rejected, reads `Cause: D1_TYPE_ERROR: Type <value>`.

- `reportDegraded`'s log line and its `onDegraded` event, and every incident report from `composeWorker`, `reportIncident`, or a queue, carry the reduced form, an `UpstreamError` that quotes a failed query included. The same query failing with different values is now one incident, named `DrizzleQueryError` instead of `Error`.
- `redactMessage` also reduces a failed query quoted inside a longer message, with or without its `params:` line.
- New: `loggableError(value)` in `louise-toolkit/errors` returns a copy of an error whose `cause` chain holds a query error, with each one reduced and its stack frames and fields such as `code` kept. Anything else comes back as it was. The toolkit's own error logs (a failed MCP tool, status check, queue handler, dead-letter write, or incident sink) use it.
- `composeWorker` re-throws a failed query's error as that copy, so the runtime's exception record in Workers Logs holds no values. Any other thrown value is re-thrown as it was.
- A sink's `context.cause` is that copy for a query error, so a sink that parses stack frames, such as a Sentry sink, can't pick up a value shaped like a frame. Any other cause is passed as it was.

**Upgrading:** bump `louise-toolkit` and `@louise-toolkit/astro` together, and `astroidjs` once it admits this minor, then check that the lockfile holds one `louise-toolkit` version. A site on `^0.43` doesn't get this fix until it moves to 0.44.

One edit some sites need: if a `critical` list, a Sentry alert rule, or a saved search names `Error` to catch a query failure, change it to `DrizzleQueryError`.

Expect these after the upgrade:

- **Every query-error incident gets a new fingerprint and a new name.** After the upgrade, the open row for a failing query stops counting, and a new row opens beside it. With Sentry, each one opens a new issue, and the old issue stays unresolved.
- **Old rows and issues can still hold values.** Resolve the old query-error rows in the site's `incidents` table, and resolve or delete the matching Sentry issues. Delete a row or an issue if you need the values in it gone.
- **Code that catches what `composeWorker` re-throws** gets a plain `Error` named `DrizzleQueryError` for a failed query, not drizzle-orm's class, so an `instanceof DrizzleQueryError` check there no longer matches.

What this doesn't reach: an error your own code logs without `loggableError`. Wrap it: `console.error("…", loggableError(err))`.
