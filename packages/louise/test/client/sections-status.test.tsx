// The sections bar's status and failures (#468): "Saving…" then "Draft saved",
// each failure worded for its action with Try again, a slow add that says so,
// and where a keyboard move landed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatNodePath, type NodePath } from "../../src/client/node.js";
import { mountNodeChrome } from "../../src/client/node-chrome.js";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  promo: { label: "Promo", fields: { heading: { type: "text" } } },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Handler = (url: string, method: string) => Response | Promise<Response>;
function stubFetch(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) =>
      Promise.resolve(handler(String(input), (init?.method ?? "GET").toUpperCase())),
    ),
  );
}

function pageHost(): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-louise-sections", "1");
  const sec = document.createElement("div");
  sec.setAttribute("data-louise-node", "0");
  const h = document.createElement("h2");
  h.setAttribute("data-louise-node", "0.heading");
  h.textContent = "Sec 0";
  sec.appendChild(h);
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

let dispose: (() => void) | undefined;
function mount(initial: SectionItem[] = [{ _type: "promo", heading: "Sec 0" }], autoSave = true) {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const host = pageHost();
  dispose = mountSections(host, {
    catalog: CATALOG,
    pageId: 1,
    initial,
    autoSave: autoSave ? { debounceMs: 0 } : false,
  });
  return host;
}

const status = () => document.querySelector('.louise-status[role="status"]')?.textContent ?? "";
const alertText = () =>
  document.querySelector('.louise-sections-status[role="alert"]')?.textContent ?? "";
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  );
const typeHeading = (host: HTMLElement, text: string) => {
  const el = host.querySelector<HTMLElement>('[data-louise-node="0.heading"]')!;
  el.textContent = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the sections bar's regions", () => {
  it("keeps the status and the alert in the page at rest", async () => {
    stubFetch(() => jsonResponse({ versions: [] }));
    mount();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(status()).toBe("");
    expect(alertText()).toBe("");
  });

  it("says a save failed in words for a save, and Try again saves", async () => {
    let fail = true;
    stubFetch((_url, method) => {
      if (method === "GET") return jsonResponse({ versions: [] });
      return fail
        ? jsonResponse({ error: "D1_ERROR: disk" }, 500)
        : jsonResponse({ buffered: true });
    });
    const host = mount();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    typeHeading(host, "Changed");
    await vi.waitFor(() =>
      expect(alertText()).toBe("Couldn’t save your draft. Your edits are still here."),
    );
    // A 5xx's own text is internals, so it isn't shown.
    expect(alertText()).not.toContain("D1_ERROR");

    fail = false;
    button("Try again")!.click();
    await vi.waitFor(() => expect(status()).toBe("Draft saved"));
    expect(alertText()).toBe("");
    expect(button("Try again")).toBeUndefined();
  });

  it("says a publish failed in words for a publish, with the server's reason", async () => {
    stubFetch((url, method) => {
      if (method === "GET") return jsonResponse({ versions: [{ id: 3, status: "draft" }] });
      if (url.endsWith("/publish")) {
        return jsonResponse(
          { error: "Invalid", violations: [{ message: "Hero needs a heading." }] },
          422,
        );
      }
      return jsonResponse({ buffered: true });
    });
    mount(undefined, false);
    await vi.waitFor(() =>
      expect(document.querySelector(".louise-publish")?.getAttribute("aria-disabled")).toBe(
        "false",
      ),
    );
    document.querySelector<HTMLButtonElement>(".louise-publish")!.click();
    await vi.waitFor(() =>
      expect(alertText()).toBe(
        "Couldn’t publish. The live page hasn’t changed. Hero needs a heading.",
      ),
    );
  });

  it("says a slow add is under way, and clears it when the section lands", async () => {
    let finish: (r: Response) => void = () => {};
    stubFetch((url, method) => {
      if (method === "GET") return jsonResponse({ versions: [] });
      if (url === "/louise-fragment") {
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return jsonResponse({ buffered: true });
    });
    mount();
    await vi.waitFor(() => expect(document.querySelector(".louise-sections-add")).not.toBeNull());
    button("Add section")!.click();
    await vi.waitFor(() => expect(document.querySelector(".louise-slash-item")).not.toBeNull());
    document.querySelector<HTMLButtonElement>(".louise-slash-item")!.click();
    await vi.waitFor(() => expect(status()).toBe("Adding section…"), { timeout: 2000 });

    finish(
      new Response('<div data-louise-node="0"><h2 data-louise-node="0.heading">New</h2></div>', {
        headers: { "content-type": "text/html" },
      }),
    );
    await vi.waitFor(() => expect(status()).not.toBe("Adding section…"));
  });
});

describe("a keyboard move says where the node landed", () => {
  it("announces the new position", () => {
    const a = document.createElement("div");
    a.setAttribute("data-louise-node", "0");
    const b = document.createElement("div");
    b.setAttribute("data-louise-node", "1");
    document.body.appendChild(a);
    document.body.appendChild(b);
    // The move re-stamps the markers, as the editor does.
    const onMove = (_path: NodePath, delta: number) => {
      if (delta === 1) {
        a.setAttribute("data-louise-node", "1");
        b.setAttribute("data-louise-node", "0");
      }
    };
    dispose = mountNodeChrome({
      resolve: (path) => ({
        ordered: { index: Number(formatNodePath(path)), count: 2 },
        tone: "section",
        label: "Hero",
      }),
      onMove,
      onDelete: () => {},
      onAddSibling: () => {},
      onAddChild: () => {},
      onInspect: () => {},
    });
    a.focus();
    a.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
    const announcer = [...document.querySelectorAll('[role="status"].louise-sr-only')].pop();
    expect(announcer?.textContent).toBe("Hero moved to position 2 of 2");
  });
});
