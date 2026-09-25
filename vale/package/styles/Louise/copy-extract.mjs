// User-facing strings, extracted so Vale can lint them as prose (ADR 0013 §5).
//
// Vale lints comments in code, never string literals, and most of the prose a
// person actually reads lives in strings: an error message a route returns, a
// button label, an empty state. This module finds those strings with the
// TypeScript parser and renders each file's strings as a Markdown document,
// one paragraph per string, with a map back to the source line. The lint
// runner (lint-docs.mjs) lints the documents when it's given `--strings`, and
// reports each finding against its source file and line.
//
// What counts as user-facing, and why each is in:
//
//   - The first argument to `new Louise…Error(…)` or `new Astroid…Error(…)`.
//     ADR 0012 makes these safe to show, and routes do show them.
//   - `error` and `message` values in an object passed to `json(…)`: the body
//     a route returns.
//   - JSX text, and the JSX attributes a person reads or a screen reader
//     announces: `title`, `aria-label`, `placeholder`, `alt`, `label`.
//
// Deliberately out: log lines, test names, and CI-script messages. A person
// maintaining the code reads those, and they follow the style in comments, not
// here. A template literal's `${…}` becomes a code span, so an interpolated
// value is never linted as prose. The span holds ASCII (`value`), because Vale
// miscounts a multibyte character at the start of a line and reports the next
// finding twice.
//
// It needs the TypeScript parser, and a style package can't ship one. So it
// loads `typescript` from the repository being linted, resolving from each
// source file's own folder, since a site installs it in its app package rather
// than at the root.
import { createRequire } from "node:module";
import path from "node:path";

let ts;

/** Loads `typescript` as installed for `fileName`, once. */
function loadTypeScript(fileName) {
  if (ts) return ts;
  const bases = [path.resolve(fileName), path.join(process.cwd(), "package.json")];
  for (const base of bases) {
    try {
      ts = createRequire(base)("typescript");
      return ts;
    } catch {
      // Try the next base.
    }
  }
  throw new Error(
    "The strings check needs the `typescript` package, and none resolves from " +
      `${fileName} or the repository root. Install it, or drop \`--strings\`.`,
  );
}

const ERROR_CLASS = /^(Louise|Astroid)\w*Error$/;
const BODY_KEYS = new Set(["error", "message"]);
const READ_ATTRS = new Set(["title", "aria-label", "placeholder", "alt", "label"]);

/** A string-ish expression as prose, or null when it isn't one. */
function textOf(node, sf) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) out += `\`value\`${span.literal.text}`;
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = textOf(node.left, sf);
    const right = textOf(node.right, sf);
    if (left === null && right === null) return null;
    return `${left ?? "`value`"}${right ?? "`value`"}`;
  }
  if (ts.isParenthesizedExpression(node)) return textOf(node.expression, sf);
  return null;
}

/**
 * Every user-facing string in a source file, with the 1-based line it starts
 * on. Returns an empty list for files with none.
 */
export function extractStrings(fileName, text) {
  loadTypeScript(fileName);
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const add = (node, value) => {
    const prose = value?.replace(/\s+/g, " ").trim();
    // A string with no letters (a separator, an icon glyph) isn't prose.
    if (!prose || !/[A-Za-z]{2}/.test(prose)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ line: line + 1, text: prose });
  };

  const visit = (node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (ERROR_CLASS.test(node.expression.text) && node.arguments?.length) {
        add(node.arguments[0], textOf(node.arguments[0], sf));
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "json" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const prop of node.arguments[0].properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          BODY_KEYS.has(prop.name.text)
        ) {
          add(prop.initializer, textOf(prop.initializer, sf));
        }
      }
    } else if (ts.isJsxText(node)) {
      // Text that touches an `{expression}` keeps a code span in its place, so
      // a spaced dash right after or before a value still has the space the
      // check needs to see.
      const siblings = node.parent?.children ?? [];
      const at = siblings.indexOf(node);
      let text = node.text;
      if (/^[ \t]/.test(text) && at > 0 && ts.isJsxExpression(siblings[at - 1])) {
        text = `\`value\`${text}`;
      }
      if (/[ \t]$/.test(text) && at < siblings.length - 1 && ts.isJsxExpression(siblings[at + 1])) {
        text = `${text}\`value\``;
      }
      add(node, text);
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (READ_ATTRS.has(name)) {
        const init = node.initializer;
        const value = ts.isStringLiteral(init)
          ? init.text
          : ts.isJsxExpression(init) && init.expression
            ? textOf(init.expression, sf)
            : null;
        add(init, value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * A file's strings as one Markdown document, one paragraph per string, plus
 * the map from each document line back to its source line.
 */
export function stringsDocument(fileName, text) {
  const strings = extractStrings(fileName, text);
  const lines = [];
  const sourceLine = [];
  for (const s of strings) {
    lines.push(s.text, "");
    sourceLine.push(s.line, s.line);
  }
  return { markdown: lines.join("\n"), sourceLine, count: strings.length };
}
