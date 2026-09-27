---
"louise-toolkit": minor
---

A new subpath, `louise-toolkit/incidents`, holds the pure part of incident capture (ADR 0022):

- **`IncidentReport`** is the flat, JSON-serializable shape every failure becomes: a throw from a route, a queue handler, or a cron, and a `reportDegraded` call.
- **`buildIncidentReport`** and **`incidentFromDegraded`** build one. They keep the request's pathname and host, never its query string, and they never throw.
- **`fingerprintFailure`** groups reports into incidents. It hashes the kind, name, code, and the message with its numbers, IDs, and quoted values replaced, and it leaves out the path, the stack, and the release.
- **`redactMessage`** replaces email addresses and long tokens in each report's message and path.

Nothing captures or stores reports yet. `composeWorker`'s `onIncident` and the sinks follow in later releases.

**Behavior change:** `describeFailure` (`louise-toolkit/worker`) now sets a `FailureReport`'s `url` to the request's pathname only, because a query string can carry a token. The field keeps its name and type. If an `escalate` hook reads the host or the query from `url`, take them from `HealingContext.request` instead.
