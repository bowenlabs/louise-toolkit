import { describe, expect, it } from "vitest";
import {
  hasRichText,
  metaDescription,
  plainText,
  sanitizeRichHtml,
  stripEmptyHeadings,
} from "../../src/core/security/index.js";

// Ported from themidwestartist.com, where each case was a production bug —
// `content="<div><p>Don't be a stranger.</p></div>"` in a meta tag, and an
// emptied `<h3></h3>` hero heading in every screen reader's heading list —
// plus the three things the port fixed on the way up (marked "fixed").

describe("plainText", () => {
  it("flattens the markup that shipped to production", () => {
    expect(plainText("<div><p>Don't be a stranger.</p></div>")).toBe("Don't be a stranger.");
  });

  it("puts a space where a tag was, so words don't fuse", () => {
    expect(plainText("<p>One</p><p>Two</p>")).toBe("One Two");
  });

  it("decodes the entities an editor leaves behind", () => {
    expect(plainText("<p>Prints&nbsp;&amp; goods &#8212; by hand&#x21;</p>")).toBe(
      "Prints & goods — by hand!",
    );
  });

  it("strips markup that was stored double-encoded", () => {
    expect(plainText("&lt;p&gt;Don't be a stranger.&lt;/p&gt;")).toBe("Don't be a stranger.");
  });

  it("removes comments", () => {
    expect(plainText("<p>Keep<!-- editor note --> this</p>")).toBe("Keep this");
  });

  it("fixed: keeps a literal < and > in prose", () => {
    // The naive `/<[^>]*>/g` deletes "< 6 and 7 >" here.
    expect(plainText("<p>5 &lt; 6 and 7 &gt; 2</p>")).toBe("5 < 6 and 7 > 2");
  });

  it("fixed: an out-of-range numeric escape is dropped, not thrown", () => {
    // String.fromCodePoint(99999999) throws a RangeError — one bad stored
    // string would take the page down.
    expect(plainText("<p>ok&#99999999;&#x110000; still</p>")).toBe("ok still");
  });

  it("terminates on a deliberately nested encode, holding no live tag", () => {
    const out = plainText("&amp;amp;amp;lt;p&amp;amp;amp;gt;x");
    expect(out).not.toMatch(/<p/);
  });

  it("collapses invisible characters an editor leaves behind", () => {
    expect(plainText("<p>a​  \n b</p>")).toBe("a b");
  });

  it("is empty for nothing", () => {
    expect(plainText(null)).toBe("");
    expect(plainText("<p><br></p>")).toBe("");
  });
});

describe("metaDescription", () => {
  it("returns undefined for nothing, so the caller falls back", () => {
    for (const empty of ["", undefined, null, "   \n  ", "<p></p><br/>"]) {
      expect(metaDescription(empty)).toBeUndefined();
    }
  });

  it("leaves short plain copy exactly as written", () => {
    const plain = "Original oil paintings of the desert, the high plains, and the storms.";
    expect(metaDescription(plain)).toBe(plain);
  });

  it("clamps on a word boundary at 160 by default", () => {
    const out = metaDescription(`${"word ".repeat(80)}end`) ?? "";
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it("keeps copy at exactly the limit whole", () => {
    const exact = "x".repeat(160);
    expect(metaDescription(exact)).toBe(exact);
  });

  it("hard-cuts a single unbroken run", () => {
    const out = metaDescription("x".repeat(400)) ?? "";
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves no dangling punctuation before the ellipsis", () => {
    const out = metaDescription(`${"padding ".repeat(19)}tail, and more words after the cut`);
    expect(out).not.toMatch(/[,;:.]…$/);
  });

  it("takes the limit as an option", () => {
    const out = metaDescription("one two three four five", { maxLength: 10 }) ?? "";
    expect(out).toBe("one two…");
    expect(out.length).toBeLessThanOrEqual(10);
  });
});

describe("hasRichText", () => {
  it("is false for markup with no content in it", () => {
    for (const empty of [
      "",
      null,
      undefined,
      "<h3></h3>",
      "<p><br></p>",
      "<p>&nbsp;</p>",
      "<p>&#160;​</p>",
      "<div><strong></strong></div>",
      "<!-- only a comment -->",
      "  ",
    ]) {
      expect(hasRichText(empty), JSON.stringify(empty)).toBe(false);
    }
  });

  it("is true once there is any text", () => {
    expect(hasRichText("<p>Hello</p>")).toBe(true);
    expect(hasRichText("<h3>A</h3>")).toBe(true);
    expect(hasRichText("plain")).toBe(true);
  });

  it("fixed: counts an image-only field as content", () => {
    // Treating this as empty would hide a hero that is just a picture.
    expect(hasRichText('<figure><img src="/m/a.jpg" alt="A"></figure>')).toBe(true);
    expect(hasRichText('<p><iframe src="https://example.com"></iframe></p>')).toBe(true);
  });

  it("counts copy that literally says <p> as text", () => {
    expect(hasRichText("<p>&lt;p&gt;</p>")).toBe(true);
  });
});

describe("stripEmptyHeadings", () => {
  it("drops empty headings and keeps everything else", () => {
    const out = stripEmptyHeadings(
      '<p>Kept</p><h3></h3><h2 class="pb-x"> &nbsp; <br></h2><h3>Also kept</h3><h4><em></em></h4>',
    );
    expect(out).toBe("<p>Kept</p><h3>Also kept</h3>");
  });

  it("keeps a heading whose only content is an image", () => {
    const heading = '<h2><img src="/m/logo.svg" alt="Coracle"></h2>';
    expect(stripEmptyHeadings(heading)).toBe(heading);
  });

  it("composes with sanitizeRichHtml, which still does the sanitizing", () => {
    const out = stripEmptyHeadings(
      sanitizeRichHtml('<p onclick="x()">Hi</p><h3></h3><script>alert(1)</script>'),
    );
    expect(out).not.toMatch(/onclick|<script|<h3/);
    expect(out).toContain("Hi");
  });
});
