// happy-dom coverage for the inspector popover (#182 Phase 4 / ADR 0005 §5): the
// ⚙ on the section chrome opens a contextual popover with a layout picker + a
// settings form; picking a layout / editing a setting updates the store, re-renders
// the section through the fragment route, and stages a draft.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  panel: {
    label: "Panel",
    fields: { heading: { type: "text" } },
    layouts: { wide: { label: "Wide" }, boxed: { label: "Boxed" } },
    settings: { background: { type: "text", inline: false } },
  },
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
      if (url === "/louise-fragment") {
        const item = (body as { item?: { _layout?: string } })?.item;
        return Promise.resolve(
          new Response(
            `<div data-louise-section="0" data-layout="${item?._layout ?? ""}">panel</div>`,
            {
              status: 200,
              headers: { "content-type": "text/html" },
            },
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

function pageHost(): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-louise-sections", "1");
  const sec = document.createElement("div");
  sec.setAttribute("data-louise-section", "0");
  const h = document.createElement("h2");
  h.setAttribute("data-louise-sfield", "0.heading");
  h.textContent = "Panel";
  sec.appendChild(h);
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

function mount(host: HTMLElement): () => void {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(host, {
    catalog: CATALOG,
    pageId: 1,
    initial: [{ _type: "panel", heading: "Panel" }],
    autoSave: { debounceMs: 0 },
  });
}

const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const click = (el: Element | null) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const sectionToolbar = () =>
  document.querySelector(".louise-chrome-toolbar:not(.louise-block-toolbar)");
const cog = () =>
  [...(sectionToolbar()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "⚙") ??
  null;
const inspector = () => document.querySelector(".louise-inspector");
const lastDraft = (calls: Call[]) => {
  const post = calls
    .filter((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions")
    .at(-1);
  return (post?.body as { sections?: SectionItem[] } | undefined)?.sections?.[0];
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

describe("mountSections — inspector popover (#182 Phase 4)", () => {
  it("opens from the section ⚙ and shows the layouts + settings", async () => {
    stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await flush();

    expect(inspector()).toBeNull();
    over(host.querySelector("h2") as Node); // hover the section → toolbar
    click(cog());
    await flush();

    expect(inspector()).not.toBeNull();
    const layoutBtns = [...document.querySelectorAll(".louise-inspector-layouts .louise-btn")];
    expect(layoutBtns.map((b) => b.textContent)).toEqual(["Wide", "Boxed"]);
    expect(document.querySelector(".louise-inspector .louise-input")).not.toBeNull(); // background
  });

  it("picking a layout re-renders the section and stages the token", async () => {
    const calls = stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await flush();
    over(host.querySelector("h2") as Node);
    click(cog());
    await flush();

    const boxed = [...document.querySelectorAll(".louise-inspector-layouts .louise-btn")].find(
      (b) => b.textContent === "Boxed",
    );
    click(boxed as Element);
    await flush();
    await flush();

    // Re-rendered through the fragment route with the new token, swapped in place.
    const frag = calls.find((c) => c.url === "/louise-fragment" && c.method === "POST");
    expect((frag?.body as { item?: { _layout?: string } })?.item?._layout).toBe("boxed");
    expect(host.querySelector("[data-louise-section]")?.getAttribute("data-layout")).toBe("boxed");
    // Staged in the draft.
    expect((lastDraft(calls) as { _layout?: string })?._layout).toBe("boxed");
  });

  it("editing a setting stages it under _settings and re-renders on commit", async () => {
    const calls = stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await flush();
    over(host.querySelector("h2") as Node);
    click(cog());
    await flush();

    const input = document.querySelector(".louise-inspector .louise-input") as HTMLInputElement;
    input.value = "dark";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true })); // commit → re-render
    await flush();
    await flush();

    expect(
      (lastDraft(calls) as { _settings?: { background?: string } })?._settings?.background,
    ).toBe("dark");
    expect(calls.some((c) => c.url === "/louise-fragment" && c.method === "POST")).toBe(true);
  });

  it("closes on the scrim / close button", async () => {
    stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await flush();
    over(host.querySelector("h2") as Node);
    click(cog());
    await flush();
    expect(inspector()).not.toBeNull();

    click(document.querySelector(".louise-inspector-scrim"));
    await flush();
    expect(inspector()).toBeNull();
  });
});
