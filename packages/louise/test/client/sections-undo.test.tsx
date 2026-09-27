// Structural undo on the canvas (#541): deleting, moving, and adding sections
// and blocks is instant and autosaves, so Ctrl+Z or Cmd+Z (or the bar's Undo)
// reverses the newest one. Each undo reverses only its own edit, so text typed
// after a delete survives undoing it.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockCatalog } from "../../src/core/content/sections.js";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  hero: { label: "Hero", fields: { title: { type: "text" } } },
  grid: { label: "Grid", fields: {}, blocks: { allow: ["feature"] } },
};
const BLOCKS: BlockCatalog = {
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

/** Three hero sections, each with an in-place title. */
function heroPage(titles: string[]): HTMLElement {
  const host = document.createElement("div");
  titles.forEach((title, i) => {
    const sec = document.createElement("section");
    sec.setAttribute("data-louise-node", `${i}`);
    const h = document.createElement("h2");
    h.setAttribute("data-louise-node", `${i}.title`);
    h.textContent = title;
    sec.appendChild(h);
    host.appendChild(sec);
  });
  document.body.appendChild(host);
  return host;
}

/** One grid section with a card per block. */
function gridPage(names: string[]): HTMLElement {
  const host = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-node", "0");
  names.forEach((name, j) => {
    const card = document.createElement("article");
    card.setAttribute("data-louise-node", `0.blocks.${j}`);
    const n = document.createElement("div");
    n.setAttribute("data-louise-node", `0.blocks.${j}.name`);
    n.textContent = name;
    card.appendChild(n);
    sec.appendChild(card);
  });
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
// [↑ ↓ ✕ +sibling +child ⚙]
const toolbar = () =>
  [
    ...(document.querySelector(".louise-chrome-toolbar")?.querySelectorAll("button") ?? []),
  ] as HTMLButtonElement[];
const pressUndo = (target: EventTarget = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
  );
const notice = () => document.querySelector(".louise-bar-undo");
const sectionTitles = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>(":scope > section")].map(
    (s) => `${s.getAttribute("data-louise-node")}:${s.textContent}`,
  );
const lastDraft = (calls: Call[]): SectionItem[] =>
  (
    calls.filter((c) => c.method === "POST" && c.url.endsWith("/versions")).at(-1)?.body as {
      sections: SectionItem[];
    }
  )?.sections ?? [];

function mountHeroes(titles: string[]) {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  const host = heroPage(titles);
  dispose = mountSections(host, {
    catalog: CATALOG,
    blocks: BLOCKS,
    pageId: 1,
    initial: titles.map((title) => ({ _type: "hero", title })),
    autoSave: { debounceMs: 0 },
  });
  return host;
}

describe("structural undo—sections", () => {
  it("undoes a section delete with Ctrl+Z, putting the same element back", async () => {
    const calls = stubFetch();
    const host = mountHeroes(["A", "B", "C"]);
    await flush();
    const b = host.querySelector<HTMLElement>('[data-louise-node="1"]');

    over(b as Node);
    toolbar()[2].click(); // delete B
    await flush();
    expect(sectionTitles(host)).toEqual(["0:A", "1:C"]);
    expect(lastDraft(calls).map((s) => s.title)).toEqual(["A", "C"]);
    expect(notice()?.getAttribute("role")).toBe("status");
    expect(notice()?.textContent).toBe("Deleted Hero · Undo");

    const ev = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(ev);
    await flush();

    expect(ev.defaultPrevented).toBe(true);
    expect(sectionTitles(host)).toEqual(["0:A", "1:B", "2:C"]);
    expect(host.querySelector('[data-louise-node="1"]')).toBe(b);
    expect(lastDraft(calls).map((s) => s.title)).toEqual(["A", "B", "C"]);
    expect(notice()?.textContent).toBe("Undid: Deleted Hero");
  });

  it("undoes from the bar's Undo button", async () => {
    stubFetch();
    const host = mountHeroes(["A", "B"]);
    await flush();
    over(host.querySelector('[data-louise-node="0"]') as Node);
    toolbar()[2].click();
    await flush();

    notice()?.querySelector("button")?.click();
    await flush();
    expect(sectionTitles(host)).toEqual(["0:A", "1:B"]);
  });

  it("keeps text typed after a delete when the delete is undone", async () => {
    const calls = stubFetch();
    const host = mountHeroes(["A", "B", "C"]);
    await flush();
    over(host.querySelector('[data-louise-node="1"]') as Node);
    toolbar()[2].click();
    await flush();

    const title = host.querySelector<HTMLElement>('[data-louise-node="0.title"]');
    if (!title) throw new Error("title not found");
    title.textContent = "A, edited";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    pressUndo();
    await flush();
    expect(lastDraft(calls).map((s) => s.title)).toEqual(["A, edited", "B", "C"]);
  });

  it("undoes a move, and undoes the newest edit first", async () => {
    const calls = stubFetch();
    const host = mountHeroes(["A", "B", "C"]);
    await flush();
    over(host.querySelector('[data-louise-node="0"]') as Node);
    toolbar()[1].click(); // move A down
    await flush();
    over(host.querySelector('[data-louise-node="2"]') as Node);
    toolbar()[2].click(); // delete C
    await flush();
    expect(sectionTitles(host)).toEqual(["0:B", "1:A"]);

    pressUndo();
    await flush();
    expect(sectionTitles(host)).toEqual(["0:B", "1:A", "2:C"]);
    pressUndo();
    await flush();
    expect(sectionTitles(host)).toEqual(["0:A", "1:B", "2:C"]);
    expect(lastDraft(calls).map((s) => s.title)).toEqual(["A", "B", "C"]);
  });

  it("drops a delete's notice once a newer edit lands on top", async () => {
    stubFetch();
    const host = mountHeroes(["A", "B", "C"]);
    await flush();
    over(host.querySelector('[data-louise-node="2"]') as Node);
    toolbar()[2].click();
    await flush();
    expect(notice()?.textContent).toContain("Deleted Hero");
    over(host.querySelector('[data-louise-node="0"]') as Node);
    toolbar()[1].click();
    await flush();
    expect(notice()?.textContent).toBe("");
  });

  it("leaves Ctrl+Z to the field when focus is in one", async () => {
    stubFetch();
    const host = mountHeroes(["A", "B"]);
    await flush();
    over(host.querySelector('[data-louise-node="1"]') as Node);
    toolbar()[2].click();
    await flush();

    const field = host.querySelector<HTMLElement>('[data-louise-node="0.title"]');
    expect(field?.isContentEditable).toBe(true);
    const ev = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    field?.dispatchEvent(ev);
    await flush();
    expect(ev.defaultPrevented).toBe(false);
    expect(sectionTitles(host)).toEqual(["0:A"]);
  });

  it("keeps the newest 20 edits", async () => {
    stubFetch();
    const host = mountHeroes(["A", "B"]);
    await flush();
    // 21 moves of the top section down; an odd count ends with B on top.
    for (let k = 0; k < 21; k++) {
      over(host.querySelector('[data-louise-node="0"]') as Node);
      toolbar()[1].click();
      await flush();
    }
    expect(sectionTitles(host)).toEqual(["0:B", "1:A"]);
    for (let k = 0; k < 25; k++) {
      pressUndo();
      await flush();
    }
    // 20 undone, so one move is left standing.
    expect(sectionTitles(host)).toEqual(["0:B", "1:A"]);
  });
});

describe("structural undo—blocks", () => {
  it("undoes a block delete", async () => {
    const calls = stubFetch();
    vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const host = gridPage(["A", "B", "C"]);
    dispose = mountSections(host, {
      catalog: CATALOG,
      blocks: BLOCKS,
      pageId: 1,
      initial: [
        { _type: "grid", blocks: ["A", "B", "C"].map((name) => ({ _type: "feature", name })) },
      ],
      autoSave: { debounceMs: 0 },
    });
    await flush();
    const cards = () =>
      [...host.querySelectorAll<HTMLElement>("article")].map(
        (a) => `${a.getAttribute("data-louise-node")}:${a.textContent}`,
      );

    over(host.querySelector('[data-louise-node="0.blocks.0"] div') as Node);
    toolbar()[2].click();
    await flush();
    expect(cards()).toEqual(["0.blocks.0:B", "0.blocks.1:C"]);
    expect(notice()?.textContent).toBe("Deleted Feature · Undo");

    pressUndo();
    await flush();
    expect(cards()).toEqual(["0.blocks.0:A", "0.blocks.1:B", "0.blocks.2:C"]);
    const blocks = (lastDraft(calls)[0].blocks ?? []) as unknown as Array<{ name: string }>;
    expect(blocks.map((b) => b.name)).toEqual(["A", "B", "C"]);
  });
});
