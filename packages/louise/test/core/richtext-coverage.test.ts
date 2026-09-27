import { describe, expect, it } from "vitest";
import { renderRichText } from "../../src/core/content/index.js";

// The read-side TipTap JSON renderer in core/content/richtext.ts (#695): the
// block and mark tags it knows, HTML escaping, and how it degrades on nodes
// and marks it doesn't know.

const text = (value: string, ...marks: string[]) => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});

describe("renderRichText", () => {
  it("returns an empty string for a document with no content", () => {
    expect(renderRichText({ type: "doc" })).toBe("");
    expect(renderRichText({ type: "doc", content: [] })).toBe("");
  });

  it("maps each known block node to its tag", () => {
    const html = renderRichText({
      type: "doc",
      content: [
        { type: "heading", content: [text("Hours")] },
        { type: "paragraph", content: [text("Open daily.")] },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("Tea")] }] }],
        },
        { type: "orderedList", content: [{ type: "listItem", content: [text("First")] }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [text("Quoted")] }] },
      ],
    });
    expect(html).toBe(
      "<h2>Hours</h2><p>Open daily.</p><ul><li><p>Tea</p></li></ul>" +
        "<ol><li>First</li></ol><blockquote><p>Quoted</p></blockquote>",
    );
  });

  it("wraps marked text, applying marks innermost first", () => {
    const html = renderRichText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [text("bold", "bold"), text(" and "), text("both", "italic", "code")],
        },
      ],
    });
    expect(html).toBe("<p><strong>bold</strong> and <code><em>both</em></code></p>");
  });

  it("drops an unknown mark but keeps its text", () => {
    const html = renderRichText({
      type: "doc",
      content: [{ type: "paragraph", content: [text("linked", "link", "bold")] }],
    });
    expect(html).toBe("<p><strong>linked</strong></p>");
  });

  it("escapes HTML in text", () => {
    const html = renderRichText({
      type: "doc",
      content: [{ type: "paragraph", content: [text('<script>"a" & b</script>')] }],
    });
    expect(html).toBe("<p>&lt;script&gt;&quot;a&quot; &amp; b&lt;/script&gt;</p>");
  });

  it("renders an unknown or untyped node's children without a wrapper", () => {
    const html = renderRichText({
      type: "doc",
      content: [
        { type: "callout", content: [{ type: "paragraph", content: [text("Note")] }] },
        { content: [text("bare")] },
        { type: "horizontalRule" },
      ],
    });
    expect(html).toBe("<p>Note</p>bare");
  });

  it("renders a top-level text node and treats missing text as empty", () => {
    expect(renderRichText({ type: "doc", content: [text("loose"), { type: "text" }] })).toBe(
      "loose",
    );
  });
});
