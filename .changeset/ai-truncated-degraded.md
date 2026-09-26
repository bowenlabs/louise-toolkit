---
"louise-toolkit": patch
---

`runAiText` reports a truncated answer through `reportDegraded` as `ai.truncated`, instead of logging its own warning. A cut-off answer is a degrade: the helpers return `null` and the caller keeps its fallback, the same as a failed call, which already reports as `ai.run`. Now one search finds both.

The log line changed shape and level. It was a warning, `[louise-toolkit/ai] answer truncated at the output cap (<model>)`, followed by an object. It's now one line at error level, `[louise] degraded ai.truncated: answer hit the output token cap {"model":"<model>","finishReason":…,"completionTokens":…,"maxTokens":…}`. The error level is deliberate, because a degrade should be visible. An `onDegraded` listener now hears truncations too, so an error tracker you forward degrades to starts receiving them.

**What to do:** if a log search or alert matches the old text, match `[louise] degraded ai.truncated` instead. If an `onDegraded` listener pages someone, decide whether a truncation should. The old line never shipped in a release, so this only affects a site that runs the kit from `main`.
