---
"louise-toolkit": minor
---

Incident counts over time, in Analytics Engine (ADR 0022):

- **`analyticsIncidents((env) => env.INCIDENT_EVENTS)`** (`louise-toolkit/incidents`) is a sink that writes one data point per report, indexed by fingerprint, so a site can see whether a failure is happening more often. Give it its own dataset, not the Core Web Vitals one. `incidentDataPoint` builds the point for a sink of your own.
- **`incidentCountsSqlQuery`** builds the SQL for each incident's count per day or hour, weighted for sampling, with an optional `timeZone` for where a site's day starts. **`parseIncidentCountRows`** reads the result.
