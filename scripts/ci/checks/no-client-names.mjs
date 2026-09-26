// louise-toolkit names no client site. Not in code, comments, tests, or docs.
//
// The toolkit is public, and the sites its patterns came from are clients'
// businesses. A client agreeing to be featured on a showcase page isn't a client
// agreeing to be cited as the reason for a design, the owner of a bug, or a
// sample value in a type's JSDoc, which ships in the `.d.ts` to every installer.
// Links to their private repositories were worse still: a reader can't open them,
// so they carried a name and no reason. #576 took 94 mentions out; this keeps
// them out.
//
// Say what the site taught, not which site taught it: "a site whose sign-out
// lived in Settings," not the site. Sample values follow Google's example
// conventions: "Example Organization," `example.com`.
//
// Deliberately a text scan over every tracked file, like `lint:core`, because a
// name leaks back in through prose and fixtures, which have no AST worth
// matching. The exceptions are the places that name the sites on purpose:
//
//   - every CHANGELOG.md, which is release history that already shipped to npm
//   - the two pages that feature the sites, with their consent, by name and link
//
// Changesets are scanned, since each becomes a CHANGELOG entry that can't be
// edited once it's published. The short forms two of the sites go by aren't in
// the list: they collide with GF(256) in the QR encoder and hex bytes in the
// image-dimension parser, and a check that cries wolf gets deleted.
//
// The list holds SHA-256 hashes of the names, not the names, because a deny-list
// that spells them would be the one file in the repository that names the
// clients. Each line is split into words (on anything that isn't a letter or a
// digit, and at a lowercase-to-uppercase step, so `SiteNameTheme` is three
// words), and each word, and each pair of adjacent words run together, is
// hashed and looked up. A name written as two words or in camelCase matches;
// one buried inside a longer word doesn't. To add a name, hash its lowercase
// one-word form:
//
//   node -e "console.log(require('crypto').createHash('sha256').update('name').digest('hex'))"
//
//   node scripts/ci/checks/no-client-names.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** SHA-256 of each client site name's lowercase one-word form (see above). */
const NAME_HASHES = new Set([
  "b49c20fb70ea73ddcf100ae0aaceca6425a41128e98107ed96a35a1249e8500f",
  "d689396d300b6d2d1d2fe3aa2742841da0216960e4c34c13604a1e2226db2c1e",
  "59f6892352a45dc19ee93d47025acfad2970014c09c0e51b48782c8ccff2b7a9",
  "5a63ea974ff89d5cceef0ce9b1763fdaf456a8cf97437963d4eed13a786aed78",
  "16a8a610d4f6d8fe068c6278c620929f868dd2589ab2f35c1b041f07242e834a",
]);

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** True when a word, or two adjacent words run together, hashes to a name. */
function namesAClient(line) {
  const words = line
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some(
    (word, i) =>
      NAME_HASHES.has(sha256(word)) ||
      (i + 1 < words.length && NAME_HASHES.has(sha256(word + words[i + 1]))),
  );
}

/** Files allowed to name the sites, with the reason each one is. */
const ALLOWED = new Map([
  ["workers/site/src/pages/examples/index.astro", "features the sites, with consent"],
  ["workers/docs/src/content/docs/guide/comparison.md", "features the sites, with consent"],
]);
const isAllowed = (file) => ALLOWED.has(file) || path.basename(file) === "CHANGELOG.md";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter((file) => file && !isAllowed(file));

const hits = [];
for (const file of files) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    continue; // Deleted in the working tree but still in the index.
  }
  if (buf.includes(0)) continue; // Binary: fonts, images.
  buf
    .toString("utf8")
    .split("\n")
    .forEach((line, i) => {
      if (namesAClient(line)) hits.push({ file, line: i + 1, text: line.trim() });
    });
}

if (hits.length === 0) {
  console.log(`No client site names in ${files.length} files.`);
  process.exit(0);
}

console.error(`${hits.length} client site name(s):\n`);
for (const { file, line, text } of hits) {
  console.error(`  ${file}:${line}`);
  console.error(`    ${text.slice(0, 120)}`);
}
console.error(
  [
    "",
    "louise-toolkit is public, so it names no client site, in code or in prose.",
    "Keep the reason and drop the name:",
    "",
    '  a site as a source or cause   → "a client site," "a site whose …"',
    "  a private-repo issue link     → the reason the link stood for",
    '  a sample value                → "Example Organization," example.com',
    "",
    "A page that features the sites by name, with their consent, goes in ALLOWED",
    "in scripts/ci/checks/no-client-names.mjs, with its reason.",
  ].join("\n"),
);
process.exit(1);
