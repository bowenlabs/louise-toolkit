---
"louise-toolkit": patch
---

`processBatch` now logs each handler failure before it retries the message. Until now, a handler's error was caught and turned into a `retry()` with no log line, so a message that failed every attempt reached the dead-letter queue, or was dropped, and left no trace in Workers Logs. Now each failure writes one `console.error` line that names the queue, the message id, and the delivery attempt, with the error itself as the second argument.

Nothing to change on upgrade. Expect one new error line in Workers Logs per failed delivery. A handler that already logs its own error before throwing now logs it twice; drop the handler's own line if you don't want both.
