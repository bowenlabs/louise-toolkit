---
"louise-toolkit": patch
---

Security fix: incident reports and logs no longer carry a failed query's bound values.

drizzle-orm 0.44 and later throw a `DrizzleQueryError` whose message is `Failed query: <sql>` followed by `params: <bound values>`. Those values are whatever the query wrote or matched on, such as a customer's name, address, notes, or customer ID. The toolkit kept that message, so any query error that reached reporting, caught or uncaught, wrote the values to Workers Logs through the `reportDegraded` log line, to the `incidents` table, and to any sink that forwards a report, such as an error tracker. `redactMessage` only removed email addresses and token-like strings, so it couldn't catch a name or a street.

Now every report reduces a failed query to its statement's kind and table, plus the first line of the database's own error up to its first quoted literal, and drops the SQL and the values. A D1 type error, which quotes the value it rejected, reads `Cause: D1_TYPE_ERROR: Type <value>`.

```text
DrizzleQueryError: Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email
```

- `reportDegraded`'s log line and its `onDegraded` event, and every incident report from `composeWorker`, `reportIncident`, or a queue, carry the reduced form. The same query failing with different values is now one incident, named `DrizzleQueryError` instead of `Error`.
- `redactMessage` also reduces a failed query quoted inside a longer message.
- The toolkit's own error logs (a failed MCP tool, status check, queue handler, dead-letter write, or incident sink) log a copy of the error with the values removed and its stack frames kept.

What to do: upgrade. You don't need to change any code.

The upgrade has one edge, because a query error's report changes shape:

- **Every query-error incident gets a new fingerprint and a new name.** Its name is `DrizzleQueryError` instead of `Error`, and its fingerprint is built from the reduced message. So after the upgrade, the open row for a failing query stops counting, and a new row opens beside it. With Sentry, each one opens a new issue, and the old issue stays unresolved.
- **A match on the old name stops matching.** A `critical` entry, a Sentry alert rule, or a saved search that names `Error` for a query failure needs to name `DrizzleQueryError`.
- **Old rows and issues can still hold values.** Resolve the old query-error rows in the site's `incidents` table, and resolve or delete the matching Sentry issues. Delete a row or an issue if you need the values in it gone.

A sink's `context.cause` is still the original error, unredacted, as before: a custom sink that sends it anywhere has to scrub it first.
