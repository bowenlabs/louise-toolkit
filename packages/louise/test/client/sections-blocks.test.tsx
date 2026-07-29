// happy-dom coverage for the editor's block-layer wiring (#182 Phase 2): the
// on-canvas toolbar (mounted by mountSections) drives moveBlock/removeBlock,
// which reconcile the store AND mirror the change on the already-rendered page
// (re-stamping block markers) — then stage a draft via autosave.
//
// Since ADR 0010 there is no separate block toolbar to assert against: one chrome
// serves every depth, and "this is a block" is a fact about the node's PATH
// (`0.blocks.<j>`), not about which bar appeared. That is the point — these cases
// pass unchanged in substance while the layer they exercised stopped existing.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockCatalog } from "../../src/core/content/sections.js";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  grid: {
    label: "Grid",
    fields: { heading: { type: "text" } },
    blocks: { allow: ["feature"] },
  },
};

const BLOCK_CATALOG: BlockCatalog = {
  feature: { label: "Feature", fields: { name: { type: "text" } } },
};

// A section accepting SEVERAL block types — `+` must open a picker rather than
// guessing. `open` bounds nothing (no `allow`), so it takes the whole catalog.
const MULTI_CATALOG: SectionCatalog = {
  grid: { label: "Grid", fields: {}, blocks: { allow: ["feature", "quote"] } },
  open: { label: "Open", fields: {}, blocks: {} },
};

const MULTI_BLOCKS: BlockCatalog = {
  feature: { label: "Feature", fields: { name: { type: "text" } } },
  quote: { label: "Quote", fields: { name: { type: "text" } } },
  aside: { label: "Aside", fields: { name: { type: "text" } } },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      // Fragment route: re-render the posted section from its `blocks`, exactly as
      // the Astro partial would (one `[data-louise-node]` with a card per block).
      if (url === "/louise-fragment") {
        const item = (body as { item?: { blocks?: Array<{ name?: string }> } })?.item;
        const cards = (item?.blocks ?? [])
          .map(
            (b, j) =>
              `<article data-louise-node="0.blocks.${j}"><div data-louise-sfield="0.blocks.${j}.name">${b.name ?? ""}</div></article>`,
          )
          .join("");
        return Promise.resolve(
          new Response(`<section data-louise-node="0">${cards}</section>`, {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        );
      }
      const payload =
        method === "GET" ? { versions: [], publishedVersionId: null } : { version: { id: 2 } };
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A stand-in for the server-rendered page: one marked section whose blocks each
 *  carry `data-louise-node` + an inner `data-louise-sfield` name node. */
function pageHost(names: string[]): HTMLElement {
  const host = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-node", "0");
  names.forEach((name, j) => {
    const card = document.createElement("article");
    card.setAttribute("data-louise-node", `0.blocks.${j}`);
    const node = document.createElement("div");
    node.setAttribute("data-louise-sfield", `0.blocks.${j}.name`);
    node.textContent = name;
    card.appendChild(node);
    sec.appendChild(card);
  });
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

const initial = (names: string[], type = "grid"): SectionItem[] => [
  { _type: type, blocks: names.map((name) => ({ _type: "feature", name })) },
];

function mount(
  host: HTMLElement,
  names: string[],
  opts: { catalog?: SectionCatalog; blocks?: BlockCatalog; sectionType?: string } = {},
): () => void {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(host, {
    catalog: opts.catalog ?? CATALOG,
    blocks: opts.blocks ?? BLOCK_CATALOG,
    pageId: 1,
    initial: initial(names, opts.sectionType),
    autoSave: { debounceMs: 0 },
  });
}

const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
// One toolbar for every node now; the buttons are [↑ ↓ ✕ +sibling +child ⚙], with
// the ones a node's capabilities don't justify display:none'd rather than absent.
const toolbarButtons = () =>
  [
    ...(document.querySelector(".louise-chrome-toolbar")?.querySelectorAll("button") ?? []),
  ] as HTMLButtonElement[];
/** The rendered BLOCK elements — depth is read off the path, since the section
 *  around them carries the same attribute. */
const blockEls = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("[data-louise-node]")].filter((el) =>
    (el.getAttribute("data-louise-node") ?? "").includes(".blocks."),
  );
const domBlockNames = (host: HTMLElement) =>
  blockEls(host).map((b) => b.querySelector("div")?.textContent);
const domBlockMarkers = (host: HTMLElement) =>
  blockEls(host).map((b) => b.getAttribute("data-louise-node"));
const lastDraftBlocks = (calls: Call[]): Array<{ name?: string; _type?: string }> => {
  const posts = calls.filter(
    (c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions",
  );
  const body = posts.at(-1)?.body as
    | { sections: Array<{ blocks?: Array<{ name?: string; _type?: string }> }> }
    | undefined;
  return body?.sections[0].blocks ?? [];
};
// The add-section / add-block type-picker palettes, told apart by aria-label.
const palette = (label: string) => document.querySelector(`[aria-label="${label}"]`);
const paletteLabels = (label: string) =>
  [...(palette(label)?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
const paletteButton = (label: string, text: string) =>
  [...(palette(label)?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountSections — block chrome wiring (#182 Phase 2)", () => {
  it("deleting a block re-stamps the DOM and stages the reduced blocks", async () => {
    const calls = stubFetch();
    const host = pageHost(["A", "B", "C"]);
    dispose = mount(host, ["A", "B", "C"]);
    await flush();

    over(blockEls(host)[1].querySelector("div") as Node); // hover B
    toolbarButtons()[2].click(); // ✕ delete
    await flush();

    expect(domBlockNames(host)).toEqual(["A", "C"]);
    expect(domBlockMarkers(host)).toEqual(["0.blocks.0", "0.blocks.1"]);
    expect(lastDraftBlocks(calls).map((b) => b.name)).toEqual(["A", "C"]);
  });

  it("moving a block up re-stamps the DOM and stages the reordered blocks", async () => {
    const calls = stubFetch();
    const host = pageHost(["A", "B", "C"]);
    dispose = mount(host, ["A", "B", "C"]);
    await flush();

    over(blockEls(host)[1].querySelector("div") as Node); // hover B (middle)
    toolbarButtons()[0].click(); // ↑ move up
    await flush();

    expect(domBlockNames(host)).toEqual(["B", "A", "C"]);
    expect(domBlockMarkers(host)).toEqual(["0.blocks.0", "0.blocks.1", "0.blocks.2"]);
    expect(lastDraftBlocks(calls).map((b) => b.name)).toEqual(["B", "A", "C"]);
  });

  it("adding a block re-renders the section via the fragment route and swaps it in", async () => {
    const calls = stubFetch();
    const host = pageHost(["A", "B"]);
    dispose = mount(host, ["A", "B"]);
    await flush();

    over(blockEls(host)[0].querySelector("div") as Node); // hover A
    toolbarButtons()[3].click(); // + add block after A
    await flush();
    await flush();

    // The fragment route re-rendered the section with the new (blank) block...
    const frag = calls.find((c) => c.url === "/louise-fragment" && c.method === "POST");
    expect((frag?.body as { item?: { blocks?: unknown[] } })?.item?.blocks).toHaveLength(3);

    // ...and the section was swapped in place (no reload): 3 blocks, re-stamped,
    // the blank inserted after A.
    expect(domBlockMarkers(host)).toEqual(["0.blocks.0", "0.blocks.1", "0.blocks.2"]);
    expect(domBlockNames(host)).toEqual(["A", "", "B"]);
    expect(window.location.reload).not.toHaveBeenCalled();

    // A draft was staged for the new shape.
    expect(lastDraftBlocks(calls)).toHaveLength(3);
  });
});

describe("mountSections — multi-type block add-picker", () => {
  it("opens a picker of the allowed types and inserts the chosen one after the block", async () => {
    const calls = stubFetch();
    const host = pageHost(["A", "B"]);
    dispose = mount(host, ["A", "B"], { catalog: MULTI_CATALOG, blocks: MULTI_BLOCKS });
    await flush();

    over(blockEls(host)[0].querySelector("div") as Node); // hover A
    toolbarButtons()[3].click(); // + add block after A
    await flush();

    // Nothing inserted yet — the picker asks which type first, bounded by `allow`
    // (so `aside`, which the catalog has but the section disallows, is absent).
    expect(paletteLabels("Add a block")).toEqual(["Feature", "Quote"]);
    expect(calls.some((c) => c.url === "/louise-fragment")).toBe(false);

    paletteButton("Add a block", "Quote").click();
    await flush();
    await flush();

    // The chosen type landed at index 1 — after A, before B.
    expect(lastDraftBlocks(calls).map((b) => b._type)).toEqual(["feature", "quote", "feature"]);
    expect(domBlockMarkers(host)).toEqual(["0.blocks.0", "0.blocks.1", "0.blocks.2"]);
    expect(document.querySelector('[aria-label="Add a block"]')).toBeNull(); // picker closed
  });

  it("offers the whole block catalog when the section declares no `allow`", async () => {
    stubFetch();
    const host = pageHost(["A"]);
    dispose = mount(host, ["A"], {
      catalog: MULTI_CATALOG,
      blocks: MULTI_BLOCKS,
      sectionType: "open",
    });
    await flush();

    over(blockEls(host)[0].querySelector("div") as Node);
    toolbarButtons()[3].click();
    await flush();

    expect(paletteLabels("Add a block")).toEqual(["Feature", "Quote", "Aside"]);
  });

  it("inserts without a picker when only one type is allowed", async () => {
    const calls = stubFetch();
    const host = pageHost(["A"]);
    dispose = mount(host, ["A"]); // CATALOG: allow: ["feature"]
    await flush();

    over(blockEls(host)[0].querySelector("div") as Node);
    toolbarButtons()[3].click();
    await flush();
    await flush();

    expect(document.querySelector('[aria-label="Add a block"]')).toBeNull();
    expect(lastDraftBlocks(calls)).toHaveLength(2);
  });
});

// Defect 1 from ADR 0010's live QA: a freshly added block-capable section was a
// dead end. Its `+` lived on a BLOCK's toolbar, and it had no blocks, so there was
// no `+` anywhere on the page that could give it one. The fix isn't a special
// case for empty sections — it's that a node with `children` and none of them
// offers its own add, at any depth.
describe("mountSections — adding the FIRST child of an empty container", () => {
  it("inserts a block into a block-capable section that has none", async () => {
    const calls = stubFetch();
    const host = pageHost([]);
    dispose = mount(host, []);
    await flush();

    over(host.querySelector('[data-louise-node="0"]') as Node);
    toolbarButtons()[4].click(); // + add the first one
    await flush();
    await flush();

    // It went in at index 0 — the only position an empty list has — and the
    // section came back from the fragment route rendering it.
    expect(lastDraftBlocks(calls)).toHaveLength(1);
    expect(domBlockMarkers(host)).toEqual(["0.blocks.0"]);
  });

  it("offers the type-picker here too when several types are allowed", async () => {
    stubFetch();
    const host = pageHost([]);
    dispose = mount(host, [], { catalog: MULTI_CATALOG, blocks: MULTI_BLOCKS });
    await flush();

    over(host.querySelector('[data-louise-node="0"]') as Node);
    toolbarButtons()[4].click();
    await flush();

    expect(paletteLabels("Add a block")).toEqual(["Feature", "Quote"]);
  });

  it("does not offer it once the section has a block — that would be two pluses", async () => {
    stubFetch();
    const host = pageHost(["A"]);
    dispose = mount(host, ["A"]);
    await flush();

    over(host.querySelector('[data-louise-node="0"]') as Node);
    expect(toolbarButtons()[4].style.display).toBe("none");
  });
});
