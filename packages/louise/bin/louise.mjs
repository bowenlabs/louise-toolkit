#!/usr/bin/env node
// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The `louise` CLI. Two commands:
//
//   louise gen-auth-schema [--config <path>] [--table-prefix <p>] [--out <file>]
//
// Regenerates a site's Better Auth migration SQL from config (issue #15)—no
// hand-written auth DDL. `--config` points at a module default-exporting an
// AuthSchemaConfig (`{ customers?, additionalFields?, tablePrefix? }`) that
// mirrors the site's `LouiseAuthConfig`; the schema is derived from the same
// plugin set the runtime uses. Writes to `--out` or stdout.
//
//   louise migrations-check <database> [--dir migrations] [--remote] [--config <wrangler config>] [--table d1_migrations]
//
// The deploy gate for schema migrations (issue #469). Reads the database's
// migrations ledger through `wrangler d1 execute`, compares it with the `.sql`
// files in `--dir`, and exits 1 when the database hasn't applied one of them,
// so a deploy can't land ahead of its migration. Read-only: it never applies
// anything. A ledger that's ahead of the code is reported, not failed.

import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { _: [] };
  // Flags that take no value; every other `--flag` takes the next argument.
  const booleans = new Set(["remote", "local"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (booleans.has(a.slice(2))) args[a.slice(2)] = true;
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function loadConfig(path) {
  if (!path) return {};
  const mod = await import(pathToFileURL(path).href);
  return mod.default ?? mod;
}

async function genAuthSchema(args) {
  // Import the generator from this package's own built output (bin/ and dist/
  // are siblings under the package root), so the CLI always uses the same
  // version it ships in—no dependency on node_modules layout.
  const { generateAuthSchemaSql } = await import(
    new URL("../dist/core/auth/index.js", import.meta.url).href
  );
  const config = await loadConfig(args.config);
  if (args["table-prefix"] !== undefined) config.tablePrefix = args["table-prefix"];
  const sql = generateAuthSchemaSql(config);
  if (args.out) {
    writeFileSync(args.out, sql);
    process.stderr.write(`Wrote auth schema → ${args.out}\n`);
  } else {
    process.stdout.write(sql);
  }
}

/** The ledger's migration names, through `wrangler d1 execute`. A ledger that
 *  doesn't exist yet means nothing is applied. */
function readLedger(database, args) {
  const table = args.table ?? "d1_migrations";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error(`Invalid --table: ${table}`);
  const wranglerArgs = [
    "d1",
    "execute",
    database,
    "--json",
    "--command",
    `SELECT name FROM "${table}" ORDER BY id`,
    args.remote ? "--remote" : "--local",
  ];
  if (args.config) wranglerArgs.push("--config", args.config);
  try {
    const out = execFileSync("wrangler", wranglerArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out).flatMap((r) => r.results.map((row) => row.name));
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        "wrangler isn't on PATH. Run this through your package manager, for example `corepack pnpm exec louise migrations-check …`.",
      );
    }
    const detail = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (/no such table/i.test(detail)) return [];
    throw new Error(`Couldn't read the migrations ledger with wrangler:\n${detail || err.message}`);
  }
}

// Same comparison as `compareMigrations` in louise-toolkit/db, kept here so the
// CLI doesn't load that module, which imports the optional drizzle-orm peer.
function migrationsCheck(args) {
  const [database] = args._;
  if (!database)
    throw new Error("Usage: louise migrations-check <database> [--dir migrations] [--remote]");
  const dir = args.dir ?? "migrations";
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ledger = readLedger(database, args);
  const done = new Set(ledger);
  const known = new Set(files);
  const pending = files.filter((f) => !done.has(f));
  const unknown = ledger.filter((n) => !known.has(n));
  const where = args.remote ? "remote" : "local";

  if (unknown.length) {
    process.stderr.write(
      `The ${where} database has applied ${unknown.length} migration(s) this code doesn't have, so a newer deploy migrated it: ${unknown.join(", ")}\n`,
    );
  }
  if (pending.length) {
    process.stderr.write(
      `The ${where} database is missing ${pending.length} migration(s) in ${dir}:\n${pending.map((f) => `  ${f}`).join("\n")}\nApply them before deploying: wrangler d1 migrations apply ${database}${args.remote ? " --remote" : ""}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`The ${where} database has every migration in ${dir} (${files.length}).\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const [command] = argv;
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case "gen-auth-schema":
      await genAuthSchema(args);
      break;
    case "migrations-check":
      migrationsCheck(args);
      break;
    default:
      process.stderr.write(
        "louise — Louise Toolkit CLI\n\nUsage:\n  louise gen-auth-schema [--config <path>] [--table-prefix <p>] [--out <file>]\n  louise migrations-check <database> [--dir migrations] [--remote] [--config <wrangler config>] [--table d1_migrations]\n",
      );
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
