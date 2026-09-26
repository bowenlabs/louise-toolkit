// @vitest-environment happy-dom
import type { NodeJSON } from "prosekit/core";
import { afterEach, describe, expect, it } from "vitest";
import { mountRichText } from "../../src/client/RichText.jsx";

// Inline mode suppresses the Enter keys so a heading stays one line, but a paste
// used to split it into paragraphs anyway, and the inline serializer joined
// those with nothing. Three pasted lines in a site's home hero came back as one
// run-together string (#449). Both halves of the fix are covered here: a paste
// flattens to one block, and a doc that holds several blocks still serializes
// with a space between them.
//
// These mount the real editor, because the bug lives in how ProseMirror parses
// a paste—mocking the editor would test the mock.

const hosts: HTMLElement[] = [];
function mount(opts: { inline?: boolean }, initialDoc?: NodeJSON) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  hosts.push(el);
  const field = mountRichText(el, () => {}, initialDoc, opts);
  const view = el.querySelector<HTMLElement>("[contenteditable]");
  if (!view) throw new Error("the editor didn't mount");
  return { field, view };
}

/** Dispatch a paste the way a browser does. ProseMirror reads `clipboardData`
 *  off the event; `files` is what the image-upload handler checks first. */
function paste(target: HTMLElement, data: { text?: string; html?: string }) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (type: string) =>
        type === "text/plain" ? (data.text ?? "") : type === "text/html" ? (data.html ?? "") : "",
    },
  });
  target.dispatchEvent(event);
}

const blockCount = (json: NodeJSON) => json.content?.length ?? 0;

afterEach(() => {
  for (const el of hosts.splice(0)) el.remove();
});

describe("inline rich text—multi-line paste", () => {
  it("keeps a word boundary where the pasted line broke", () => {
    const { field, view } = mount({ inline: true });
    paste(view, { text: "one\ntwo" });

    expect(field.getHTML()).toBe("one two");
    field.destroy();
  });

  it("keeps the doc to one block, so nothing is left to join", () => {
    const { field, view } = mount({ inline: true });
    paste(view, { text: "Fresh bread daily\nCoffee on tap\nOpen until late\n" });

    expect(blockCount(field.getJSON())).toBe(1);
    expect(field.getHTML()).toBe("Fresh bread daily Coffee on tap Open until late");
    field.destroy();
  });

  it("collapses CRLF line breaks and blank lines to one space", () => {
    const { field, view } = mount({ inline: true });
    paste(view, { text: "one\r\n\r\ntwo" });

    expect(field.getHTML()).toBe("one two");
    field.destroy();
  });

  it("doesn't double a space the pasted line already had", () => {
    const { field, view } = mount({ inline: true });
    paste(view, { text: "one \ntwo" });

    expect(field.getHTML()).toBe("one two");
    field.destroy();
  });

  it("flattens pasted HTML blocks and keeps their inline formatting", () => {
    const { field, view } = mount({ inline: true });
    paste(view, {
      html: "<p>Fresh bread daily</p><h2><strong>Coffee</strong> on tap</h2>",
      text: "Fresh bread daily\nCoffee on tap",
    });

    expect(blockCount(field.getJSON())).toBe(1);
    expect(field.getHTML()).toBe("Fresh bread daily <strong>Coffee</strong> on tap");
    field.destroy();
  });

  it("turns a pasted hard break into a space", () => {
    const { field, view } = mount({ inline: true });
    paste(view, { html: "<p>one<br>two</p>", text: "one\ntwo" });

    expect(field.getHTML()).toBe("one two");
    field.destroy();
  });

  it("leaves a paste into a full rich-text field as separate paragraphs", () => {
    // The flattening is inline mode's alone: a prose body keeps its paragraphs.
    const { field, view } = mount({});
    paste(view, { text: "one\ntwo" });

    expect(blockCount(field.getJSON())).toBe(2);
    expect(field.getHTML()).toContain("<p>one</p><p>two</p>");
    field.destroy();
  });
});

describe("inline rich text—serializing several blocks", () => {
  const doc = (...blocks: string[]): NodeJSON => ({
    type: "doc",
    content: blocks.map((text) =>
      text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" },
    ),
  });

  it("joins blocks with a space", () => {
    const { field } = mount({ inline: true }, doc("one", "two"));

    expect(field.getHTML()).toBe("one two");
    field.destroy();
  });

  it("adds no space where a block already ends or starts with one", () => {
    const { field } = mount({ inline: true }, doc("one ", "two", " three"));

    expect(field.getHTML()).toBe("one two three");
    field.destroy();
  });

  it("skips empty blocks rather than leaving a stray space", () => {
    const { field } = mount({ inline: true }, doc("", "one", "", "two", ""));

    expect(field.getHTML()).toBe("one two");
    field.destroy();
  });
});
