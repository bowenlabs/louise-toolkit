// Empty-field hints on the live design.
//
// An empty inline field has nothing to click, so the render emits the node anyway
// and the editor labels it from the catalog — `placeholder`, else `label`, else a
// humanised key. Resolving that means walking a `data-louise-sfield` path back to
// the field that declared it, which has three shapes.
//
// The BLOCK shape was missing. `<i>.blocks.<j>.<key>` starts with `blocks`, which
// is not a field, so the lookup found nothing and every block field fell through
// to its humanised key — a declared `placeholder` on a block field was silently
// ignored. Nothing failed; the hint was just always wrong (ADR 0010 A2, #345).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockCatalog } from "../../src/core/content/sections.js";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  grid: {
    label: "Grid",
    blocks: { allow: ["feature"] },
    fields: {
      heading: { type: "text", placeholder: "Section heading" },
      // No placeholder — the label is the fallback.
      subheading: { type: "text", label: "Sub heading" },
      // Neither — humanised from the key.
      leadPara: { type: "textarea" },
      items: {
        type: "array",
        itemFields: { caption: { type: "text", placeholder: "Say something" } },
      },
    },
  },
};

const BLOCKS: BlockCatalog = {
  feature: {
    label: "Feature",
    fields: { name: { type: "text", placeholder: "Feature name" } },
  },
};

const INITIAL: SectionItem[] = [
  {
    _type: "grid",
    heading: "",
    subheading: "",
    leadPara: "",
    items: [{ caption: "" }],
    blocks: [{ _type: "feature", name: "" }],
  },
];

const flush = () => new Promise((r) => setTimeout(r, 0));

/** The rendered page: one section, with a marked node per editable path. */
function pageHost(): HTMLElement {
  const host = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-node", "0");
  for (const path of ["0.heading", "0.subheading", "0.leadPara", "0.items.0.caption"]) {
    const n = document.createElement("div");
    n.setAttribute("data-louise-sfield", path);
    sec.appendChild(n);
  }
  const card = document.createElement("article");
  card.setAttribute("data-louise-node", "0.blocks.0");
  const nameNode = document.createElement("div");
  nameNode.setAttribute("data-louise-sfield", "0.blocks.0.name");
  card.appendChild(nameNode);
  sec.appendChild(card);
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

const hintFor = (host: HTMLElement, path: string) =>
  host.querySelector<HTMLElement>(`[data-louise-sfield="${path}"]`)?.dataset.louisePlaceholder;

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
  dispose = mountSections(host, {
    catalog: CATALOG,
    blocks: BLOCKS,
    pageId: 1,
    initial: INITIAL,
    autoSave: false,
  });
}

describe("empty-field hints", () => {
  it("uses a block field's own placeholder", async () => {
    // The regression. Before the shared path resolver this read "Name" — the
    // humanised key — because `fields["blocks"]` is not a field.
    const host = pageHost();
    mount(host);
    await flush();

    expect(hintFor(host, "0.blocks.0.name")).toBe("Feature name");
  });

  it("still resolves a section field, its label, and an array item", async () => {
    const host = pageHost();
    mount(host);
    await flush();

    expect(hintFor(host, "0.heading")).toBe("Section heading");
    expect(hintFor(host, "0.subheading")).toBe("Sub heading"); // label, no placeholder
    expect(hintFor(host, "0.items.0.caption")).toBe("Say something");
  });

  it("humanises the key when the field declares neither", async () => {
    const host = pageHost();
    mount(host);
    await flush();

    expect(hintFor(host, "0.leadPara")).toBe("Lead Para");
  });
});
