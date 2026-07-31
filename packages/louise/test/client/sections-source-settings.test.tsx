// The external section's source-settings group (ADR 0010 Phase B / #375).
//
// A yellow section's wrench opens TWO kinds of knobs: the mirror's
// configuration (which category, which items hidden — site settings, shared by
// every page, saved immediately) and the section's own layout (page-owned,
// staged into the draft like always). The split write path is the whole design:
// a source change must PATCH the settings route and must NOT stage a page
// draft, and the group's caption tells the editor which world they're in.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  productGrid: {
    label: "Product grid",
    fields: { heading: { type: "text" } },
    layouts: { grid: { label: "Grid" }, list: { label: "List" } },
    source: {
      kind: "external",
      label: "Square",
      settingsKey: "shop",
      settings: {
        categoryId: {
          type: "select",
          inline: false,
          label: "Category",
          options: [
            { value: "cat1", label: "Coffee" },
            { value: "cat2", label: "Merch" },
          ],
        },
        hiddenItemIds: {
          type: "select",
          inline: false,
          multiple: true,
          label: "Hidden items",
          options: [
            { value: "i1", label: "Item 1" },
            { value: "i2", label: "Item 2" },
          ],
        },
      },
    },
  },
};

/** A def whose ONLY knobs are its source settings — no fields, no layouts. The
 *  wrench must still appear, or the yellow ring leads nowhere. */
const SOURCE_ONLY: SectionCatalog = {
  mirror: {
    label: "Mirror",
    fields: { heading: { type: "text" } },
    source: {
      kind: "external",
      settingsKey: "shop",
      settings: { categoryId: { type: "select", inline: false, options: [] } },
    },
  },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(opts: { failPatch?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === "/louise-fragment") {
        return Promise.resolve(
          new Response(`<div data-louise-node="0">grid</div>`, {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        );
      }
      if (url === "/api/louise/settings" && method === "GET") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ settings: { shop: { categoryId: "cat1", hiddenItemIds: ["i2"] } } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url === "/api/louise/settings" && method === "PATCH") {
        return Promise.resolve(
          new Response(JSON.stringify(opts.failPatch ? { error: "nope" } : { ok: true }), {
            status: opts.failPatch ? 500 : 200,
            headers: { "content-type": "application/json" },
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
const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const click = (el: Element | null) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function pageHost(): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-louise-sections", "1");
  const sec = document.createElement("div");
  sec.setAttribute("data-louise-node", "0");
  sec.textContent = "grid";
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

function mount(host: HTMLElement, catalog = CATALOG, initial?: SectionItem[]) {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(host, {
    catalog,
    pageId: 1,
    initial: initial ?? [{ _type: "productGrid", heading: "Shop" }],
    autoSave: { debounceMs: 0 },
  });
}

const cog = () =>
  [...(document.querySelector(".louise-chrome-toolbar")?.querySelectorAll("button") ?? [])].find(
    (b) => b.getAttribute("aria-label") === "Layout & settings",
  ) ?? null;
const inspector = () => document.querySelector(".louise-inspector");

async function openInspector(host: HTMLElement) {
  over(host.querySelector('[data-louise-node="0"]') as Node);
  click(cog());
  await flush();
  await flush();
}

const settingsPatches = (calls: Call[]) =>
  calls.filter((c) => c.method === "PATCH" && c.url === "/api/louise/settings");
const draftPosts = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("external section — the source-settings group (#375)", () => {
  it("rings the section external and shows source settings alongside layout", async () => {
    stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await flush();

    const sec = host.querySelector('[data-louise-node="0"]') as HTMLElement;
    over(sec);
    expect(sec.getAttribute("data-louise-tone")).toBe("external");

    click(cog());
    await flush();
    await flush();

    // Two groups, both real: the mirror's knobs and the page-owned layout.
    expect(inspector()?.textContent).toContain("Square settings");
    expect(inspector()?.textContent).toContain("Save immediately");
    const layoutBtns = [...document.querySelectorAll(".louise-inspector-layouts .louise-btn")];
    expect(layoutBtns.map((b) => b.textContent)).toEqual(["Grid", "List"]);

    // Seeded from the settings route, not from the section item.
    const select = inspector()?.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("cat1");
    const boxes = [
      ...(inspector()?.querySelectorAll('input[type="checkbox"]') ?? []),
    ] as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true]); // i2 hidden
  });

  it("commits a source change to the settings route and never stages a draft", async () => {
    const calls = stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await flush();
    await openInspector(host);

    const select = inspector()?.querySelector("select") as HTMLSelectElement;
    select.value = "cat2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    // The merged object, whole — the settings route stores it under one key.
    expect(settingsPatches(calls).at(-1)?.body).toEqual({
      shop: { categoryId: "cat2", hiddenItemIds: ["i2"] },
    });
    // The page draft is NOT part of this write path.
    expect(draftPosts(calls)).toHaveLength(0);
    // The section re-renders through the fragment route so the canvas reflects
    // the new source config (the render reads settings server-side).
    expect(calls.some((c) => c.url === "/louise-fragment")).toBe(true);
  });

  it("toggles a multiple value as a string array", async () => {
    const calls = stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await flush();
    await openInspector(host);

    const first = inspector()?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    first.checked = true;
    first.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(settingsPatches(calls).at(-1)?.body).toEqual({
      shop: { categoryId: "cat1", hiddenItemIds: ["i2", "i1"] },
    });
  });

  it("keeps the wrench on a section whose only knobs are source settings", async () => {
    stubFetch();
    const host = pageHost();
    dispose = mount(host, SOURCE_ONLY, [{ _type: "mirror", heading: "M" }]);
    await flush();

    over(host.querySelector('[data-louise-node="0"]') as Node);
    expect(cog()).not.toBeNull();
  });

  it("shows the failure when a save doesn't take", async () => {
    stubFetch({ failPatch: true });
    const host = pageHost();
    dispose = mount(host);
    await flush();
    await openInspector(host);

    const select = inspector()?.querySelector("select") as HTMLSelectElement;
    select.value = "cat2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(inspector()?.querySelector(".louise-field-error")?.textContent).toContain(
      "hasn’t taken effect",
    );
  });
});
