// Is the shared D1 database migrated as far as this deploy expects (#469)?
//
// Every deploy, branches included, shares one database, and migrations are
// applied by hand. So the Health panel checks live, on every read, rather than
// trusting the daily scan: a deploy can land between scans.

import type { HealthSummary } from "louise-toolkit/health";
import { migrationStatus } from "louise-toolkit/db";

/** The migration files this build shipped with. `?raw` keeps Vite from parsing
 *  the SQL as a module; only the names are read. */
const MIGRATIONS = Object.keys(import.meta.glob("../../../migrations/*.sql", { query: "?raw" }));

/** The migrations this deploy needs that the database hasn't applied. An
 *  unreadable ledger reports nothing rather than breaking the Health panel. */
export async function pendingMigrations(env: CloudflareEnv): Promise<string[]> {
  try {
    return (await migrationStatus(env.DB, MIGRATIONS)).pending;
  } catch (err) {
    console.error("[health] couldn't read the migrations ledger", err);
    return [];
  }
}

/** A stored summary with the live pending-migrations list in place of the scan's. */
export async function withLiveMigrations<T extends Pick<HealthSummary, "pendingMigrations">>(
  summary: T,
  env: CloudflareEnv,
): Promise<T> {
  const pending = await pendingMigrations(env);
  const { pendingMigrations: _stale, ...rest } = summary;
  return (pending.length ? { ...rest, pendingMigrations: pending } : rest) as T;
}
