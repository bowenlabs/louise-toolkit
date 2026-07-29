// The `link` + `toggle` inspector fields (coracle.coffee#38).
//
// A destination has no visible text node to click, so it's always wrench-edited.
// Before this it rendered as a bare text input; now it gets a page picker fed by
// BOTH the `pages` API and the site's code-defined routes — the latter matter
// because a site's most-linked destinations (`/shop`, `/contact`) have no `pages`
// row, so a picker without them is missing exactly what editors reach for.

import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLinkFieldCache } from "../../src/client/link-field.jsx";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  cta: {
    label: "CTA",
    fields: {
      label: { type: "text" },
      href: { type: "link", label: "Button link", inline: false },
      newTab: { type: "toggle", label: "Open in new tab", inline: false },
    },
  },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(pages: Array<{ slug: string; title: string }> = []): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === "/louise-fragment") {
        return Promise.resolve(
          new Response(`<div data-louise-node="0">cta</div>`, {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        );
      }
      if (url === "/api/louise/pages") {
        return Promise.resolve(
          new Response(JSON.stringify({ pages }), {
            status: 200,
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

/** The section, with its CTA marked as a VALUE node in its own right — a field
 *  path rather than a container path (ADR 0010). */
function pageHost(): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-louise-sections", "1");
  const sec = document.createElement("div");
  sec.setAttribute("data-louise-node", "0");
  const a = document.createElement("span");
  a.setAttribute("data-louise-node", "0.href");
  a.setAttribute("data-louise-sfield", "0.label");
  a.textContent = "Shop";
  sec.appendChild(a);
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
}

function mount(host: HTMLElement, builtInRoutes?: { path: string; title: string }[]) {
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(host, {
    catalog: CATALOG,
    pageId: 1,
    initial: [{ _type: "cta", label: "Shop", href: "/shop" }],
    autoSave: { debounceMs: 0 },
    ...(builtInRoutes ? { builtInRoutes } : {}),
  });
}

const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const click = (el: Element | null) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const cog = () =>
  [
    ...(document
      .querySelector(".louise-chrome-toolbar:not(.louise-block-toolbar)")
      ?.querySelectorAll("button") ?? []),
  ].find((b) => b.getAttribute("aria-label") === "Layout & settings") ?? null;
const inspector = () => document.querySelector(".louise-inspector");
const linkSelect = () =>
  (inspector()?.querySelector('select[aria-label="Link to a page"]') ??
    null) as HTMLSelectElement | null;
const linkInput = () =>
  (inspector()?.querySelector('input[aria-label="Button link"]') ??
    null) as HTMLInputElement | null;
const toggle = () =>
  (inspector()?.querySelector('input[type="checkbox"]') ?? null) as HTMLInputElement | null;
const optionValues = () =>
  [...(linkSelect()?.querySelectorAll("option") ?? [])].map((o) => (o as HTMLOptionElement).value);
const lastDraft = (calls: Call[]) => {
  const post = calls
    .filter((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions")
    .at(-1);
  return (post?.body as { sections?: SectionItem[] } | undefined)?.sections?.[0];
};

/** Open the wrench on a node — the section by default, or any deeper path. */
async function openInspector(host: HTMLElement, path = "0") {
  over(host.querySelector(`[data-louise-node="${path}"]`) as Node);
  click(cog());
  await flush();
  await flush();
}
const title = () => inspector()?.querySelector(".louise-inspector-title")?.textContent;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  resetLinkFieldCache(); // module-level page cache would leak across cases
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inspector — link field", () => {
  it("renders a URL input seeded with the current destination", async () => {
    stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host);

    expect(linkInput()?.value).toBe("/shop");
  });

  it("offers code-defined routes the pages API doesn't know about", async () => {
    stubFetch([{ slug: "about", title: "About" }]);
    const host = pageHost();
    dispose = mount(host, [
      { path: "/shop", title: "Shop" },
      { path: "/contact", title: "Contact" },
    ]);
    await openInspector(host);

    // Built-ins lead, then DB pages. Without the built-ins this picker would be
    // missing the destinations a site links to most.
    expect(optionValues()).toEqual(["", "/shop", "/contact", "/about"]);
  });

  it("still renders the picker from DB pages alone when no routes are registered", async () => {
    stubFetch([{ slug: "about", title: "About" }]);
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host);

    expect(optionValues()).toEqual(["", "/about"]);
  });

  it("degrades to the URL field alone when the pages list can't be fetched", async () => {
    stubFetch(); // no pages, and no built-ins registered
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host);

    // An editor can still type a destination — the important half.
    expect(linkSelect()).toBeNull();
    expect(linkInput()).not.toBeNull();
  });

  it("writes the picked page into the store and stages a draft", async () => {
    const calls = stubFetch([{ slug: "about", title: "About" }]);
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host);

    const sel = linkSelect() as HTMLSelectElement;
    sel.value = "/about";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();

    expect(lastDraft(calls)?.href).toBe("/about");
  });

  it("writes a typed URL on change, not on every keystroke", async () => {
    const calls = stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host);

    const input = linkInput() as HTMLInputElement;
    input.value = "https://example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    // NOTHING staged at all — committing per keystroke would re-render the section
    // through the fragment route mid-word and yank the input from under the cursor.
    expect(lastDraft(calls)).toBeUndefined();
    expect(calls.some((c) => c.url === "/louise-fragment")).toBe(false);

    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();
    expect(lastDraft(calls)?.href).toBe("https://example.com");
  });
});

// ADR 0010, "Resolved while building A1". A CTA's wrench used to open its owning
// section's whole panel: live QA on 2026-07-28 showed clicking one of HomeHero's
// four CTAs surfacing every link-ish field the section had, with nothing to say
// which one belonged to the button just clicked.
describe("inspector — a value node scopes to its own field", () => {
  it("shows the field the node addresses, and none of its owner's others", async () => {
    stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host, "0.href");

    expect(linkInput()?.value).toBe("/shop");
    expect(title()).toBe("Button link");
    // `newTab` is on the same section and would be in the section's own panel.
    expect(toggle()).toBeNull();
  });

  it("still opens the whole section from the section's own wrench", async () => {
    stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host);

    expect(title()).toBe("CTA");
    expect(linkInput()).not.toBeNull();
    expect(toggle()).not.toBeNull();
  });

  it("writes through to the same store path the container's panel would", async () => {
    const calls = stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host, "0.href");

    const input = linkInput() as HTMLInputElement;
    input.value = "/pricing";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();

    // The value lives on the OWNING item — a value node addresses a field, it
    // doesn't own one.
    expect(lastDraft(calls)?.href).toBe("/pricing");
  });
});

describe("inspector — toggle field", () => {
  it("stages a real boolean, not a string", async () => {
    const calls = stubFetch();
    const host = pageHost();
    dispose = mount(host);
    await openInspector(host);

    const box = toggle() as HTMLInputElement;
    expect(box.checked).toBe(false); // absent reads as off
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();

    expect(lastDraft(calls)?.newTab).toBe(true);
  });
});
