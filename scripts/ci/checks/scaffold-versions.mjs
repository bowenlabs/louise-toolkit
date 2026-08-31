// The scaffold must declare the toolkit versions it was BUILT against.
//
// Nothing else in the smoke test can check that. The clean room's `overrides`
// pin astroidjs/louise-toolkit to the tarballs for every install — which is what
// makes the clean room work, and also what makes the declared ranges invisible
// to it. A hand-written range in template/package.json therefore rots
// undetected: it once pinned `^0.1.0` while the template imported
// `astroidjs/astro`, an export the newest matching version did not have, so
// every scaffolded project died before Astro loaded its config and CI stayed
// green.
//
// create-astroid now derives these from its own resolved dependencies; this
// asserts the derivation actually happened and points at THESE tarballs, so
// re-hardcoding a literal fails here instead of on npm.
//
// Usage: node scaffold-versions.mjs <scaffold-dir>   (cwd = the clean room)
import fs from "node:fs";

const scaffold = process.argv[2];
if (!scaffold) {
  console.error("usage: scaffold-versions.mjs <scaffold-dir>");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(`${scaffold}/package.json`, "utf8"));
let bad = 0;

for (const name of ["astroidjs", "louise-toolkit", "@louise-toolkit/astro"]) {
  const packed = JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
  const declared = pkg.dependencies[name];
  const expected = `^${packed}`;
  if (declared !== expected) {
    console.error(
      `scaffold declares ${name} "${declared}", but the packed version is ` +
        `${packed} (expected "${expected}") — template/package.json is stale`,
    );
    bad++;
  }
}

if (bad) process.exit(1);
console.log("scaffold toolkit ranges match the packed versions");
