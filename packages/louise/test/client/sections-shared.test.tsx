// The shared-value (green) editor (ADR 0010 Phase B / #376).
//
// A `data-louise-node="settings.<key>"` marker — stamped wherever a site
// renders a shared settings value: the Nav, the Footer, a location panel — is
// different in kind from every other node: its truth lives in the settings
// table, one value with many surfaces, and there is no settings draft. So its
// chrome is green and wrench-only, its inspector shows the used-in count and
// the save-immediately band persistently, and its writes PATCH the settings
// route — never the page draft.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  hero: { label: "Hero", fields: { heading: { type: "text" } } },
  // The declared coupling (spec §3 approach A): this type READS settings.phone
  // when it renders, which is what the used-in count is built from.
  locationHours: { label: "Location & hours", fields: {}, consumes: ["phone"] },
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
      if (url === "/api/louise/settings" && method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify({ settings: { phone: "918-555-0101" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
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
      if (url === "/api/louise/pages") {
        // Three pages; two contain a consuming type. One stores sections as a
        // JSON string (the D1 shape), one as an array — both must count.
        return Promise.resolve(
          new Response(
            JSON.stringify({
              pages: [
                { slug: "a", title: "A", sections: JSON.stringify([{ _type: "locationHours" }]) },
                { slug: "b", title: "B", sections: [{ _type: "hero" }] },
                { slug: "c", title: "C", sections: [{ _type: "locationHours" }] },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
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
const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const click = (el: Element | null) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

/** The host holds a section; the phone renders TWICE outside it (desktop +
 *  mobile nav — the shape that decided "surfaces", not DOM occurrences). */
function page(): { host: HTMLElement; phones: HTMLElement[] } {
  const host = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-node", "0");
  host.appendChild(sec);
  const phones = [0, 1].map(() => {
    const el = document.createElement("span");
    el.setAttribute("data-louise-node", "settings.phone");
    el.textContent = "918-555-0101";
    document.body.appendChild(el);
    return el;
  });
  document.body.appendChild(host);
  return { host, phones };
}

function mount(host: HTMLElement) {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(host, {
    catalog: CATALOG,
    pageId: 1,
    initial: [{ _type: "hero", heading: "Hi" }] as SectionItem[],
    autoSave: { debounceMs: 0 },
    shared: {
      phone: { type: "text", label: "Phone number", surfaces: ["the header"] },
    },
  });
}

const toolbar = () => document.querySelector(".louise-chrome-toolbar");
const visibleButtons = () =>
  [...(toolbar()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .filter((b) => b.style.display !== "none")
    .map((b) => b.getAttribute("aria-label"));
const inspector = () => document.querySelector(".louise-inspector");
const band = () => inspector()?.querySelector(".louise-shared-band");
const settingsPatches = (calls: Call[]) =>
  calls.filter((c) => c.method === "PATCH" && c.url === "/api/louise/settings");
const draftPosts = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions");

async function openShared(el: HTMLElement) {
  over(el);
  click(
    [...(toolbar()?.querySelectorAll("button") ?? [])].find(
      (b) => b.getAttribute("aria-label") === "Phone number",
    ) ?? null,
  );
  await flush();
  await flush();
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

describe("shared values — the green editor (#376)", () => {
  it("rings a declared settings marker green and wrench-only, outside the host", async () => {
    stubFetch();
    const { host, phones } = page();
    dispose = mount(host);
    await flush();

    over(phones[0]);
    expect(phones[0].getAttribute("data-louise-tone")).toBe("shared");
    expect(toolbar()?.getAttribute("data-louise-tone")).toBe("shared");
    // No move/delete/add — one value, one wrench, named after the thing.
    expect(visibleButtons()).toEqual(["Phone number"]);
  });

  it("treats an undeclared settings key as unmarked", async () => {
    stubFetch();
    const { host } = page();
    const stray = document.createElement("span");
    stray.setAttribute("data-louise-node", "settings.nope");
    document.body.appendChild(stray);
    dispose = mount(host);
    await flush();

    over(stray);
    expect(document.querySelector(".louise-node-active")).toBeNull();
  });

  it("opens on the source value with the used-in count and the warning band", async () => {
    stubFetch();
    const { host, phones } = page();
    dispose = mount(host);
    await flush();
    await openShared(phones[0]);

    expect(inspector()?.querySelector(".louise-inspector-title")?.textContent).toBe("Phone number");
    // Static chrome surface + the two consuming pages (one JSON-string, one
    // array — both shapes count), phrased for a human.
    expect(band()?.textContent).toBe(
      "Used in the header and 2 pages — saves immediately, everywhere.",
    );
    const input = inspector()?.querySelector("input.louise-input") as HTMLInputElement;
    expect(input.value).toBe("918-555-0101");
  });

  it("PATCHes the settings route, never the draft, and syncs every marker", async () => {
    const calls = stubFetch();
    const { host, phones } = page();
    dispose = mount(host);
    await flush();
    await openShared(phones[0]);

    const input = inspector()?.querySelector("input.louise-input") as HTMLInputElement;
    input.value = "918-555-0202";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(settingsPatches(calls).at(-1)?.body).toEqual({ phone: "918-555-0202" });
    expect(draftPosts(calls)).toHaveLength(0);
    // BOTH occurrences update — the Nav renders the value twice, and syncing
    // one would leave the page lying about the other.
    expect(phones.map((p) => p.textContent)).toEqual(["918-555-0202", "918-555-0202"]);
  });

  it("keeps the optimistic value on screen WITH the error when a save fails", async () => {
    stubFetch({ failPatch: true });
    const { host, phones } = page();
    dispose = mount(host);
    await flush();
    await openShared(phones[0]);

    const input = inspector()?.querySelector("input.louise-input") as HTMLInputElement;
    input.value = "changed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(input.value).toBe("changed");
    expect(inspector()?.querySelector(".louise-field-error")?.textContent).toContain(
      "hasn’t taken effect",
    );
    // And the on-page markers did NOT sync — the save didn't happen.
    expect(phones[0].textContent).toBe("918-555-0101");
  });
});
