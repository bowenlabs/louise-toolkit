---
"louise-toolkit": minor
---

`processBatch` now waits before a failed message is redelivered (#632). Each retry passes `delaySeconds` from `defaultRetryDelay(attempts)`: 30 seconds on the first delivery, then a minute, then two, doubling up to a 5-minute cap. Before, it called `retry()` with no delay, so a failure from a rate limit or an upstream outage spent every redelivery inside the same bad minute.

A new optional third argument, `{ retryDelay }`, takes the delay in seconds for a given attempt. To keep the old behavior, pass `{ retryDelay: () => 0 }`. The delay `processBatch` sets overrides a `retry_delay` in the queue's `wrangler.jsonc`, so a consumer that relied on that setting passes its own `retryDelay` instead.

A message that's already waiting when you deploy keeps the delay it was given; the new backoff applies from its next failure.
