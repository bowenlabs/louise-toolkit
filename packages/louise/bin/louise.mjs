#!/usr/bin/env node
// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// The `louise` CLI. Today it hosts one command:
//
//   louise gen-auth-schema [--config <path>] [--table-prefix <p>] [--out <file>]
//
// Regenerates a site's Better Auth migration SQL from config (issue #15) — no
// hand-written auth DDL. `--config` points at a module default-exporting an
// AuthSchemaConfig (`{ customers?, additionalFields?, tablePrefix? }`) that
// mirrors the site's `LouiseAuthConfig`; the schema is derived from the same
// plugin set the runtime uses. Writes to `--out` or stdout.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
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
  // version it ships in — no dependency on node_modules layout.
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

async function main() {
  const argv = process.argv.slice(2);
  const [command] = argv;
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case "gen-auth-schema":
      await genAuthSchema(args);
      break;
    default:
      process.stderr.write(
        "louise — Louise CMS CLI\n\nUsage:\n  louise gen-auth-schema [--config <path>] [--table-prefix <p>] [--out <file>]\n",
      );
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
