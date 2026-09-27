---
"louise-toolkit": minor
---

`composeWorker` captures incidents (ADR 0022 § 3). Pass `onIncident` (one sink, a list, or `{ sinks, critical, release }`), and every failure the Worker's handlers see becomes an `IncidentReport` sent to your sinks:

- **A throw** from a route, the fallback, `queue`, or `scheduled` is reported, then re-thrown, so responses don't change.
- **A `reportDegraded` call** is reported through the next handler to finish in the isolate, since a degrade has no `ctx` of its own.
- **Sinks run through `ctx.waitUntil`,** after the response. A sink that throws or rejects is logged and ignored.
- **`critical`** marks the failures that should alert, by dotted name or path prefix. `isCriticalIncident` (`louise-toolkit/incidents`) is the same check.
- **`release`** reads the deployed version from the Worker's bindings.

`withIncidentCapture(handler, capture)` does the same wrapping for a handler you compose by hand. Without `onIncident`, `composeWorker` behaves as before.

Nothing stores reports yet: the D1 table and sink follow in the next release. Until then, a sink that logs is enough to see them in Workers Logs.
