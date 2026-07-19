#!/usr/bin/env node
// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The `astroid` CLI — the meta-framework's project commands:
//
//   astroid generate [--config <path>] [--cwd <dir>]   regenerate schema/worker/middleware from the config
//   astroid doctor   [--config <path>] [--cwd <dir>]   validate config + bindings + generated-file freshness
//   astroid dev      [...astro args]                   generate, then `astro dev`
//   astroid build    [...astro args]                   generate, then `astro build`
//   astroid deploy                                     (not yet — provisioning is a later slice)
//
// It loads the project's `astroid.config.ts` with Node's native TypeScript
// stripping (the config only imports the built `astroidjs`, so it resolves), and
// consumes this package's own built generators from ../dist — the same version the
// CLI ships in, no dependency on node_modules layout (mirrors the louise bin).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GENERATORS_URL = new URL("../dist/index.js", import.meta.url).href;

// --- tiny arg parser -------------------------------------------------------
// Splits at the first non-flag token into { command, flags, rest }. `rest` is
// everything after the command, preserved verbatim so `dev`/`build` can forward
// arbitrary astro flags.
function parseArgs(argv) {
  const [command, ...tail] = argv;
  const flags = {};
  const rest = [];
  for (let i = 0; i < tail.length; i++) {
    const a = tail[i];
    if (a === "--config" || a === "-c") flags.config = tail[++i];
    else if (a === "--cwd") flags.cwd = tail[++i];
    else rest.push(a);
  }
  return { command, flags, rest };
}

// --- config loading --------------------------------------------------------
const CONFIG_CANDIDATES = ["astroid.config.ts", "astroid.config.mjs", "astroid.config.js"];

function resolveConfigPath(cwd, explicit) {
  if (explicit) {
    const abs = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (!existsSync(abs)) fail(`Config not found: ${explicit}`);
    return abs;
  }
  for (const name of CONFIG_CANDIDATES) {
    const abs = join(cwd, name);
    if (existsSync(abs)) return abs;
  }
  fail(
    `No Astroid config found in ${cwd}.\n` +
      `Expected one of: ${CONFIG_CANDIDATES.join(", ")} (or pass --config <path>).`,
  );
}

async function loadConfig(cwd, explicit) {
  const path = resolveConfigPath(cwd, explicit);
  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (err) {
    // A `defineAstroid` invariant violation (bad key/theme) throws here at import.
    fail(`Failed to load ${path}:\n${err instanceof Error ? err.message : String(err)}`);
  }
  const config = mod.default ?? mod.config;
  if (!config || typeof config !== "object") {
    fail(`${path} must \`export default defineAstroid({ … })\`.`);
  }
  return { config, path };
}

// --- commands --------------------------------------------------------------
async function cmdGenerate(cwd, flags, { quiet = false } = {}) {
  const { generateAstroidProject } = await import(GENERATORS_URL);
  const { config } = await loadConfig(cwd, flags.config);
  const files = generateAstroidProject(config);
  for (const file of files) {
    const abs = join(cwd, file.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.contents);
    if (!quiet) out(`  ✓ ${file.path}`);
  }
  if (!quiet) out(`Generated ${files.length} file(s) from your defineAstroid config.`);
  return files;
}

async function cmdDoctor(cwd, flags) {
  const { generateAstroidProject } = await import(GENERATORS_URL);
  const { config, path: configPath } = await loadConfig(cwd, flags.config);

  const problems = []; // { level: "error" | "warn", msg }
  const err = (msg) => problems.push({ level: "error", msg });
  const warn = (msg) => problems.push({ level: "warn", msg });
  const oks = [];
  const ok = (msg) => oks.push(msg);

  ok(`config loads and validates (${rel(cwd, configPath)})`);

  // 1. Generated trio freshness — regenerate in memory, diff against disk.
  for (const file of generateAstroidProject(config)) {
    const abs = join(cwd, file.path);
    if (!existsSync(abs)) {
      err(`${file.path} is missing — run \`astroid generate\`.`);
    } else if (readFileSync(abs, "utf8") !== file.contents) {
      warn(`${file.path} is stale (out of sync with your config) — run \`astroid generate\`.`);
    } else {
      ok(`${file.path} is up to date`);
    }
  }

  // 2. wrangler.jsonc bindings — presence checks + placeholder detection. Read as
  //    text (JSONC with comments/trailing commas) rather than parse, to stay robust.
  const wranglerPath = join(cwd, "wrangler.jsonc");
  if (!existsSync(wranglerPath)) {
    err("wrangler.jsonc is missing — scaffold with `create-astroid`.");
  } else {
    const w = readFileSync(wranglerPath, "utf8");
    const hasBinding = (name) => new RegExp(`"binding"\\s*:\\s*"${name}"`).test(w);
    if (hasBinding("DB")) ok("wrangler: D1 `DB` binding present");
    else err("wrangler.jsonc has no D1 `DB` binding.");
    if (hasBinding("MEDIA")) ok("wrangler: R2 `MEDIA` binding present");
    else err("wrangler.jsonc has no R2 `MEDIA` binding.");
    if (/"main"\s*:\s*"src\/worker\.ts"/.test(w)) ok("wrangler: `main` → src/worker.ts");
    else warn("wrangler.jsonc `main` does not point at src/worker.ts.");
    const placeholders = w.match(/<run:[^>]*>|<your-[^>]*>/g);
    if (placeholders) {
      warn(
        `wrangler.jsonc has ${placeholders.length} unresolved placeholder(s) ` +
          `(create the bindings, e.g. \`wrangler d1 create\`, then fill the ids).`,
      );
    }
  }

  // 3. migrations directory (matches the generated wrangler `migrations_dir`).
  if (existsSync(join(cwd, "migrations"))) ok("migrations/ directory present");
  else warn("no migrations/ directory — create your D1 schema migrations there.");

  // --- report ---
  for (const m of oks) out(`  ✓ ${m}`);
  for (const p of problems) {
    if (p.level === "warn") out(`  ! ${p.msg}`);
    else out(`  ✗ ${p.msg}`);
  }
  const errors = problems.filter((p) => p.level === "error").length;
  const warns = problems.filter((p) => p.level === "warn").length;
  out("");
  if (errors) {
    out(`doctor: ${errors} error(s), ${warns} warning(s).`);
    process.exit(1);
  }
  out(warns ? `doctor: healthy, ${warns} warning(s).` : "doctor: all checks passed.");
}

async function cmdAstro(cwd, subcommand, flags, rest) {
  // Regenerate first so schema/worker/middleware always match the config, then
  // hand off to the project's own astro. `dev`/`build` are thin wrappers.
  out(`astroid: regenerating from config…`);
  await cmdGenerate(cwd, flags, { quiet: true });
  const astroBin = resolveAstroBin(cwd);
  if (!astroBin) {
    fail("Could not find `astro` in this project. Run inside an Astroid project (with astro installed).");
  }
  const child = spawn(process.execPath, [astroBin, subcommand, ...rest], { stdio: "inherit", cwd });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function resolveAstroBin(cwd) {
  try {
    const require = createRequire(join(cwd, "package.json"));
    const pkgPath = require.resolve("astro/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.astro;
    if (!binRel) return null;
    return join(dirname(pkgPath), binRel);
  } catch {
    return null;
  }
}

// --- helpers ---------------------------------------------------------------
function out(s) {
  process.stdout.write(`${s}\n`);
}
function fail(msg) {
  process.stderr.write(`astroid: ${msg}\n`);
  process.exit(1);
}
function rel(cwd, abs) {
  return abs.startsWith(cwd) ? abs.slice(cwd.length + 1) : abs;
}

const USAGE = `astroid — the Astroid meta-framework CLI

Usage:
  astroid generate [--config <path>] [--cwd <dir>]   regenerate src/schema.ts, src/worker.ts, src/middleware.ts
  astroid doctor   [--config <path>] [--cwd <dir>]   validate config, bindings, and generated-file freshness
  astroid dev      [...astro args]                   regenerate, then run \`astro dev\`
  astroid build    [...astro args]                   regenerate, then run \`astro build\`
  astroid deploy                                     provision + deploy (coming soon)

New project:  npm create astroid@latest
`;

async function main() {
  const { command, flags, rest } = parseArgs(process.argv.slice(2));
  const cwd = flags.cwd ? resolve(flags.cwd) : process.cwd();

  switch (command) {
    case "generate":
    case "gen":
      await cmdGenerate(cwd, flags);
      break;
    case "doctor":
      await cmdDoctor(cwd, flags);
      break;
    case "dev":
      await cmdAstro(cwd, "dev", flags, rest);
      break;
    case "build":
      await cmdAstro(cwd, "build", flags, rest);
      break;
    case "deploy":
      out(
        "astroid deploy is not available yet — provisioning (D1/R2/KV + migrations + secrets)\n" +
          "is a later slice. For now: create the bindings with `wrangler … create`, fill the\n" +
          "ids in wrangler.jsonc, `wrangler d1 migrations apply`, then `wrangler deploy`.",
      );
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      out(USAGE);
      process.exit(command ? 0 : 1);
      break;
    default:
      process.stderr.write(`astroid: unknown command "${command}"\n\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
