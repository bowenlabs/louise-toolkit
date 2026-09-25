// `lint:docs` for this repository: the Louise lint runner (ADR 0013), run as a
// per-file ratchet.
//
// The runner lives in the house package, vale/package/styles/Louise/lint-docs.mjs,
// and every Bowen Labs repository uses it: it collects files from git, lints
// Markdown, code comments, and `.astro` templates, knows how to handle the file
// types Vale can't parse (`.mjs`, `.astro`), and lints user-facing strings in
// the TypeScript files it's pointed at. This script imports it from source
// rather than from the synced .vale/ copy, so a change to the runner is tested
// here before it ships in a package release.
//
// User-facing strings (error messages, `json(…)` bodies, JSX text, and readable
// JSX attributes) come from the code a site or an editor user runs: the two
// packages and the workers. Their findings count under the source path with a
// ` (strings)` suffix.
//
// The ratchet: vale/baseline.json records each file's error count, and a file
// that isn't listed has a baseline of zero. A file that gains findings fails; a
// file that loses findings fails until `--update` records it. `--update` only
// lowers counts.
import {
  collectFiles,
  lintFiles,
  lintStrings,
  ratchet,
} from "../../../vale/package/styles/Louise/lint-docs.mjs";

const BASELINE = "vale/baseline.json";

const STRING_SOURCES = [
  /^(packages\/louise\/src|packages\/louise-astro\/src|workers\/[^/]+\/src)\/.*\.tsx?$/,
];

const files = collectFiles();
const alerts = { ...lintFiles(files), ...(await lintStrings(files, STRING_SOURCES)) };
process.exit(ratchet(alerts, BASELINE, { update: process.argv.includes("--update") }));
