// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/security—rich text → plain text, and "is this field empty?".
//
// Editor HTML leaks into places that print rather than render it. A meta
// description is an ATTRIBUTE: markup in it is shown to every search result and
// link preview verbatim (`content="<div><p>Hi</p></div>"` shipped to production
// on a client site). And an emptied field is still a truthy string—`<h3></h3>`,
// `<p><br></p>`—so a `field && …` guard renders an empty heading that a screen
// reader announces as a nameless "heading, level 3". Every site hand-rolled a
// regex for these; the naive one (`/<[^>]*>/g`) also eats `5 < 6 and 7 > 2`.
//
// Everything here returns TEXT, not HTML. It is not a sanitizer: escape the
// result on output as you would any string (most template languages do this for you).

/** A tag or a comment. Requires a letter right after `<` (or `</`), so a
 *  literal `a < b > c` in prose is left alone. */
const TAG = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;

/** Elements that are content even with no text in them. */
const EMBEDDED = /<(?:img|picture|video|audio|iframe|svg|object|embed)\b/i;

/** Characters an editor leaves behind that print as nothing. The zero-width
 *  joiner (U+200D) is an alternative rather than a class member: inside a class
 *  it can fuse with its neighbours into one grapheme. */
const INVISIBLE = /(?:[\s\u00a0\u200b\u200c\u2060\ufeff]|\u200d)+/g;

const NAMED: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function codePoint(n: number): string {
  // An out-of-range escape (`&#99999999;`) makes `fromCodePoint` throw—which
  // would let one bad stored string take a page down. Drop it instead.
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

/** One level of entity decoding. `&amp;` resolves last, so `&amp;lt;` becomes
 *  `&lt;` on this pass rather than `<`—the fixed-point loop in
 *  {@link plainText} is the only thing allowed to take it further. */
function decodeOnce(input: string): string {
  return input
    .replace(/&(nbsp|lt|gt|quot|apos);/gi, (_, name: string) => NAMED[name.toLowerCase()] ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/gi, "&");
}

export interface PlainTextOptions {
  /**
   * Decode-then-strip rounds before giving up. Stored copy that has been
   * through an editor, a JSON column and a second encode holds `&lt;p&gt;`,
   * which one decode turns INTO a tag; repeating to a fixed point strips it.
   * The cap stops a crafted `&amp;amp;amp;lt;` chain from spinning. Default 3.
   */
  maxPasses?: number;
}

/**
 * Editor HTML flattened to one line of text: tags and comments removed (each
 * replaced by a space, so `<p>One</p><p>Two</p>` reads "One Two"), entities
 * decoded, whitespace collapsed, trimmed.
 */
export function plainText(html: string | null | undefined, options: PlainTextOptions = {}): string {
  if (!html) return "";
  let text = html;
  const passes = options.maxPasses ?? 3;
  for (let pass = 0; pass < passes; pass++) {
    // Decode THEN strip, in one step: a tag a decode uncovers is stripped on
    // the same pass, so no pass can end holding a live tag.
    const next = decodeOnce(text).replace(TAG, " ");
    if (next === text) break;
    text = next;
  }
  return text.replace(INVISIBLE, " ").trim();
}

export interface MetaDescriptionOptions extends PlainTextOptions {
  /**
   * Clamp to this many characters, ellipsis included, cut on a word boundary.
   * Default 160—about where search results truncate. Past it, the tag is
   * bytes nobody reads.
   */
  maxLength?: number;
}

/**
 * Rich text as a meta description (or any attribute that prints its value):
 * {@link plainText}, clamped to `maxLength` on a word boundary.
 *
 * `undefined`—not `""`—for input that is empty or was nothing but markup,
 * so the caller falls back to a default. An empty `content=""` tells a crawler
 * the page is described, as nothing.
 */
export function metaDescription(
  html: string | null | undefined,
  options: MetaDescriptionOptions = {},
): string | undefined {
  const text = plainText(html, options);
  if (!text) return undefined;
  const max = options.maxLength ?? 160;
  if (text.length <= max) return text;
  // Cut at the last space inside the budget so the result never ends mid-word.
  // A single unbroken run has no space to cut at, so it is hard-cut instead.
  const clipped = text.slice(0, max - 1);
  const space = clipped.lastIndexOf(" ");
  const cut = (space > 0 ? clipped.slice(0, space) : clipped).replace(/[,;:.\s]+$/, "");
  return `${cut}…`;
}

/**
 * Does this rich-text field have anything in it—text, or an embedded image,
 * video, iframe or SVG? `false` for `null`, `""` and markup-only leftovers
 * such as `<h3></h3>`, `<p><br></p>` or `<p>&nbsp;</p>`.
 *
 * Decodes one level only, so copy that literally says `<p>` (stored as
 * `&lt;p&gt;`) counts as text.
 */
export function hasRichText(html: string | null | undefined): boolean {
  if (!html) return false;
  if (EMBEDDED.test(html)) return true;
  return decodeOnce(html.replace(TAG, "")).replace(INVISIBLE, "").length > 0;
}

/**
 * Remove headings with nothing in them (by {@link hasRichText}). A screen
 * reader lists every heading on a page, and an empty one is a nameless entry
 * that goes nowhere. Run it on sanitized output:
 * `stripEmptyHeadings(sanitizeRichHtml(html))`.
 */
export function stripEmptyHeadings(html: string): string {
  return html.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (heading, _tag, inner: string) =>
    hasRichText(inner) ? heading : "",
  );
}
