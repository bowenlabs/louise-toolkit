---
"louise-toolkit": minor
---

The site's D1 keeps its incidents (ADR 0022 § 4, as amended):

- **The `incidents` table** (`louise-toolkit/incidents`) holds one row per fingerprint, with a count, first and last times seen, and when it was resolved or reopened. Add it to your drizzle-kit schema with `export { incidents } from "louise-toolkit/incidents"`, and generate a migration.
- **`d1Incidents((env) => env.DB)`** is the sink that keeps the record: put it first in `composeWorker`'s `onIncident`. 100 identical throws become one row with a count of 100.
- **`upsertIncident`, `listIncidents`, `getIncident`, and `resolveIncident`** read and write the table. A resolved incident reopens when its failure comes back.
- **`incidentsRoute`** (`louise-toolkit/editor`) lists, reads, and resolves incidents at `/api/louise/incidents`, for the site's editors only.

**Sinks get a second argument, `{ env, cause }`:** the Worker's bindings, and the value that was thrown, unredacted and in memory only. A sink written for the one-argument form still works.

**`louise-toolkit/incidents` now needs `drizzle-orm`,** the optional peer the `db` subpath already needs. `louise-toolkit/worker`, where capture lives, still doesn't.
