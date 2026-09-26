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
//   - A string inside a JSX expression, such as either branch of
//     `{saving() ? "Saving…" : "Save"}`: it renders as text all the same.
//   - The first argument to `setError(…)`, `setMessage(…)`, and `confirm(…)`,
//     and the value of a `.textContent = …` assignment: the status lines, error
//     banners, and confirmation prompts a panel shows.
//
// Wherever a value is read, each string branch of a conditional (`a ? "x" :
// "y"`) and the string side of `&&`, `||`, or `??` counts, so a message that
// depends on state is still checked.
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
// Calls whose first argument a person reads: a panel's error and status setters,
// and the browser's confirmation prompt.
const READ_CALLS = new Set(["setError", "setMessage", "confirm"]);

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
 * Every string a value can turn out to be: the value itself when it's
 * string-ish, else the string branches of a conditional or a logical
 * expression. Anything else, such as a variable or a call, has none.
 */
function textsOf(node, sf) {
  const text = textOf(node, sf);
  if (text !== null) return [{ node, text }];
  if (ts.isParenthesizedExpression(node)) return textsOf(node.expression, sf);
  if (ts.isConditionalExpression(node)) {
    return [...textsOf(node.whenTrue, sf), ...textsOf(node.whenFalse, sf)];
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    // `cond && "text"` renders its right side; `a || "text"` and `a ?? "text"`
    // can render either.
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return textsOf(node.right, sf);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [...textsOf(node.left, sf), ...textsOf(node.right, sf)];
    }
  }
  return [];
}

/** The called name of `name(…)`, `obj.name(…)`, or `window.name(…)`. */
function calleeName(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
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
  const addAll = (node) => {
    for (const t of textsOf(node, sf)) add(t.node, t.text);
  };

  const visit = (node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (ERROR_CLASS.test(node.expression.text) && node.arguments?.length) {
        addAll(node.arguments[0]);
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
          addAll(prop.initializer);
        }
      }
    } else if (ts.isCallExpression(node) && READ_CALLS.has(calleeName(node)) && node.arguments[0]) {
      addAll(node.arguments[0]);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "textContent"
    ) {
      addAll(node.right);
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      // A child `{expression}`, not an attribute's value: its strings render as
      // text. Like JSX text, a string that runs into a sibling keeps a code
      // span in its place, so a string that ends in a spaced dash still shows
      // the space after it. Keep walking, since a branch can hold JSX with
      // text of its own.
      const siblings = node.parent.children;
      const at = siblings.indexOf(node);
      for (const t of textsOf(node.expression, sf)) {
        let text = t.text;
        if (/^\s/.test(text) && at > 0) text = `\`value\`${text}`;
        if (/\s$/.test(text) && at < siblings.length - 1) text = `${text}\`value\``;
        add(t.node, text);
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
        if (ts.isStringLiteral(init)) add(init, init.text);
        else if (ts.isJsxExpression(init) && init.expression) addAll(init.expression);
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
