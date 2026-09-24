// Vale, as a ratchet. Every doc and all the prose in code follows the Google
// developer documentation style guide (ADR 0013), but the code comments start
// far from it: about 1,900 error-level findings when the policy was adopted.
// Turning that on as a hard gate would block every PR until the whole rewrite
// landed, and leaving it off would let the count grow while the rewrite is in
// progress.
//
// So the gate is per file. vale/baseline.json records how many error-level
// findings each file had; a file that isn't listed has a baseline of zero. The
// check fails when:
//
//   - a file has MORE findings than its baseline. New findings are a
//     regression, and the output lists them so they are easy to fix.
//   - a file has FEWER findings than its baseline. That's progress, and the
//     baseline has to record it, or the next edit could spend the headroom on a
//     new finding. `--update` lowers the baseline to match.
//
// `--update` only ever lowers counts. It refuses to record a regression, so the
// baseline can't be used to bless new findings. Once every file reaches zero,
// the baseline file is empty and this is a plain Vale gate.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringsDocument } from "./copy-extract.mjs";

const VALE = ["--package=@vvago/vale@3.17.1", "dlx", "vale"];
const BASELINE = "vale/baseline.json";

// Legal text is reproduced verbatim, not written by us.
const EXCLUDE = new Set(["packages/louise/THIRD_PARTY_NOTICES.md"]);

const PROSE = /\.(md|mdx)$/;
const CODE = /\.(ts|tsx|js|mjs)$/;

// User-facing strings (ADR 0013 §5) come from the code a site or an editor
// user runs: the two packages and the workers. Their findings are counted
// under the source file with this suffix, so a file has one baseline entry for
// its comments and another for its strings.
const STRING_SOURCES =
  /^(packages\/louise\/src|packages\/louise-astro\/src|workers\/[^/]+\/src)\/.*\.tsx?$/;
const STRINGS = " (strings)";

/** Area names group the report; the gate itself is per file. */
function areaOf(file) {
  if (file.endsWith(STRINGS)) return "User-facing strings";
  if (PROSE.test(file)) {
    if (file.startsWith("workers/docs/src/content/docs/")) return "Starlight docs";
    if (file.startsWith("docs/adr/")) return "ADRs";
    if (file.endsWith("CHANGELOG.md")) return "Changelogs";
    return "Other Markdown";
  }
  if (file.startsWith("packages/louise/src/")) return "Comments: louise-toolkit";
  if (file.startsWith("packages/louise-astro/src/")) return "Comments: @louise-toolkit/astro";
  if (file.startsWith("workers/")) return "Comments: workers";
  return "Comments: tests and tooling";
}

function lintedFiles() {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((f) => f && (PROSE.test(f) || CODE.test(f)) && !EXCLUDE.has(f))
    .filter((f) => fs.existsSync(f))
    .filter((f) => !f.startsWith(".vale/"));
}

function runVale(files) {
  const out = execFileSync(
    "corepack",
    ["pnpm", ...VALE, "--output=JSON", "--no-exit", "--minAlertLevel=error", ...files],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  // Vale prints nothing at all when no file has an alert.
  const byFile = out.trim() ? JSON.parse(out) : {};
  return byFile;
}

/**
 * Lints each source file's user-facing strings as a Markdown document (see
 * copy-extract.mjs) and maps every finding back to its source line. Keys are
 * the source path plus STRINGS.
 */
function runValeOnStrings(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vale-strings-")));
  const docs = new Map();
  try {
    for (const file of files) {
      if (!STRING_SOURCES.test(file) || file.endsWith(".d.ts")) continue;
      const doc = stringsDocument(file, fs.readFileSync(file, "utf8"));
      if (doc.count === 0) continue;
      const docPath = path.join(dir, `${file.replaceAll("/", "__")}.md`);
      fs.writeFileSync(docPath, doc.markdown);
      docs.set(docPath, { file, sourceLine: doc.sourceLine });
    }
    const raw = docs.size > 0 ? runVale([...docs.keys()]) : {};
    const byFile = {};
    for (const [docPath, list] of Object.entries(raw)) {
      const doc = docs.get(docPath) ?? docs.get(fs.realpathSync(docPath));
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

const update = process.argv.includes("--update");
// With no baseline file yet, `--update` seeds one from the current counts. That
// is the only time it records findings rather than lowering them.
const seeding = update && !fs.existsSync(BASELINE);
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {};

const files = lintedFiles();
const alerts = { ...runVale(files), ...runValeOnStrings(files) };
const counts = Object.fromEntries(
  Object.entries(alerts).map(([file, list]) => [file, list.length]),
);

const regressions = [];
const improvements = [];
for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  const now = counts[file] ?? 0;
  const was = baseline[file] ?? 0;
  if (now > was) regressions.push({ file, was, now });
  else if (now < was) improvements.push({ file, was, now });
}

// The report, grouped by area.
const areas = {};
const stringKeys = new Set(
  [...Object.keys(counts), ...Object.keys(baseline)].filter((k) => k.endsWith(STRINGS)),
);
for (const file of [...files, ...stringKeys]) {
  const area = areaOf(file);
  areas[area] ??= { files: 0, baseline: 0, now: 0 };
  areas[area].files++;
  areas[area].baseline += baseline[file] ?? 0;
  areas[area].now += counts[file] ?? 0;
}
console.table(areas);

if (regressions.length > 0 && !seeding) {
  console.error(`\n${regressions.length} file(s) gained Vale errors:\n`);
  for (const { file, was, now } of regressions) {
    console.error(`${file}: ${was} → ${now}`);
    for (const a of alerts[file] ?? []) {
      console.error(`  ${a.Line}:${a.Span[0]}  ${a.Check}  ${a.Message}`);
    }
  }
  console.error("\nFix the new findings. The baseline only goes down; see ADR 0013.");
  process.exit(1);
}

if (update) {
  const next = {};
  for (const file of Object.keys(counts).sort()) {
    if (counts[file] > 0) next[file] = counts[file];
  }
  fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  console.log(`\nBaseline updated: ${total} error(s) across ${Object.keys(next).length} file(s).`);
  process.exit(0);
}

if (improvements.length > 0) {
  console.error(`\n${improvements.length} file(s) now have fewer Vale errors than the baseline:\n`);
  for (const { file, was, now } of improvements) console.error(`${file}: ${was} → ${now}`);
  console.error(
    "\nRecord the progress so it can't be spent on new findings:\n  corepack pnpm run lint:docs -- --update",
  );
  process.exit(1);
}

console.log("\nVale: no file has more errors than its baseline.");
