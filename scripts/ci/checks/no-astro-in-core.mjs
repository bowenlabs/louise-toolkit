// `packages/louise/src` must not mention Astro. At all.
//
// louise-toolkit is described as framework-agnostic. Until #327 that was
// aspirational: the package shipped an `astro` peer dependency, an `./astro`
// export, six source files importing `astro`, view-transition event names in the
// client, and Astro's name in forty comments. Each of those was individually
// defensible and collectively they meant the claim was not true.
//
// They are all gone now. This keeps them gone, which matters more than it sounds:
// the pressure to write "e.g. `astro dev`" in a comment is constant, because Astro
// IS the reference host and it is genuinely the clearest example to reach for. The
// point is that a library making a portability claim should not be able to reach
// for it without noticing.
//
// Deliberately a text scan, not an AST rule. The failure this prevents is not a
// bad import — `lint:arch` catches those with better messages — it is Astro
// knowledge leaking back in through prose, and prose has no AST worth matching.
//
//   node scripts/ci/checks/no-astro-in-core.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = "packages/louise/src";
const PATTERN = /\bastro/i;

/** Where to say it instead. Not exhaustive, just the substitutions that keep
 *  coming up, so a failure carries a fix rather than only a complaint. */
const SUGGESTIONS = [
  ["astro dev", "a dev server"],
  ["Astro component", "the site's own component"],
  ["Astro Action", "a framework action"],
  ["Astro middleware", "the site's middleware"],
  ["astro:before-swap", "the host's before-swap signal (see client/lifecycle)"],
  ["Astro view transition", "a soft navigation"],
  ["Astro's SSR handler", "the framework's SSR handler"],
];

const hits = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    fs.readFileSync(full, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (PATTERN.test(line)) hits.push({ file: full, line: i + 1, text: line.trim() });
      });
  }
};

if (!fs.existsSync(ROOT)) {
  console.error(`${ROOT} does not exist — has the layout changed?`);
  process.exit(1);
}
walk(ROOT);

if (hits.length === 0) {
  console.log(`No Astro references in ${ROOT}. The framework-agnostic claim holds.`);
  process.exit(0);
}

console.error(`${hits.length} Astro reference(s) in ${ROOT}:\n`);
for (const { file, line, text } of hits) {
  console.error(`  ${file}:${line}`);
  console.error(`    ${text.slice(0, 120)}`);
  const hint = SUGGESTIONS.find(([from]) => text.toLowerCase().includes(from.toLowerCase()));
  if (hint) console.error(`    → say "${hint[1]}" instead`);
}
console.error(
  [
    "",
    "louise-toolkit is framework-agnostic, so its source should not name one framework —",
    "in code OR in prose.",
    "",
    "If you need Astro specifically, it belongs in `@louise-toolkit/astro` (the adapter)",
    "or `astroidjs` (the opinionated layer). If you only wanted a familiar example, use a",
    "neutral phrase: the substitutions above are the ones that keep coming up.",
  ].join("\n"),
);
process.exit(1);
