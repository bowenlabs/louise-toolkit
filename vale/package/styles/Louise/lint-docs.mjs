// The Louise lint runner: Vale over every doc and all prose in code, the same
// way in every repository (louise-toolkit ADR 0013). It ships inside the house
// package, so `vale sync` puts it at `.vale/Louise/lint-docs.mjs`, and a
// repository's `lint:docs` script is one line:
//
//   node .vale/Louise/lint-docs.mjs [--exclude=<regex>]... [--strings=<regex>]...
//                                   [--baseline=<file> [--update]]
//
// What it lints, from `git ls-files`: Markdown and MDX; comments in TypeScript
// and JavaScript; and in `.astro` files, both the template's text and the
// frontmatter's comments. Two file types need help, because Vale 3.17 has no
// parser for them:
//
//   - `.mjs` would be linted as plain text, code and strings included. It's
//     linted as JavaScript instead, so only comments count.
//   - `.astro` is split into two copies with the same line numbers: the
//     text a visitor reads, as HTML, and the code (the frontmatter plus any
//     multi-line `{…}` block), as TypeScript, so only its comments count.
//
// Those copies go to a temporary directory, and every finding is reported
// against the real file and line.
//
// One check runs outside Vale. Google.EmDash can't see a spaced dash that bold
// or inline code follows, because the dash ends one text node and the markup
// starts the next. `spacedDashes` reads the
// raw Markdown instead and reports what Vale missed, as `Louise.SpacedDash`.
//
// A second reads every linted file's raw text, code included: `Louise.Emoji`.
// The stack draws its icons from Phosphor and uses no emoji, in an interface or
// in prose. It has to read code, not only what Vale sees, because the emoji
// that reaches a person is usually a string literal: a badge's label, a
// button's text. CHANGELOG.md is exempt, because what it records has already
// shipped. A test that needs an emoji as input writes it as an escape,
// `"\u{1F600}"`.
//
// With `--strings`, it also lints user-facing strings (error messages, `json(…)`
// bodies, JSX text, and readable JSX attributes) in the TypeScript files the
// patterns match, using copy-extract.mjs beside this file. Findings count under
// the source path with a ` (strings)` suffix. That needs the `typescript`
// package, loaded from the repository being linted.
//
// Without `--baseline`, any error-level finding fails the run. With it, the run
// is a per-file ratchet: a file may not gain findings, and a file that loses
// findings fails until `--update` records it. `--update` only lowers counts.
//
// No dependencies beyond Node itself, so it runs in any repository; only
// `--strings` needs TypeScript.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALE_PACKAGE = "@vvago/vale@3.17.1";
const LINTED = /\.(md|mdx|ts|tsx|js|mjs|astro)$/;
const ALWAYS_EXCLUDED = [
  /(^|\/)(node_modules|dist|\.vale|\.claude|\.astro|\.wrangler)\//,
  /\.d\.ts$/,
  /THIRD_PARTY_NOTICES\.md$/,
];

/** The command that runs Vale: corepack when it's installed, pnpm otherwise. */
function valeCommand() {
  if (process.env.VALE_BIN) return [process.env.VALE_BIN];
  try {
    execFileSync("corepack", ["--version"], { stdio: "ignore" });
    return ["corepack", "pnpm", `--package=${VALE_PACKAGE}`, "dlx", "vale"];
  } catch {
    return ["pnpm", `--package=${VALE_PACKAGE}`, "dlx", "vale"];
  }
}

/** Every tracked or new file this runner lints, minus exclusions. */
export function collectFiles({ exclude = [] } = {}) {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const patterns = [...ALWAYS_EXCLUDED, ...exclude];
  return out
    .split("\n")
    .filter((f) => f && LINTED.test(f) && fs.existsSync(f))
    .filter((f) => !patterns.some((p) => p.test(f)));
}

/**
 * Splits an `.astro` file into the text a visitor reads and the code, each
 * with the other part blanked so line numbers match the original. Code is the
 * frontmatter plus any `{…}` expression in the template that spans more than
 * one line: that's a JavaScript block (`items.map(…)`), not text. A one-line
 * `{…}` stays with the text, because it usually renders a string.
 */
function splitAstro(text) {
  const lines = text.split("\n");
  const code = new Array(lines.length).fill(false);
  let start = 0;
  if (lines[0].trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      for (let i = 1; i < end; i++) code[i] = true;
      start = end + 1;
    }
  }
  // Depth-0 `{…}` blocks in the template, skipping braces inside quotes.
  let depth = 0;
  let quote = null;
  let openLine = -1;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (quote) {
        if (ch === quote) quote = null;
      } else if (depth > 0 && (ch === '"' || ch === "'" || ch === "`")) {
        quote = ch;
      } else if (ch === "{") {
        if (depth === 0) openLine = i;
        depth++;
      } else if (ch === "}" && depth > 0) {
        depth--;
        if (depth === 0 && i > openLine) for (let j = openLine; j <= i; j++) code[j] = true;
      }
    }
    quote = null;
  }
  const lineIs = (want) => lines.map((l, i) => (code[i] === want ? l : "")).join("\n");
  return { template: lineIs(false), code: code.some(Boolean) ? lineIs(true) : null };
}

/**
 * Runs Vale over the files and returns `{ [file]: alerts[] }`, keyed by the
 * real paths. `configPath` is the repository's `.vale.ini`.
 */
export function lintFiles(files, { configPath = ".vale.ini", emoji = true } = {}) {
  const vale = valeCommand();
  const args = [`--config=${path.resolve(configPath)}`, "--output=JSON", "--no-exit"];
  args.push("--minAlertLevel=error");
  const run = (paths) => {
    if (paths.length === 0) return {};
    const out = execFileSync(vale[0], [...vale.slice(1), ...args, ...paths], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    // Vale prints nothing at all when no file has an alert.
    return out.trim() ? JSON.parse(out) : {};
  };

  const direct = files.filter((f) => !f.endsWith(".mjs") && !f.endsWith(".astro"));
  const byFile = {};
  for (const [file, alerts] of Object.entries(run(direct))) {
    byFile[path.relative(process.cwd(), path.resolve(file))] = alerts;
  }

  // Copies for the file types Vale can't parse, in a temporary directory.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "louise-lint-")));
  const origin = new Map();
  const stage = (file, text, ext) => {
    const copy = path.join(dir, `${file.replaceAll("/", "__")}${ext}`);
    fs.writeFileSync(copy, text);
    origin.set(copy, file);
    return copy;
  };
  try {
    const copies = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      if (file.endsWith(".mjs")) copies.push(stage(file, text, ".js"));
      if (file.endsWith(".astro")) {
        const { template, code } = splitAstro(text);
        copies.push(stage(file, template, ".html"));
        if (code !== null) copies.push(stage(file, code, ".code.tsx"));
      }
    }
    for (const [copy, alerts] of Object.entries(run(copies))) {
      const file = origin.get(copy) ?? origin.get(fs.realpathSync(copy));
      if (!file) continue;
      byFile[file] = [...(byFile[file] ?? []), ...alerts];
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  addMissedDashes(byFile, files);
  if (emoji) addEmojis(byFile, files);
  return byFile;
}

const SPACED_DASH = /\s[—–]\s/g;

/**
 * Spaced dashes in raw Markdown, outside front matter, fenced code, and inline
 * code. A dash that's a table cell's whole content is an empty cell, not
 * punctuation, so it's allowed. Returns Vale-shaped alerts.
 */
export function spacedDashes(text) {
  const alerts = [];
  const lines = text.split("\n");
  let frontMatter = lines[0] === "---";
  let fence = null;
  // Inline code can wrap onto the next line of a paragraph.
  let openCode = false;
  // Mask with a letter, not spaces, so masked code can't manufacture a space
  // beside a dash that has none (`a`—`b` is correct).
  const blank = (m) => "x".repeat(m.length);
  lines.forEach((line, i) => {
    if (frontMatter) {
      if (i > 0 && line === "---") frontMatter = false;
      return;
    }
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      openCode = false;
      return;
    }
    if (fence !== null) return;
    if (line.trim() === "") {
      openCode = false;
      return;
    }
    let prose = line;
    if (openCode) {
      const close = prose.indexOf("`");
      if (close === -1) return;
      prose = blank(prose.slice(0, close + 1)) + prose.slice(close + 1);
      openCode = false;
    }
    prose = prose.replace(/`[^`]*`/g, blank);
    const open = prose.indexOf("`");
    if (open !== -1) {
      prose = prose.slice(0, open) + blank(prose.slice(open));
      openCode = true;
    }
    prose = prose.replace(/\|\s*[—–]\s*(?=\|)/g, blank);
    for (const hit of prose.matchAll(SPACED_DASH)) {
      alerts.push({
        Check: "Louise.SpacedDash",
        Message: "Don't put a space before or after a dash.",
        Severity: "error",
        Line: i + 1,
        Span: [hit.index + 1, hit.index + 3],
      });
    }
  });
  return alerts;
}

/**
 * Adds the spaced dashes Vale missed. On each line, Vale's Google.EmDash
 * findings account for that many raw hits, and only the rest are added, so a
 * dash is never reported twice.
 */
function addMissedDashes(byFile, files) {
  for (const file of files.filter((f) => /\.mdx?$/.test(f))) {
    // Key by the same relative path lintFiles uses, so a file passed by its
    // absolute path (a strings document) merges with Vale's findings.
    const key = path.relative(process.cwd(), path.resolve(file));
    const found = new Map();
    for (const a of byFile[key] ?? []) {
      if (a.Check === "Google.EmDash") found.set(a.Line, (found.get(a.Line) ?? 0) + 1);
    }
    const perLine = new Map();
    for (const hit of spacedDashes(fs.readFileSync(file, "utf8"))) {
      perLine.set(hit.Line, [...(perLine.get(hit.Line) ?? []), hit]);
    }
    const missed = [];
    for (const [line, hits] of perLine) missed.push(...hits.slice(found.get(line) ?? 0));
    if (missed.length > 0) byFile[key] = [...(byFile[key] ?? []), ...missed];
  }
}

// Emoji presented as emoji by default, a text symbol forced into emoji form
// with U+FE0F, and a keycap. A plain `✓` or `→` is a symbol, not an emoji,
// and isn't matched.
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[#*0-9]\uFE0F?\u20E3/gu;

/** Every emoji in raw text, code included. Returns Vale-shaped alerts. */
export function emojis(text) {
  const alerts = [];
  text.split("\n").forEach((line, i) => {
    for (const hit of line.matchAll(EMOJI)) {
      // Vale counts columns in characters, not UTF-16 units.
      const column = [...line.slice(0, hit.index)].length + 1;
      alerts.push({
        Check: "Louise.Emoji",
        Message: "Don't use emoji. In an interface, use a Phosphor icon; in prose, use words.",
        Severity: "error",
        Line: i + 1,
        Span: [column, column],
      });
    }
  });
  return alerts;
}

/** Adds `Louise.Emoji` findings, skipping CHANGELOG.md, which has shipped. */
function addEmojis(byFile, files) {
  for (const file of files) {
    if (path.basename(file) === "CHANGELOG.md") continue;
    const hits = emojis(fs.readFileSync(file, "utf8"));
    if (hits.length === 0) continue;
    const key = path.relative(process.cwd(), path.resolve(file));
    byFile[key] = [...(byFile[key] ?? []), ...hits];
  }
}

const STRINGS = " (strings)";

/**
 * Lints the user-facing strings in each file that matches one of `sources`, as
 * a Markdown document per file, and maps every finding back to its source file
 * and line. Returns alerts keyed `<file> (strings)`.
 */
export async function lintStrings(files, sources, { configPath = ".vale.ini" } = {}) {
  const targets = files.filter((f) => /\.tsx?$/.test(f) && sources.some((re) => re.test(f)));
  if (targets.length === 0) return {};
  const { stringsDocument } = await import("./copy-extract.mjs");
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "louise-strings-")));
  const docs = new Map();
  try {
    for (const file of targets) {
      const doc = stringsDocument(file, fs.readFileSync(file, "utf8"));
      if (doc.count === 0) continue;
      const docPath = path.join(dir, `${file.replaceAll("/", "__")}.md`);
      fs.writeFileSync(docPath, doc.markdown);
      docs.set(docPath, { file, sourceLine: doc.sourceLine });
    }
    const byFile = {};
    // The emoji check already read these files whole, strings included.
    const found = lintFiles([...docs.keys()], { configPath, emoji: false });
    for (const [key, list] of Object.entries(found)) {
      const doc = docs.get(path.resolve(key));
      if (!doc) continue;
      const mapped = list.map((a) => ({ ...a, Line: doc.sourceLine[a.Line - 1] ?? a.Line }));
      byFile[doc.file + STRINGS] = [...(byFile[doc.file + STRINGS] ?? []), ...mapped];
    }
    return byFile;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function printAlerts(alerts, files) {
  for (const file of files) {
    for (const a of alerts[file] ?? []) {
      console.error(`${file}:${a.Line}:${a.Span[0]}  ${a.Check}  ${a.Message}`);
    }
  }
}

/** The ratchet: compares counts per file against a baseline. */
export function ratchet(alerts, baselinePath, { update = false } = {}) {
  const seeding = update && !fs.existsSync(baselinePath);
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
    : {};
  const counts = Object.fromEntries(Object.entries(alerts).map(([f, l]) => [f, l.length]));
  const regressions = [];
  const improvements = [];
  for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    const now = counts[file] ?? 0;
    const was = baseline[file] ?? 0;
    if (now > was) regressions.push({ file, was, now });
    else if (now < was) improvements.push({ file, was, now });
  }
  if (regressions.length > 0 && !seeding) {
    console.error(`\n${regressions.length} file(s) gained Vale errors:\n`);
    for (const { file, was, now } of regressions) {
      console.error(`${file}: ${was} → ${now}`);
      printAlerts(alerts, [file]);
    }
    console.error("\nFix the new findings. The baseline only goes down.");
    return 1;
  }
  if (update) {
    const next = {};
    for (const file of Object.keys(counts).sort()) if (counts[file] > 0) next[file] = counts[file];
    fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    const total = Object.values(next).reduce((a, b) => a + b, 0);
    console.log(`Baseline updated: ${total} error(s) across ${Object.keys(next).length} file(s).`);
    return 0;
  }
  if (improvements.length > 0) {
    console.error(
      `\n${improvements.length} file(s) now have fewer Vale errors than the baseline:\n`,
    );
    for (const { file, was, now } of improvements) console.error(`${file}: ${was} → ${now}`);
    console.error(
      "\nRecord the progress so it can't be spent on new findings: rerun with --update.",
    );
    return 1;
  }
  console.log("Vale: no file has more errors than its baseline.");
  return 0;
}

async function main(argv) {
  const exclude = argv
    .filter((a) => a.startsWith("--exclude="))
    .map((a) => new RegExp(a.slice(10)));
  const strings = argv
    .filter((a) => a.startsWith("--strings="))
    .map((a) => new RegExp(a.slice(10)));
  const baseline = argv.find((a) => a.startsWith("--baseline="))?.slice(11);
  const update = argv.includes("--update");
  const files = collectFiles({ exclude });
  const alerts = { ...lintFiles(files), ...(await lintStrings(files, strings)) };
  if (baseline) return ratchet(alerts, baseline, { update });
  const total = Object.values(alerts).reduce((n, l) => n + l.length, 0);
  printAlerts(alerts, Object.keys(alerts).sort());
  console.log(`Vale: ${total} error(s) in ${files.length} files.`);
  return total > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(await main(process.argv.slice(2)));
}
