import { describe, expect, it } from "vitest";
import {
  assertMigrationsApplied,
  compareMigrations,
  migrationName,
  migrationStatus,
} from "../../src/core/db/index.js";
import { LouiseDbError, LouisePendingMigrationsError } from "../../src/core/errors.js";

const FILES = ["0000_init.sql", "0001_pages.sql", "0002_search.sql"];

/** A D1 stub whose ledger query returns `ledger`, or throws `error`. */
function d1(ledger: string[] | Error) {
  const queries: string[] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      return {
        all: async () => {
          if (ledger instanceof Error) throw ledger;
          return { results: ledger.map((name, i) => ({ id: i + 1, name })) };
        },
      };
    },
  } as unknown as D1Database;
  return { db, queries };
}

describe("migrationStatus", () => {
  it("reports nothing pending when the ledger matches the code", async () => {
    const status = await migrationStatus(d1(FILES).db, FILES);
    expect(status).toEqual({ applied: FILES, pending: [], unknown: [] });
  });

  it("names the migrations the database is behind on, in apply order", async () => {
    const status = await migrationStatus(d1(["0000_init.sql"]).db, [...FILES].reverse());
    expect(status.pending).toEqual(["0001_pages.sql", "0002_search.sql"]);
    expect(status.applied).toEqual(["0000_init.sql"]);
  });

  it("flags a ledger that's ahead: a newer deploy migrated the shared database", async () => {
    const status = await migrationStatus(d1([...FILES, "0003_newer.sql"]).db, FILES);
    expect(status.pending).toEqual([]);
    expect(status.unknown).toEqual(["0003_newer.sql"]);
  });

  it("treats a database with no ledger yet as having applied nothing", async () => {
    const { db } = d1(new Error("D1_ERROR: no such table: d1_migrations: SQLITE_ERROR"));
    expect((await migrationStatus(db, FILES)).pending).toEqual(FILES);
  });

  it("takes paths as well as names", async () => {
    const status = await migrationStatus(
      d1(FILES).db,
      FILES.map((f) => `../../migrations/${f}`),
    );
    expect(status.pending).toEqual([]);
  });

  it("reads the table Wrangler's migrations_table names, and refuses an unsafe one", async () => {
    const { db, queries } = d1(FILES);
    await migrationStatus(db, FILES, { table: "schema_ledger" });
    expect(queries[0]).toContain('"schema_ledger"');
    await expect(migrationStatus(db, FILES, { table: 'x"; DROP TABLE pages; --' })).rejects.toThrow(
      LouiseDbError,
    );
  });

  it("wraps any other read failure in a LouiseDbError", async () => {
    const { db } = d1(new Error("D1_ERROR: network connection lost"));
    await expect(migrationStatus(db, FILES)).rejects.toBeInstanceOf(LouiseDbError);
  });
});

describe("assertMigrationsApplied", () => {
  it("throws LouisePendingMigrationsError naming the pending files", async () => {
    const error = await assertMigrationsApplied(d1(["0000_init.sql"]).db, FILES).catch((e) => e);
    expect(error).toBeInstanceOf(LouisePendingMigrationsError);
    expect(error).toBeInstanceOf(LouiseDbError);
    expect(error.files).toEqual(["0001_pages.sql", "0002_search.sql"]);
    expect(error.message).toContain("0001_pages.sql, 0002_search.sql");
  });

  it("returns the status when nothing is pending, unknown included", async () => {
    const status = await assertMigrationsApplied(d1([...FILES, "0003_newer.sql"]).db, FILES);
    expect(status.unknown).toEqual(["0003_newer.sql"]);
  });
});

describe("compareMigrations and migrationName", () => {
  it("dedupes and sorts the expected names", () => {
    expect(compareMigrations(["b.sql", "a.sql", "a.sql"], []).pending).toEqual(["a.sql", "b.sql"]);
  });

  it("keeps only the file name, from either path separator", () => {
    expect(migrationName("./migrations/0001_init.sql")).toBe("0001_init.sql");
    expect(migrationName("migrations\\0001_init.sql")).toBe("0001_init.sql");
    expect(migrationName("0001_init.sql")).toBe("0001_init.sql");
  });
});
