// A richText field must render into a container that can legally HOLD blocks.
//
// The stored value is HTML the editor produced — `<p>`, lists, blockquotes.
// Rendering that into a `<p>` is invalid nesting, and the parser does not merely
// tolerate it: it CLOSES the paragraph and hoists the block content out as a
// following sibling. The marker stays on the now-empty `<p>`, so the editor
// mounts on nothing while the prose sits outside it, unmarked and uneditable —
// and every paragraph break the editor creates is hoisted straight back out.
//
// Nothing about that fails loudly. The page renders; the field is simply inert.
// Two sites (themidwestartist.com, coracle.coffee) shipped it independently
// before anyone noticed, which is why the framework warns rather than leaving it
// to each site's conventions.
//
// It stays a WARNING, not a throw: the field still half-works, and breaking an
// owner's editing session over a markup nit would be the worse failure.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/RichText.jsx", () => ({
  mountRichText: () => ({ getJSON: () => ({}), getHTML: () => "", destroy: () => {} }),
}));

import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  content: {
    label: "Content",
    fields: { body: { type: "richText" }, title: { type: "text" } },
  },
};
const INITIAL: SectionItem[] = [{ _type: "content", body: "<p>B</p>", title: "T" }];

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A section whose `body` (richText) and `title` (text) render into `tag`. */
function pageHost(tag: string): HTMLElement {
  const host = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-node", "0");
  for (const field of ["body", "title"]) {
    const node = document.createElement(tag);
    node.setAttribute("data-louise-node", `0.${field}`);
    sec.appendChild(node);
  }
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(host: HTMLElement) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ versions: [], publishedVersionId: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
  dispose = mountSections(host, { catalog: CATALOG, pageId: 1, initial: INITIAL, autoSave: false });
}

describe("sections rich text — container element", () => {
  it("warns when a richText field renders into a <p>, naming the path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(pageHost("p"));
    await flush();

    const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).toContain("0.body");
    expect(said).toContain("<p>");
    // The remedy has to be in the message — a warning that only says something is
    // wrong costs more than it saves.
    expect(said).toContain("<div>");
  });

  it("says nothing for a <div>", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(pageHost("div"));
    await flush();

    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("richText");
  });

  it("does not warn about a PLAIN-text field in a <p>", async () => {
    // `<p>` is the right element for a text field — it holds no blocks. Warning
    // on every paragraph on the page would train everyone to ignore the warning.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(pageHost("p"));
    await flush();

    const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).not.toContain("0.title");
  });
});
