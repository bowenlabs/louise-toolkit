// Verify the PUBLISHED export map, not the source tree.
//
// Why this exists: every test in the workspace resolves `louise-toolkit/*` to
// source, because vitest aliases it. That is fast and convenient and it means the
// suite is structurally blind to the one bug class that only bites consumers—a
// symbol that exists in `src/` but was never re-exported from the public entry
// point, or a subpath in `exports` whose `dist/` target was never emitted.
//
// That bug is not hypothetical here. Extracting the Astro adapter (#327) turned up
// three symbols it needed—`applyFieldSave`, `applySettingsPatch`,
// `SettingsPatchConfig`—that were reachable from `src/` and from nowhere a
// consumer could see. Nothing in CI could have caught it, because the only thing
// exercising the real export map was astroid typechecking against the built
// library, and that gate disappears when astroid moves to its own repo.
//
// Run AFTER `pnpm -C packages/louise run build`.
//
//   node scripts/ci/checks/export-map.mjs

import fs from "node:fs";
import path from "node:path";

const pkgDir = "packages/louise";
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));

let failures = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};

// ---------------------------------------------------------------------------
// 1. Every subpath in `exports` resolves to a file that the build actually made.
// ---------------------------------------------------------------------------
const targets = [];
for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  const conditions = typeof entry === "string" ? { default: entry } : entry;
  for (const [condition, target] of Object.entries(conditions)) {
    if (typeof target !== "string") continue;
    // A wildcard subpath (`./components/*.astro`) has no single file to stat.
    if (target.includes("*")) continue;
    targets.push({ subpath, condition, target });
  }
}
console.log(
  `Checking ${targets.length} export targets across ${Object.keys(pkg.exports ?? {}).length} subpaths…`,
);
for (const { subpath, condition, target } of targets) {
  if (!fs.existsSync(path.join(pkgDir, target))) {
    fail(`"${subpath}" (${condition}) → ${target} was never emitted`);
  }
}

// ---------------------------------------------------------------------------
// 2. Symbols a first-party consumer needs must be reachable from a PUBLIC
//    subpath. This list is the import surface of first-party consumers outside
//    this package, the Astro adapter (#327) and Louise's knowledge search
//    (#555): every one of these has to be importable without reaching into
//    `louise-toolkit/src/...`.
// ---------------------------------------------------------------------------
const required = {
  "./content": ["CollectionConfig", "FieldConfig"],
  "./editor": [
    "EditorRouteEnv",
    "SaveCollectionConfig",
    "SaveDraftDeps",
    "SettingsPatchConfig",
    "applyFieldSave",
    "applySaveDraft",
    "applySettingsPatch",
  ],
  "./auth": ["EditorSession"],
  "./forms": ["FormConfig", "FormField"],
  "./forms/turnstile": ["renderTurnstile", "turnstileCsp", "verifyTurnstileToken"],
  "./db": ["D1_BOOKMARK_COOKIE"],
  "./worker": ["LOUISE_EDIT_COOKIE", "louiseApiGate", "isLouisePublicPath", "LOUISE_API_PREFIX"],
  "./security": ["sanitizeRichHtml"],
  // Louise's knowledge search fuses its own FTS5 and Vectorize results with
  // these. They used to live in editor/search.ts, where no consumer could reach
  // them (#555).
  "./ai": ["fuseRankings", "RRF_K", "RankedList", "FuseRankingsOptions"],
};

for (const [subpath, symbols] of Object.entries(required)) {
  const entry = pkg.exports?.[subpath];
  const types = typeof entry === "string" ? null : entry?.types;
  if (!types) {
    fail(`"${subpath}" has no \`types\` condition — cannot verify its surface`);
    continue;
  }
  const file = path.join(pkgDir, types);
  if (!fs.existsSync(file)) {
    fail(`"${subpath}" types → ${types} was never emitted`);
    continue;
  }
  const dts = fs.readFileSync(file, "utf8");
  for (const symbol of symbols) {
    // Word-boundary match against the emitted declarations. Deliberately simple:
    // a false PASS needs the identifier to appear while not being exported, which
    // the bundled .d.ts shape makes unlikely, and a real regression (the symbol
    // dropped from the barrel entirely) always fails.
    if (!new RegExp(`\\b${symbol}\\b`).test(dts)) {
      fail(
        `"${subpath}" does not expose \`${symbol}\` — it exists in src/ and nowhere a consumer can reach`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Every public-looking module IS exported.
//
// Checks 1 and 2 both start from the `exports` map, so neither can see the one
// failure mode that produced them: a module written, tested, changelogged—and
// never declared. `src/core/mcp/` shipped exactly that way in 0.27.0. Its own
// header comment called it `louise-toolkit/mcp`, it had a passing test file, the
// release notes announced it, and it reached npm in neither `exports` nor
// `dist/`, because adding the subpath is a separate step from writing the module
// and nothing connected the two.
//
// A `src/core/<name>/index.ts` is the shape every public subpath here takes, so
// one that no `exports` target mentions is either a missed export or a module
// that should not be named `index.ts`. Both are worth a failed build.
// ---------------------------------------------------------------------------
const targetsBlob = targets.map((t) => t.target).join("\n");
const coreDir = path.join(pkgDir, "src/core");
for (const name of fs.readdirSync(coreDir)) {
  const index = path.join(coreDir, name, "index.ts");
  if (!fs.existsSync(index)) continue;
  // The built target a subpath for this module would point at.
  if (!targetsBlob.includes(`dist/core/${name}/index.`)) {
    fail(
      `src/core/${name}/index.ts is not reachable from any \`exports\` subpath — ` +
        "it would ship to nobody. Add it to `exports` and to vite.config.ts's entry list, " +
        "or rename it if it is genuinely internal.",
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Entries that exist to avoid a dependency really do avoid it—as BUILT.
//
// A few subpaths are split out of a barrel for exactly one reason: the barrel
// imports an optional peer (`drizzle-orm`) that their callers shouldn't have to
// install. Source can't show whether that holds, because the bundler decides
// what shares a chunk: a module both entries import can land in a chunk that
// also pulls in the peer, and then the "light" entry imports it anyway. So this
// follows each entry's emitted imports, chunk to chunk, and fails on a
// forbidden package anywhere in the graph. `"*"` forbids every package.
// ---------------------------------------------------------------------------
const lightEntries = {
  "./content/define": ["drizzle-orm"],
  "./content/sections": ["drizzle-orm"],
  "./forms/turnstile": "*",
  // The router is an optional peer for `client/studio-shell` only (ADR 0011).
  "./client/studio": ["@tanstack/solid-router"],
};
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

for (const [subpath, forbidden] of Object.entries(lightEntries)) {
  const entry = pkg.exports?.[subpath];
  const start = typeof entry === "string" ? entry : entry?.import;
  if (!start) {
    fail(`"${subpath}" is listed as a light entry but has no \`import\` target`);
    continue;
  }
  const seen = new Set();
  const queue = [path.join(pkgDir, start)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    for (const [, spec] of fs.readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      if (spec.startsWith(".")) {
        queue.push(path.resolve(path.dirname(file), spec));
        continue;
      }
      const name = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0];
      if (forbidden === "*" || forbidden.includes(name)) {
        fail(
          `"${subpath}" imports \`${spec}\` (via ${path.relative(pkgDir, file)}) — ` +
            "this entry exists so its callers don't need that package",
        );
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} export-map problem(s). These are invisible to the test suite.`);
  process.exit(1);
}
console.log("Export map OK: every subpath emitted, every required symbol reachable.");
