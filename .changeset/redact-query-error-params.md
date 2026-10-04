---
"louise-toolkit": patch
---

Security fix: incident reports and logs no longer carry a failed query's bound values.

drizzle-orm 0.44 and later throw a `DrizzleQueryError` whose message is `Failed query: <sql>` followed by `params: <bound values>`. Those values are whatever the query wrote or matched on, such as a customer's name, address, notes, or customer ID. The toolkit kept that message, so any query error that reached reporting, caught or uncaught, wrote the values to Workers Logs through the `reportDegraded` log line, to the `incidents` table, and to any sink that forwards a report, such as an error tracker. `redactMessage` only removed email addresses and token-like strings, so it couldn't catch a name or a street.

Now every report reduces a failed query to its statement's kind and table, plus the first line of the database's own error, and drops the SQL and the values:

```text
DrizzleQueryError: Failed query: insert into inquiries. Cause: D1_ERROR: UNIQUE constraint failed: inquiries.email
```

- `reportDegraded`'s log line and its `onDegraded` event, and every incident report from `composeWorker`, `reportIncident`, or a queue, carry the reduced form. The same query failing with different values is now one incident, named `DrizzleQueryError` instead of `Error`.
- `redactMessage` also reduces a failed query quoted inside a longer message.
- The toolkit's own error logs (a failed MCP tool, status check, queue handler, dead-letter write, or incident sink) log a copy of the error with the values removed and its stack frames kept.

What to do: upgrade. Nothing else is required. Incident rows written before the upgrade can still hold values; resolve or delete them in the site's `incidents` table if you need them gone, and check your error tracker for the same. A sink's `context.cause` is still the original error, unredacted, as before: a custom sink that sends it anywhere has to scrub it first.
