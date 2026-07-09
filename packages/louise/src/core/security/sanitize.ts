// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.

// Parser-based allowlist sanitizer for editor-authored rich text. Parses the
// HTML with ultrahtml and rebuilds it against a strict allowlist:
//
//   1. Element allowlist — any tag not in ALLOWED_TAGS is dropped with its
//      children (ultrahtml's `sanitize`), so script/style/iframe/svg/etc. and
//      their contents never survive.
//   2. Strict per-tag attribute allowlist — ultrahtml keeps unknown attributes
//      by default (it only drops what's in `dropAttributes`), so we run our own
//      pass that deletes every attribute not explicitly allowed for its tag.
//      This is what removes `on*` handlers, arbitrary `style`, etc.
//   3. URL-scheme + style-value scrubbing — `href`/`src` must be http(s),
//      mailto, or same-document/relative; inline `style` is limited to a plain
//      `color:` declaration (the only style the ProseKit text-color mark emits).
//   4. A final regex net strips any stray dangerous-tag token left by the
//      parser's serialization of malformed input (e.g. `<scr<script>ipt>`).
//
// The allowlist matches exactly the formatting Louise's ProseKit client emits
// (see `../cms/richtext`): block + inline formatting, resizable images
// (`<img width height>`), the text-color mark (`<span style="color:…"
// data-text-color="…">`), and the page-builder block containers. Keep this in
// sync with the client — that coupling is why the sanitizer lives in the
// package alongside the richtext it guards.

import { ELEMENT_NODE, transformSync, walkSync } from "ultrahtml";
import sanitizeElements from "ultrahtml/transformers/sanitize";

/** ultrahtml doesn't export its node type; this is the shape we touch. */
type UhNode = { type: number; name?: string; attributes?: Record<string, string> };

/** Tags ProseKit's basic + blockquote + image + text-color extensions emit.
 * `div` is the editor's serialization wrapper: prosekit's `htmlFromNode`
 * returns the doc container's outerHTML, so every rich payload arrives as
 * `<div>…</div>`. ultrahtml's sanitize drops disallowed elements WITH their
 * children, so omitting `div` empties the entire payload. Divs carry no
 * attributes here (stripped below), so they're inert. */
export const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "span",
  "a",
  "img",
  "code",
  "pre",
  "div",
  // Page-builder block containers — serialized by the blocks framework as
  // `<tag data-block="…" class="pb-…">`.
  "section",
  "figure",
  "figcaption",
  "hr",
];

/** Attributes allowed per tag. Everything else is dropped. */
export const ATTR_ALLOW: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height"]),
  span: new Set(["style", "data-text-color"]),
  // Block containers: identity + variant data-attrs + a class further
  // filtered to `pb-` tokens below.
  section: new Set(["class", "data-block", "data-cols"]),
  figure: new Set(["class", "data-block"]),
  figcaption: new Set(["class"]),
  hr: new Set(["class", "data-block", "data-size"]),
  // Grid rows/columns: identity + the row's adjustable track list (a validated
  // `grid-template-columns` — see the style scrub below).
  div: new Set(["class", "data-block", "style"]),
  blockquote: new Set(["class", "data-block"]),
};
const NO_ATTRS: Set<string> = new Set();

/** Tags whose `class` survives — and only `pb-*` tokens, so editor HTML can
 * never borrow arbitrary site classes (e.g. class="btn-solid"). */
const PB_CLASS_TAGS = new Set(["section", "figure", "figcaption", "hr", "div", "blockquote"]);
const PB_TOKEN = /^pb(?:-[a-z0-9-]+)?$/;

/** http(s), mailto, hash, or root-/dot-relative — never javascript:/data:/etc. */
const SAFE_URL = /^(?:https?:|mailto:|\/|#|\.)/i;

/** Allowed inline `style` declarations — each a single, value-validated
 *  property. Two are permitted:
 *   • `color:` — the ProseKit text-color mark (hex / rgb(a) / hsl / named).
 *   • `grid-template-columns:` — an adjustable grid row's track list: a
 *     space-separated run of up to 12 numeric tracks (`%`, `fr`, `px`, or
 *     `auto`). No functions, urls, `calc`, or `;`-chaining, so there is no
 *     injection surface — it's a numeric layout value, same spirit as color. */
const SAFE_COLOR_STYLE =
  /^\s*color:\s*(?:#[0-9a-f]{3,8}|rgba?\([\d,.\s%]+\)|hsl\([\d,.\s%]+\)|[a-z]+)\s*;?\s*$/i;
const SAFE_GRID_STYLE =
  /^\s*grid-template-columns:\s*(?:\d+(?:\.\d+)?(?:%|fr|px)|auto)(?:\s+(?:\d+(?:\.\d+)?(?:%|fr|px)|auto)){0,11}\s*;?\s*$/i;
function isSafeStyle(value: string): boolean {
  return SAFE_COLOR_STYLE.test(value) || SAFE_GRID_STYLE.test(value);
}

/** Stray dangerous tokens a malformed-input round-trip can serialize. */
const DANGEROUS_TOKENS =
  /<\/?(?:script|style|iframe|object|embed|form|meta|link|base|svg|math)\b[^>]*>/gi;

/** Strict attribute + URL/style scrub, applied after element allowlisting. */
function strictAttributes() {
  return (doc: UhNode) => {
    walkSync(doc as never, (node: unknown) => {
      const el = node as UhNode;
      if (el.type !== ELEMENT_NODE || !el.name || !el.attributes) return;
      const allowed = ATTR_ALLOW[el.name] ?? NO_ATTRS;
      for (const name of Object.keys(el.attributes)) {
        const value = String(el.attributes[name] ?? "");
        if (!allowed.has(name)) {
          delete el.attributes[name];
          continue;
        }
        if ((name === "href" || name === "src") && !SAFE_URL.test(value.trim())) {
          delete el.attributes[name];
        }
        if (name === "style" && !isSafeStyle(value)) {
          delete el.attributes[name];
        }
        if (name === "class") {
          if (!PB_CLASS_TAGS.has(el.name)) {
            delete el.attributes[name];
            continue;
          }
          const kept = value.split(/\s+/).filter((t) => PB_TOKEN.test(t));
          if (kept.length === 0) delete el.attributes[name];
          else el.attributes[name] = kept.join(" ");
        }
      }
    });
    return doc;
  };
}

/**
 * Sanitize editor-authored HTML down to a safe formatting subset. Synchronous
 * (ultrahtml's *Sync variants) so callers don't need to await.
 */
export function sanitizeRichHtml(html: string): string {
  const transformers = [
    sanitizeElements({ allowElements: ALLOWED_TAGS, allowComments: false }),
    strictAttributes(),
  ] as Parameters<typeof transformSync>[1];
  return transformSync(html, transformers).replace(DANGEROUS_TOKENS, "");
}
