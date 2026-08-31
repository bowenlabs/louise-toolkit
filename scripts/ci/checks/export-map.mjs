// Verify the PUBLISHED export map, not the source tree.
//
// Why this exists: every test in the workspace resolves `louise-toolkit/*` to
// source, because vitest aliases it. That is fast and convenient and it means the
// suite is structurally blind to the one bug class that only bites consumers — a
// symbol that exists in `src/` but was never re-exported from the public entry
// point, or a subpath in `exports` whose `dist/` target was never emitted.
//
// That bug is not hypothetical here. Extracting the Astro adapter (#327) turned up
// three symbols it needed — `applyFieldSave`, `applySettingsPatch`,
// `SettingsPatchConfig` — that were reachable from `src/` and from nowhere a
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
//    subpath. This list is the Astro adapter's import surface (#327): if the
//    adapter is to live outside this package, every one of these has to be
//    importable without reaching into `louise-toolkit/src/...`.
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
  "./db": ["D1_BOOKMARK_COOKIE"],
  "./worker": ["LOUISE_EDIT_COOKIE"],
  "./security": ["sanitizeRichHtml"],
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

if (failures > 0) {
  console.error(`\n${failures} export-map problem(s). These are invisible to the test suite.`);
  process.exit(1);
}
console.log("Export map OK: every subpath emitted, every required symbol reachable.");
