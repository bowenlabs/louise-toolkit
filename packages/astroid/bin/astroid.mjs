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

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
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
  const astroBin = resolveBin(cwd, "astro", "astro");
  if (!astroBin) {
    fail("Could not find `astro` in this project. Run inside an Astroid project (with astro installed).");
  }
  const child = spawn(process.execPath, [astroBin, subcommand, ...rest], { stdio: "inherit", cwd });
  child.on("exit", (code) => process.exit(code ?? 0));
}

/** Resolve a project-local CLI bin (astro, wrangler) to an absolute path via the
 *  project's own dependency resolution — so we run the version it ships. */
function resolveBin(cwd, pkgName, binName) {
  try {
    const require = createRequire(join(cwd, "package.json"));
    const pkgPath = require.resolve(`${pkgName}/package.json`);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
    return binRel ? join(dirname(pkgPath), binRel) : null;
  } catch {
    return null;
  }
}

// --- deploy ----------------------------------------------------------------
// `astroid deploy` orchestrates the one-time platform bring-up: provision the
// bindings that still hold placeholder ids (D1/R2/KV), apply migrations, prompt
// for secrets, and deploy — all by shelling out to the project's own `wrangler`.
// It's plan-first: it prints exactly what it will run, and only proceeds past the
// irreversible steps on an interactive `y` (or `--yes`). `--dry-run` prints the
// plan and stops; `--local` targets the local D1 for migrations.

const isPlaceholder = (v) => !v || /^<.*>$/.test(v);

/** Pull the deploy-relevant bits out of wrangler.jsonc by regex — robust against
 *  its JSONC comments + trailing commas (a strict JSON.parse would throw). */
function readWranglerFacts(text) {
  return {
    name: text.match(/"name":\s*"([^"]+)"/)?.[1],
    d1Name: text.match(/"database_name":\s*"([^"]+)"/)?.[1],
    d1Id: text.match(/"database_id":\s*"([^"]*)"/)?.[1],
    r2: [...text.matchAll(/"bucket_name":\s*"([^"]+)"/g)].map((m) => m[1]),
    kv: [...text.matchAll(/{\s*"binding":\s*"([^"]+)",\s*"id":\s*"([^"]*)"/g)].map((m) => ({
      binding: m[1],
      id: m[2],
    })),
    // Real (uncommented) account_id line, filled in?
    hasAccount: /^\s*"account_id":\s*"[^<][^"]*"/m.test(text),
  };
}

/** Build the ordered provisioning plan from the still-placeholder bindings. */
function provisionPlan(facts) {
  const steps = [];
  for (const bucket of facts.r2) {
    steps.push({ kind: "r2", name: bucket, args: ["r2", "bucket", "create", bucket] });
  }
  if (facts.d1Name && isPlaceholder(facts.d1Id)) {
    steps.push({ kind: "d1", name: facts.d1Name, args: ["d1", "create", facts.d1Name] });
  }
  for (const { binding, id } of facts.kv) {
    if (isPlaceholder(id)) {
      steps.push({ kind: "kv", name: binding, args: ["kv", "namespace", "create", binding] });
    }
  }
  return steps;
}

/** Look up a just-created resource's id by name via a `… list` JSON command. */
function lookupId(wranglerBin, cwd, args, pick) {
  try {
    const rows = JSON.parse(execFileSync(process.execPath, [wranglerBin, ...args], { cwd, encoding: "utf8" }));
    return pick(Array.isArray(rows) ? rows : []) ?? null;
  } catch {
    return null;
  }
}

/** Replace a KV binding's placeholder id in the wrangler.jsonc text. */
function patchKvId(text, binding, id) {
  return text.replace(
    new RegExp(`("binding":\\s*"${binding}",\\s*"id":\\s*)"<[^"]*>"`),
    `$1${JSON.stringify(id)}`,
  );
}

async function cmdDeploy(cwd, flags, rest) {
  const dryRun = rest.includes("--dry-run");
  const assumeYes = rest.includes("--yes") || rest.includes("-y");
  const remoteArgs = rest.includes("--local") ? [] : ["--remote"];

  await loadConfig(cwd, flags.config); // validates the config (throws on a bad shape)
  const wranglerPath = join(cwd, "wrangler.jsonc");
  if (!existsSync(wranglerPath)) fail("wrangler.jsonc not found — run inside an Astroid project.");

  // Regenerate so the shipped worker/schema always match the config.
  await cmdGenerate(cwd, flags, { quiet: true });

  let wrangler = readFileSync(wranglerPath, "utf8");
  const facts = readWranglerFacts(wrangler);
  const plan = provisionPlan(facts);

  // Print the plan.
  out("astroid deploy — plan:\n");
  out("  Provision:");
  if (plan.length === 0) out("    (all bindings already have ids)");
  for (const s of plan) out(`    wrangler ${s.args.join(" ")}`);
  out(`\n  Migrate:  wrangler d1 migrations apply DB ${remoteArgs.join(" ")}`.trimEnd());
  out("  Secrets:  wrangler secret put SESSION_SECRET   (prompted)");
  out("  Deploy:   wrangler deploy\n");
  if (!facts.hasAccount) {
    out("  ! No account_id set — uncomment it in wrangler.jsonc or export CLOUDFLARE_ACCOUNT_ID.\n");
  }

  if (dryRun) {
    out("(dry run — nothing executed)");
    return;
  }

  // Gate the irreversible work behind a clear yes.
  if (!assumeYes) {
    if (!process.stdin.isTTY) {
      fail("Refusing to provision + deploy non-interactively. Re-run with --yes (or --dry-run to preview).");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Provision the above, then migrate + deploy? [y/N] ")).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      out("Aborted.");
      return;
    }
  }

  const wranglerBin = resolveBin(cwd, "wrangler", "wrangler");
  if (!wranglerBin) fail("Could not find `wrangler` in this project (add it as a devDependency).");
  const runInherit = (args) => spawnSync(process.execPath, [wranglerBin, ...args], { cwd, stdio: "inherit" });

  // 1) Provision, patching discovered ids back into wrangler.jsonc.
  for (const s of plan) {
    out(`\n▸ wrangler ${s.args.join(" ")}`);
    const res = runInherit(s.args);
    // R2 bucket create is idempotent-ish (an existing bucket errors) — tolerate it.
    if (res.status !== 0 && s.kind !== "r2") fail(`Provisioning failed at: wrangler ${s.args.join(" ")}`);

    if (s.kind === "d1") {
      const id = lookupId(wranglerBin, cwd, ["d1", "list", "--json"], (rows) => rows.find((r) => r.name === s.name)?.uuid);
      if (id) {
        wrangler = wrangler.replace(/"database_id":\s*"<[^"]*>"/, `"database_id": ${JSON.stringify(id)}`);
        writeFileSync(wranglerPath, wrangler);
        out(`  ↳ database_id = ${id}`);
      } else {
        out("  ↳ couldn't auto-detect the id — fill database_id in wrangler.jsonc by hand.");
      }
    } else if (s.kind === "kv") {
      const id = lookupId(wranglerBin, cwd, ["kv", "namespace", "list"], (rows) =>
        rows.find((r) => typeof r.title === "string" && r.title.endsWith(s.name))?.id,
      );
      if (id) {
        wrangler = patchKvId(wrangler, s.name, id);
        writeFileSync(wranglerPath, wrangler);
        out(`  ↳ ${s.name} id = ${id}`);
      } else {
        out(`  ↳ couldn't auto-detect ${s.name}'s id — fill it in wrangler.jsonc by hand.`);
      }
    }
  }

  // 2) Migrations.
  out(`\n▸ wrangler d1 migrations apply DB ${remoteArgs.join(" ")}`.trimEnd());
  if (runInherit(["d1", "migrations", "apply", "DB", ...remoteArgs]).status !== 0) fail("Migrations failed.");

  // 3) Secrets (interactive; wrangler prompts for the value).
  out("\n▸ wrangler secret put SESSION_SECRET");
  runInherit(["secret", "put", "SESSION_SECRET"]);

  // 4) Deploy.
  out("\n▸ wrangler deploy");
  if (runInherit(["deploy"]).status !== 0) fail("Deploy failed.");
  out("\n✓ Deployed.");
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
  astroid deploy   [--dry-run] [--yes] [--local]     provision bindings + migrate + secrets + deploy

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
      await cmdDeploy(cwd, flags, rest);
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
