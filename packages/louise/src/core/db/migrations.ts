// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/db—is the database migrated as far as this code expects?
//
// Schema migrations are applied out of band, with `wrangler d1 migrations
// apply`, and every deploy of a site shares one database. So a deploy can land
// before its migration, and the failure shows up later as a missing column on
// whatever route touches it first. This compares the migration files the code
// was built with against D1's ledger, `d1_migrations`, and says which side is
// behind. Read-only: it never applies anything.

import { LouiseDbError, LouisePendingMigrationsError } from "../errors.js";
import type { D1Client } from "./session.js";

/** The ledger table `wrangler d1 migrations apply` writes, unless
 *  `migrations_table` in the Wrangler config names another. */
export const D1_MIGRATIONS_TABLE = "d1_migrations";

/** How the code's migrations compare with the database's ledger. */
export interface MigrationStatus {
  /** Migrations the code expects that the database has applied. */
  applied: string[];
  /** Migrations the code expects that the database hasn't applied: the deploy
   *  is ahead of the database. Queries that need them fail until they're applied. */
  pending: string[];
  /** Migrations the database has applied that the code doesn't know: a newer
   *  deploy migrated the shared database ahead of this one. Usually harmless
   *  under expand and contract, but worth knowing. */
  unknown: string[];
}

export interface MigrationStatusOptions {
  /** The ledger table, if the Wrangler config sets `migrations_table`. Default
   *  {@link D1_MIGRATIONS_TABLE}. */
  table?: string;
}

/** A migration's ledger name: the file name, without any directory.
 *  `"./migrations/0001_init.sql"` is `"0001_init.sql"`. */
export function migrationName(file: string): string {
  return file.slice(file.replace(/\\/g, "/").lastIndexOf("/") + 1);
}

/**
 * Compare the migrations the code expects with the names in the ledger. Pure,
 * so a deploy script that reads the ledger its own way can use it too.
 * `expected` takes file names or paths; each is reduced to its name, and
 * `pending` keeps their sorted order, the order Wrangler applies them in.
 */
export function compareMigrations(
  expected: readonly string[],
  ledger: readonly string[],
): MigrationStatus {
  const names = [...new Set(expected.map(migrationName))].sort();
  const done = new Set(ledger);
  const known = new Set(names);
  return {
    applied: names.filter((n) => done.has(n)),
    pending: names.filter((n) => !done.has(n)),
    unknown: ledger.filter((n) => !known.has(n)),
  };
}

/**
 * How far the database is migrated, compared with the migration files the
 * code was built with. A database with no ledger yet has applied nothing, so
 * every expected migration is pending.
 *
 * `expected` is the list of migration file names bundled at build time, for
 * example, `Object.keys(import.meta.glob("../migrations/*.sql", { query: "?raw" }))`
 * with a bundler that supports it. Throws a {@link LouiseDbError} if the ledger
 * can't be read for any other reason.
 */
export async function migrationStatus(
  d1: D1Client,
  expected: readonly string[],
  options: MigrationStatusOptions = {},
): Promise<MigrationStatus> {
  const table = options.table ?? D1_MIGRATIONS_TABLE;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new LouiseDbError(`Invalid migrations table name: ${table}`);
  }
  let ledger: string[];
  try {
    const { results } = await d1
      .prepare(`SELECT name FROM "${table}" ORDER BY id`)
      .all<{ name: string }>();
    ledger = results.map((r) => r.name);
  } catch (err) {
    if (!/no such table/i.test(String((err as Error)?.message ?? err))) {
      throw new LouiseDbError("Couldn't read the migrations ledger.", err);
    }
    ledger = [];
  }
  return compareMigrations(expected, ledger);
}

/**
 * {@link migrationStatus}, but throws a {@link LouisePendingMigrationsError}
 * naming the pending migrations when there are any. Returns the status
 * otherwise, so a caller can still log `unknown`.
 */
export async function assertMigrationsApplied(
  d1: D1Client,
  expected: readonly string[],
  options?: MigrationStatusOptions,
): Promise<MigrationStatus> {
  const status = await migrationStatus(d1, expected, options);
  if (status.pending.length > 0) throw new LouisePendingMigrationsError(status.pending);
  return status;
}
