// Per-field rich-text modes (coracle.coffee#35). `richText` alone is
// all-or-nothing, which falls apart the moment one page has both kinds of rich
// text: a site whose headings need `inline` (so editing an <h1> can't produce a
// nested <p>) would force that same single-line mode onto a prose body and lose
// paragraphs and lists. A render opts a field into a named preset with
// `data-louise-rt`; everything unnamed keeps the site-wide default.
//
// mountRichText is mocked — this is about which OPTIONS each field is mounted
// with, not about ProseKit. Mounting the real editor would test ProseKit.

import { afterEach, describe, expect, it, vi } from "vitest";

const mounts: Array<{ path: string | undefined; opts: unknown }> = [];

vi.mock("../../src/client/RichText.jsx", () => ({
  mountRichText: (el: HTMLElement, _onChange: () => void, _doc: unknown, opts: unknown) => {
    mounts.push({ path: el.dataset.louiseSfield, opts });
    return { getJSON: () => ({}), getHTML: () => "", destroy: () => {} };
  },
}));

import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  content: {
    label: "Content",
    fields: { heading: { type: "richText" }, body: { type: "richText" } },
  },
};
const INITIAL: SectionItem[] = [{ _type: "content", heading: "H", body: "<p>B</p>" }];

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A section with two rich-text fields: a heading (no mode) and a body that opts
 *  into the "prose" preset. */
function pageHost(bodyMode?: string): HTMLElement {
  const host = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-node", "0");
  for (const [field, mode] of [
    ["heading", undefined],
    ["body", bodyMode],
  ] as const) {
    const node = document.createElement("div");
    node.setAttribute("data-louise-sfield", `0.${field}`);
    node.setAttribute("data-louise-type", "richtext");
    if (mode) node.setAttribute("data-louise-rt", mode);
    sec.appendChild(node);
  }
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

const optsFor = (field: string) => mounts.find((m) => m.path === `0.${field}`)?.opts;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  mounts.length = 0;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(host: HTMLElement, opts: Record<string, unknown>) {
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
  dispose = mountSections(host, {
    catalog: CATALOG,
    pageId: 1,
    initial: INITIAL,
    autoSave: false,
    ...opts,
  });
}

describe("sections rich text — per-field modes", () => {
  it("mounts a named-mode field with its preset and leaves the rest on the default", async () => {
    mount(pageHost("prose"), {
      richText: { inline: true },
      richTextModes: { prose: { minimal: false, grammar: true } },
    });
    await flush();

    // The heading keeps the site-wide inline mode — this is the pairing that a
    // single global option cannot express.
    expect(optsFor("heading")).toEqual({ inline: true });
    expect(optsFor("body")).toEqual({ minimal: false, grammar: true });
  });

  it("falls back to the site default for an unknown mode name", async () => {
    mount(pageHost("does-not-exist"), {
      richText: { inline: true },
      richTextModes: { prose: { minimal: false } },
    });
    await flush();

    // Degrade, don't throw: a render stamped for a mode the mount doesn't declare
    // should still get an editor.
    expect(optsFor("body")).toEqual({ inline: true });
  });

  it("is unchanged when no modes are configured", async () => {
    mount(pageHost("prose"), { richText: { inline: true } });
    await flush();

    expect(optsFor("heading")).toEqual({ inline: true });
    expect(optsFor("body")).toEqual({ inline: true });
  });

  it("keeps the light-inline bubble as the default when richText is omitted too", async () => {
    mount(pageHost(), {});
    await flush();

    expect(optsFor("heading")).toEqual({ minimal: true });
  });
});

// ADR 0010 A2 (#345): the options were always a property of the FIELD. The mode
// map was a rendezvous between the render (`data-louise-rt`) and the mount
// (`richTextModes`) to establish something the catalog already knew.
describe("sections rich text — declared on the field", () => {
  const FIELD_CATALOG: SectionCatalog = {
    content: {
      label: "Content",
      fields: {
        heading: { type: "richText", richText: { inline: true, image: false } },
        body: { type: "richText", richText: { minimal: false, grammar: true } },
      },
    },
  };

  it("mounts each field with what its own definition asks for", async () => {
    mount(pageHost(), { catalog: FIELD_CATALOG });
    await flush();

    // Two kinds of rich text on one page, and neither the render nor the mount
    // had to say anything about it.
    expect(optsFor("heading")).toEqual({ inline: true, image: false });
    expect(optsFor("body")).toEqual({ minimal: false, grammar: true });
  });

  it("wins over a stamped mode and the site-wide default", async () => {
    mount(pageHost("prose"), {
      catalog: FIELD_CATALOG,
      richText: { inline: true },
      richTextModes: { prose: { blocks: true } },
    });
    await flush();

    // `body` carries `data-louise-rt="prose"` and the mount declares that mode —
    // the field still wins, because it is the more specific statement.
    expect(optsFor("body")).toEqual({ minimal: false, grammar: true });
  });

  it("leaves the old path working for a field that declares nothing", async () => {
    const MIXED: SectionCatalog = {
      content: {
        label: "Content",
        fields: {
          heading: { type: "richText", richText: { inline: true } },
          body: { type: "richText" },
        },
      },
    };
    mount(pageHost("prose"), {
      catalog: MIXED,
      richTextModes: { prose: { minimal: false } },
    });
    await flush();

    expect(optsFor("heading")).toEqual({ inline: true });
    expect(optsFor("body")).toEqual({ minimal: false });
  });
});
