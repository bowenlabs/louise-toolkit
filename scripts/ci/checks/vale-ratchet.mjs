// `lint:docs` for this repository: the Louise lint runner (ADR 0013), plus the
// one check only this repository needs, run as a per-file ratchet.
//
// The runner lives in the house package, vale/package/styles/Louise/lint-docs.mjs,
// and every Bowen Labs repository uses it: it collects files from git, lints
// Markdown, code comments, and `.astro` templates, and knows how to handle the
// file types Vale can't parse (`.mjs`, `.astro`). This script imports it from
// source rather than from the synced .vale/ copy, so a change to the runner is
// tested here before it ships in a package release.
//
// What this repository adds is the user-facing strings check (copy-extract.mjs):
// error messages, `json(…)` bodies, JSX text, and readable JSX attributes,
// linted as prose and counted under the source path with a ` (strings)` suffix.
// It needs the TypeScript parser, which is why it isn't part of the runner.
//
// The ratchet: vale/baseline.json records each file's error count, and a file
// that isn't listed has a baseline of zero. A file that gains findings fails; a
// file that loses findings fails until `--update` records it. `--update` only
// lowers counts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectFiles,
  lintFiles,
  ratchet,
} from "../../../vale/package/styles/Louise/lint-docs.mjs";
import { stringsDocument } from "./copy-extract.mjs";

const BASELINE = "vale/baseline.json";
const STRINGS = " (strings)";

// User-facing strings come from the code a site or an editor user runs: the
// two packages and the workers.
const STRING_SOURCES =
  /^(packages\/louise\/src|packages\/louise-astro\/src|workers\/[^/]+\/src)\/.*\.tsx?$/;

/**
 * Lints each source file's user-facing strings as a Markdown document and maps
 * every finding back to its source file and line.
 */
function lintStrings(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vale-strings-")));
  const docs = new Map();
  try {
    for (const file of files) {
      if (!STRING_SOURCES.test(file)) continue;
      const doc = stringsDocument(file, fs.readFileSync(file, "utf8"));
      if (doc.count === 0) continue;
      const docPath = path.join(dir, `${file.replaceAll("/", "__")}.md`);
      fs.writeFileSync(docPath, doc.markdown);
      docs.set(docPath, { file, sourceLine: doc.sourceLine });
    }
    const byFile = {};
    for (const [key, list] of Object.entries(lintFiles([...docs.keys()]))) {
      const doc = docs.get(path.resolve(key));
      if (!doc) continue;
      byFile[doc.file + STRINGS] = list.map((a) => ({
        ...a,
        Line: doc.sourceLine[a.Line - 1] ?? a.Line,
      }));
    }
    return byFile;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const files = collectFiles();
const alerts = { ...lintFiles(files), ...lintStrings(files) };
process.exit(ratchet(alerts, BASELINE, { update: process.argv.includes("--update") }));
