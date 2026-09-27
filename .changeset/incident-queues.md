---
"louise-toolkit": minor
---

Queue failures are incidents (ADR 0022 § 7, as amended):

- **`processBatch`** reports a failure on a message's last delivery as a `queue` incident, named for the error, with the queue's name as its path. `maxRetries` (new, default `DEFAULT_MAX_RETRIES`, 3) is the queue's `max_retries`; set it when your `wrangler.jsonc` changes it. An earlier failure is only logged, as before. The report reaches `composeWorker`'s `onIncident` sinks when the Worker's `queue` handler finishes; without `onIncident`, nothing changes.
- **`deadLetterConsumer((env) => env.DB)`** (`louise-toolkit/incidents`) is a `queue` handler for a dead-letter queue. It keeps each message in a new `dead_letters` table in the site's D1, reports it as a `DeadLetter` incident, and acks it. Add `deadLetters` to your drizzle-kit schema and generate a migration.
- **`listDeadLetters` and `replayDeadLetter`** read kept messages and send one back onto a queue.

The last-attempt log line now says the message goes to the dead-letter queue, instead of that it's marked for retry.
