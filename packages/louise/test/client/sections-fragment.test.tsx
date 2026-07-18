// happy-dom coverage for the fragment-render add path (#182 Phase 3): "+ Add
// section" no longer save-and-reloads — it POSTs the new item to /louise-fragment,
// splices the returned server-rendered HTML into the page in place, re-stamps it
// to the target index, wires its inline fields, and stages a draft via autosave.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  promo: { label: "Promo", fields: { heading: { type: "text" } } },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** GET → versions; POST /louise-fragment → a canned section fragment (as the
 *  Astro partial route would render it, stamped at index 0); POST /versions → ack. */
function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === "/louise-fragment") {
        return Promise.resolve(
          new Response(
            '<div data-louise-section="0"><h2 data-louise-sfield="0.heading">New</h2></div>',
            { status: 200, headers: { "content-type": "text/html" } },
          ),
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

/** The `[data-louise-sections]` container with `n` existing marked sections. */
function pageHost(n: number): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-louise-sections", "1");
  for (let i = 0; i < n; i++) {
    const sec = document.createElement("div");
    sec.setAttribute("data-louise-section", String(i));
    const h = document.createElement("h2");
    h.setAttribute("data-louise-sfield", `${i}.heading`);
    h.textContent = `Sec ${i}`;
    sec.appendChild(h);
    host.appendChild(sec);
  }
  document.body.appendChild(host);
  return host;
}

function mount(host: HTMLElement, initial: SectionItem[]): () => void {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(host, { catalog: CATALOG, pageId: 1, initial, autoSave: { debounceMs: 0 } });
}

const sectionMarkers = (host: HTMLElement) =>
  [...host.querySelectorAll("[data-louise-section]")].map((s) =>
    s.getAttribute("data-louise-section"),
  );
const click = (el: Element | null) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountSections — fragment-render add (#182 Phase 3)", () => {
  it("splices a server-rendered section in place instead of reloading", async () => {
    const calls = stubFetch();
    const host = pageHost(1); // one existing section
    dispose = mount(host, [{ _type: "promo", heading: "Sec 0" }]);
    await flush();

    // Open the add palette, then choose the section type.
    click(document.querySelector(".louise-sections-add .louise-btn-block"));
    await flush();
    click(document.querySelector(".louise-sections-palette .louise-slash-item"));
    await flush();
    await flush();

    // The fragment route was asked to render the new item...
    const fragCall = calls.find((c) => c.url === "/louise-fragment" && c.method === "POST");
    expect((fragCall?.body as { item?: { _type?: string } })?.item?._type).toBe("promo");

    // ...and its HTML was spliced in (2 sections now, re-stamped 0..1), no reload.
    expect(sectionMarkers(host)).toEqual(["0", "1"]);
    expect(host.querySelectorAll("[data-louise-section]")[1].textContent).toContain("New");
    expect(window.location.reload).not.toHaveBeenCalled();

    // A draft was staged for the new shape.
    const draft = calls.find(
      (c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions",
    );
    expect((draft?.body as { sections?: SectionItem[] })?.sections).toHaveLength(2);
  });

  it("falls back to save-and-reload when the fragment route fails", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
        if (url === "/louise-fragment")
          return Promise.resolve(new Response("nope", { status: 500 }));
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
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const host = pageHost(1);
    dispose = mountSections(host, {
      catalog: CATALOG,
      pageId: 1,
      initial: [{ _type: "promo", heading: "Sec 0" }],
      autoSave: { debounceMs: 0 },
    });
    await flush();

    click(document.querySelector(".louise-sections-add .louise-btn-block"));
    await flush();
    click(document.querySelector(".louise-sections-palette .louise-slash-item"));
    await flush();
    await flush();

    // Fragment failed → the draft is saved and the page reloads (item not lost).
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions")).toBe(
      true,
    );
    expect(reload).toHaveBeenCalled();
  });
});
