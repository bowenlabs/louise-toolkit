// happy-dom coverage for the editor's block-layer wiring (#182 Phase 2): the
// on-canvas block toolbar (mounted by mountSections) drives moveBlock/removeBlock,
// which reconcile the store AND mirror the change on the already-rendered page
// (re-stamping block markers) — then stage a draft via autosave. Mirrors the
// section-chrome path one level down.

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
      // the Astro partial would (one `[data-louise-section]` with a card per block).
      if (url === "/louise-fragment") {
        const item = (body as { item?: { blocks?: Array<{ name?: string }> } })?.item;
        const cards = (item?.blocks ?? [])
          .map(
            (b, j) =>
              `<article data-louise-block="0.blocks.${j}"><div data-louise-sfield="0.blocks.${j}.name">${b.name ?? ""}</div></article>`,
          )
          .join("");
        return Promise.resolve(
          new Response(`<section data-louise-section="0">${cards}</section>`, {
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
 *  carry `data-louise-block` + an inner `data-louise-sfield` name node. */
function pageHost(names: string[]): HTMLElement {
  const host = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-section", "0");
  names.forEach((name, j) => {
    const card = document.createElement("article");
    card.setAttribute("data-louise-block", `0.blocks.${j}`);
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

const initial = (names: string[]): SectionItem[] => [
  { _type: "grid", blocks: names.map((name) => ({ _type: "feature", name })) },
];

function mount(host: HTMLElement, names: string[]): () => void {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(host, {
    catalog: CATALOG,
    blocks: BLOCK_CATALOG,
    pageId: 1,
    initial: initial(names),
    autoSave: { debounceMs: 0 },
  });
}

const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const blockToolbarButtons = () =>
  [
    ...(document.querySelector(".louise-block-toolbar")?.querySelectorAll("button") ?? []),
  ] as HTMLButtonElement[];
const domBlockNames = (host: HTMLElement) =>
  [...host.querySelectorAll("[data-louise-block]")].map((b) => b.querySelector("div")?.textContent);
const domBlockMarkers = (host: HTMLElement) =>
  [...host.querySelectorAll("[data-louise-block]")].map((b) => b.getAttribute("data-louise-block"));
const lastDraftBlocks = (calls: Call[]): Array<{ name?: string }> => {
  const posts = calls.filter(
    (c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions",
  );
  const body = posts.at(-1)?.body as
    | { sections: Array<{ blocks?: Array<{ name?: string }> }> }
    | undefined;
  return body?.sections[0].blocks ?? [];
};

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

    over(host.querySelectorAll("[data-louise-block]")[1].querySelector("div") as Node); // hover B
    blockToolbarButtons()[2].click(); // ✕ delete
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

    over(host.querySelectorAll("[data-louise-block]")[1].querySelector("div") as Node); // hover B (middle)
    blockToolbarButtons()[0].click(); // ↑ move up
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

    over(host.querySelectorAll("[data-louise-block]")[0].querySelector("div") as Node); // hover A
    blockToolbarButtons()[3].click(); // + add block after A
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
