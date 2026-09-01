// Assert this package's published entry points exist on disk. Run as
// `prepublishOnly`, from the package directory.
//
// It replaces a `prepublishOnly` that BUILT the package, and the difference is
// the point. `changeset publish` runs every package's `prepublishOnly`
// concurrently, and these packages are not independent: `@louise-toolkit/astro`
// and `astroidjs` type-check against `louise-toolkit`'s emitted `dist/*.d.ts`
// (`louise-toolkit/content`, `/forms`, `/auth`, `/db`), while `louise-toolkit`'s
// own build rewrites that same directory. During the 0.27.0 release the adapter's
// `tsgo` read `packages/louise/dist` while `vp pack` was rewriting it and died,
// after the other three packages had already published — a partial release, from
// a race that only exists during a publish.
//
// So the build moved to one ordered pass up front (`pnpm run build:packages`,
// which `pnpm release` runs), and what is left here is the guarantee that pass
// actually happened. Nothing this script does can race: it only reads.
//
// It does not detect STALE output — a dist older than src still passes. That is
// deliberate: a freshness check needs a heuristic (mtimes, hashes) that is wrong
// often enough to be ignored, and `pnpm release` rebuilds unconditionally anyway.
// This catches the failure that actually ships broken packages: nothing built.

import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const targets = new Set();
const collect = (value) => {
  if (typeof value === "string") {
    // Wildcard subpaths (`./components/*.astro`) have no single file to stat.
    if (!value.includes("*") && value.startsWith("./")) targets.add(value);
    return;
  }
  if (value && typeof value === "object") for (const v of Object.values(value)) collect(v);
};
collect(pkg.exports);
collect(pkg.main);
collect(pkg.types);
collect(pkg.bin);

const missing = [...targets].filter((t) => !fs.existsSync(t));

if (missing.length > 0) {
  console.error(
    `✗ ${pkg.name}@${pkg.version} is not built — ${missing.length} entry point(s) missing:\n`,
  );
  for (const m of missing.slice(0, 10)) console.error(`    ${m}`);
  if (missing.length > 10) console.error(`    …and ${missing.length - 10} more`);
  console.error(`\n  Build the workspace first, in dependency order:\n`);
  console.error(`    corepack pnpm run build:packages\n`);
  console.error(`  Or publish through the script that does it for you: corepack pnpm release`);
  process.exit(1);
}

console.log(`${pkg.name}@${pkg.version}: ${targets.size} entry point(s) present.`);
