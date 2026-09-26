// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

// Parser-based allowlist sanitizer for editor-authored rich text. Parses the
// HTML with ultrahtml and rebuilds it against a strict allowlist:
//
//   1. Element allowlist: any tag not in ALLOWED_TAGS is dropped with its
//      children (ultrahtml's `sanitize`), so script/style/iframe/svg/etc. and
//      their contents never survive.
//   2. Strict per-tag attribute allowlist: ultrahtml keeps unknown attributes
//      by default (it only drops what's in `dropAttributes`), so we run our own
//      pass that deletes every attribute not explicitly allowed for its tag.
//      This is what removes `on*` handlers, arbitrary `style`, etc.
//   3. URL-scheme + style-value scrubbing: `href`/`src` must be HTTP or HTTPS,
//      mailto, or same-document/relative; inline `style` is limited to a plain
//      `color:` declaration (the only style the ProseKit text-color mark emits).
//   4. A final regex net strips any stray dangerous-tag token left by the
//      parser's serialization of malformed input (for example, `<scr<script>ipt>`).
//
// The allowlist matches exactly the formatting Louise's ProseKit client emits
// (see `../content/richtext`): block + inline formatting, resizable images
// (`<img width height>`), the text-color mark (`<span style="color:…"
// data-text-color="…">`), and the builder block containers. Keep this in
// sync with the client; that coupling is why the sanitizer lives in the
// package alongside the richtext it guards.
//
// A second, narrower preset, `sanitizeModelHtml`, holds model-generated HTML to
// a subset of this allowlist. See "The model preset" below.

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
  // Builder block containers—serialized by the blocks framework as
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
  // `grid-template-columns`—see the style scrub below).
  div: new Set(["class", "data-block", "style"]),
  blockquote: new Set(["class", "data-block"]),
};
const NO_ATTRS: Set<string> = new Set();

/** Tags whose `class` survives—and only `pb-*` tokens, so editor HTML can
 * never borrow arbitrary site classes (for example, class="btn-solid"). */
const PB_CLASS_TAGS = new Set(["section", "figure", "figcaption", "hr", "div", "blockquote"]);
const PB_TOKEN = /^pb(?:-[a-z0-9-]+)?$/;

/** HTTP or HTTPS, mailto, hash, or root-/dot-relative—never javascript:/data:/etc. */
const SAFE_URL = /^(?:https?:|mailto:|\/|#|\.)/i;

/** Allowed inline `style` declarations—each a single, value-validated
 *  property. Two are permitted:
 *   • `color:`—the ProseKit text-color mark. A literal (hex / rgb(a) / hsl /
 *     named) OR a brand token: `var(--color-<token>)`, the daisyUI theme custom
 *     property the site defines (#182 Phase 5). The token stays theme-aware—a
 *     re-theme flows through with no content rewrite—and `var(--color-…)` can
 *     only reference a CSS custom property, so it carries no injection surface.
 *   • `grid-template-columns:`—an adjustable grid row's track list: a
 *     space-separated run of up to 12 numeric tracks (`%`, `fr`, `px`, or
 *     `auto`). No functions, urls, `calc`, or `;`-chaining, so there is no
 *     injection surface—it's a numeric layout value, same spirit as color. */
const SAFE_COLOR_STYLE =
  /^\s*color:\s*(?:#[0-9a-f]{3,8}|rgba?\([\d,.\s%]+\)|hsl\([\d,.\s%]+\)|var\(\s*--color-[a-z-]+\s*\)|[a-z]+)\s*;?\s*$/i;
const SAFE_GRID_STYLE =
  /^\s*grid-template-columns:\s*(?:\d+(?:\.\d+)?(?:%|fr|px)|auto)(?:\s+(?:\d+(?:\.\d+)?(?:%|fr|px)|auto)){0,11}\s*;?\s*$/i;
function isSafeStyle(value: string): boolean {
  return SAFE_COLOR_STYLE.test(value) || SAFE_GRID_STYLE.test(value);
}

/** Stray dangerous tokens a malformed-input round-trip can serialize. */
const DANGEROUS_TOKENS =
  /<\/?(?:script|style|iframe|object|embed|form|meta|link|base|svg|math)\b[^>]*>/gi;

/** An `<img>` with no `src=` attribute—what a non-media `src` becomes after
 *  the strict scrub deletes it, so we drop the now-empty element entirely. */
const SRCLESS_IMG = /<img\b(?![^>]*\bsrc=)[^>]*>/gi;

/** Whether `src` is served from `base` (the site's `MEDIA_URL`)—mirrors
 *  `isMediaUrl` in louise-toolkit/media, inlined so this base-security module stays
 *  dependency-free. */
function isFromMediaBase(base: string, src: string): boolean {
  const b = base.replace(/\/$/, "");
  return b.length > 0 && src.startsWith(`${b}/`);
}

/** Options for {@link sanitizeRichHtml}. */
export interface SanitizeOptions {
  /**
   * When set, an `<img>` whose `src` is not served from this base (the site's
   * `MEDIA_URL`) is dropped—enforcing that editor images live in the media
   * library, never hotlinked from an external origin (pasted HTML, etc.). Omit
   * to keep any safe HTTP, HTTPS, or relative `src` (the default, back-compatible
   * behavior).
   */
  mediaBase?: string;
}

/** Strict attribute + URL/style scrub, applied after element allowlisting.
 *  With `mediaBase`, an `<img src>` that isn't media-hosted has its `src`
 *  stripped (the element is then removed by {@link SRCLESS_IMG}). */
function strictAttributes(mediaBase?: string) {
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
        // Media-strictness: an image src that isn't from the media base is a
        // hotlink—drop it (the src-less img is then removed on serialize).
        if (
          name === "src" &&
          el.name === "img" &&
          mediaBase &&
          !isFromMediaBase(mediaBase, value.trim())
        ) {
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
 * (ultrahtml's *Sync variants) so callers don't need to await. Pass
 * `{ mediaBase }` to additionally drop `<img>` that isn't hosted in the media
 * library (see {@link SanitizeOptions.mediaBase}).
 */
export function sanitizeRichHtml(html: string, options: SanitizeOptions = {}): string {
  const transformers = [
    sanitizeElements({ allowElements: ALLOWED_TAGS, allowComments: false }),
    strictAttributes(options.mediaBase),
  ] as Parameters<typeof transformSync>[1];
  const out = transformSync(html, transformers).replace(DANGEROUS_TOKENS, "");
  // With media-strictness on, a non-media image had its src stripped above;
  // remove the resulting src-less <img> so nothing broken persists.
  return options.mediaBase ? out.replace(SRCLESS_IMG, "") : out;
}

// ── The model preset (#465) ──────────────────────────────────────────────────
//
// Model output is less trustworthy than an editor's: a prompt injection in the
// content a model was given can steer what it writes. So model-written HTML is
// held to a NARROWER allowlist than a human's—text structure only. No images
// (a tracking pixel or a hotlink), no embeds, no `style` or `class` (content
// that borrows site styling to pass as something it isn't), and links only to
// HTTP, HTTPS, or `mailto`, with `rel` forced.
//
// The model sets are a subset of the human ones, never a sibling list: a test
// asserts every model-allowed tag and attribute is also human-allowed, so the
// two can't drift apart in the wrong direction.

/** Tags {@link sanitizeModelHtml} keeps: block and inline text structure only.
 *  Every entry is also in {@link ALLOWED_TAGS}. */
export const MODEL_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
];

/** Attributes {@link sanitizeModelHtml} keeps, per tag. Every entry is also in
 *  {@link ATTR_ALLOW}. `rel` isn't here: the sanitizer writes it rather than
 *  accepting it, so a model can't choose its own. */
export const MODEL_ATTR_ALLOW: Record<string, Set<string>> = {
  a: new Set(["href"]),
};

/** The `rel` every link in model output carries, whatever the input said. */
export const MODEL_LINK_REL = "noopener noreferrer nofollow";

/** Tags the human preset allows and the model preset doesn't. These are
 *  unwrapped—the element goes, its text stays—so a model that wraps a
 *  paragraph in a `<div>` or a `<span>` loses the wrapper, not the words.
 *  Anything the human preset rejects is dropped with its contents, same as
 *  there. */
const MODEL_UNWRAP_TAGS = ALLOWED_TAGS.filter((t) => !MODEL_ALLOWED_TAGS.includes(t));

/** Absolute HTTP, HTTPS, or `mailto` only. No relative path, hash, or other scheme. */
const MODEL_SAFE_URL = /^(?:https?:|mailto:)/i;

/** The part of a parent node the link unwrap touches. */
type UhParent = { children: unknown[] };

/** Strict attribute scrub for the model preset. An `<a>` whose `href` doesn't
 *  survive is unwrapped, keeping its text; one whose `href` does survive gets
 *  {@link MODEL_LINK_REL}. */
function modelAttributes() {
  return (doc: UhNode) => {
    const deadLinks: { node: UhNode; parent: UhParent }[] = [];
    walkSync(doc as never, (node: unknown, parent: unknown) => {
      const el = node as UhNode;
      if (el.type !== ELEMENT_NODE || !el.name || !el.attributes) return;
      const allowed = MODEL_ATTR_ALLOW[el.name] ?? NO_ATTRS;
      for (const name of Object.keys(el.attributes)) {
        const value = String(el.attributes[name] ?? "").trim();
        if (!allowed.has(name) || (name === "href" && !MODEL_SAFE_URL.test(value))) {
          delete el.attributes[name];
        }
      }
      if (el.name !== "a") return;
      if (el.attributes.href) el.attributes.rel = MODEL_LINK_REL;
      else if (parent) deadLinks.push({ node: el, parent: parent as UhParent });
    });
    // Innermost first: the walk is depth-first, so the reverse order unwraps a
    // nested dead link before its ancestor.
    for (let i = deadLinks.length - 1; i >= 0; i--) {
      const { node, parent } = deadLinks[i]!;
      parent.children = parent.children.flatMap((c) =>
        c === node ? ((node as unknown as UhParent).children ?? []) : [c],
      );
    }
    return doc;
  };
}

/**
 * Sanitize model-generated HTML down to text structure: paragraphs, line
 * breaks, headings, lists, block quotes, bold, italic, code, and links. Run it
 * on any HTML a model wrote before you store it, in place of
 * {@link sanitizeRichHtml}, which is tuned for what a person types in the
 * editor.
 *
 * - A tag outside {@link MODEL_ALLOWED_TAGS} that the human preset allows
 *   (`div`, `span`, `u`, and the like) is unwrapped, keeping its text. A tag
 *   neither preset allows, including `img`, `iframe`, `script`, and `style`, is
 *   dropped with its contents.
 * - Every attribute is dropped except `href` on `<a>`, so no `style`, `class`,
 *   `on*` handler, or `data-*` attribute survives.
 * - An `href` must be absolute HTTP, HTTPS, or `mailto`. A link without one is
 *   unwrapped to its text, and a link with one gets
 *   `rel="noopener noreferrer nofollow"` ({@link MODEL_LINK_REL}).
 *
 * Synchronous, like {@link sanitizeRichHtml}, and a plain `(html) => string`, so
 * you can pass it anywhere a route takes a `sanitize` function.
 */
export function sanitizeModelHtml(html: string): string {
  const transformers = [
    sanitizeElements({
      allowElements: MODEL_ALLOWED_TAGS,
      blockElements: MODEL_UNWRAP_TAGS,
      allowComments: false,
    }),
    modelAttributes(),
  ] as Parameters<typeof transformSync>[1];
  return transformSync(html, transformers).replace(DANGEROUS_TOKENS, "");
}
