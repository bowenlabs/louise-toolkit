// happy-dom coverage for swap-type via the fragment route (#182 Phase 3): the
// dock's variant type-switcher no longer save-and-reloads — it swaps the item's
// variant in the store and re-renders the whole section in place through
// /louise-fragment (the same seam as block add / array item add-remove).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  gallery: {
    label: "Gallery",
    fields: {
      items: {
        type: "array",
        itemLabel: "Block",
        itemFields: { caption: { type: "text" } },
        discriminator: {
          key: "kind",
          variants: {
            image: { url: { type: "image" } },
            quote: { text: { type: "textarea" }, author: { type: "text" } },
          },
          variantsAdmin: { image: { label: "Image" }, quote: { label: "Quote" } },
        },
      },
    },
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
        // Re-render marker keyed to the item's current variant, so the swap is
        // observable after the in-place replace.
        const kind = (body as { item?: { items?: Array<{ kind?: string }> } })?.item?.items?.[0]
          ?.kind;
        return Promise.resolve(
          new Response(`<div data-louise-section="0" data-kind="${kind}">re-rendered</div>`, {
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

/** A rendered-page host carrying the gallery section marker (index 0). */
function pageHost(): HTMLElement {
  const host = document.createElement("div");
  const sec = document.createElement("div");
  sec.setAttribute("data-louise-section", "0");
  sec.setAttribute("data-kind", "image");
  host.appendChild(sec);
  document.body.appendChild(host);
  return host;
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

describe("mountSections — swap-type via the fragment route (#182 Phase 3)", () => {
  it("re-renders the section in place on a variant switch, no reload", async () => {
    const calls = stubFetch();
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const host = pageHost();
    const initial: SectionItem[] = [
      { _type: "gallery", items: [{ kind: "image", caption: "keep", url: "/media/x" }] },
    ];
    dispose = mountSections(host, {
      catalog: CATALOG,
      pageId: 1,
      initial,
      autoSave: { debounceMs: 0 },
    });
    await flush();

    const sw = document.querySelector(".louise-variant-switch") as unknown as HTMLSelectElement;
    if (!sw) throw new Error("no variant switcher");
    sw.value = "quote";
    sw.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();

    // The section was re-rendered through the fragment route with the new variant...
    const frag = calls.find((c) => c.url === "/louise-fragment" && c.method === "POST");
    expect(
      (frag?.body as { item?: { items?: Array<{ kind?: string }> } })?.item?.items?.[0]?.kind,
    ).toBe("quote");

    // ...and swapped in place (no reload).
    expect(host.querySelector("[data-louise-section]")?.getAttribute("data-kind")).toBe("quote");
    expect(host.querySelector("[data-louise-section]")?.textContent).toBe("re-rendered");
    expect(reload).not.toHaveBeenCalled();

    // A draft was staged for the new shape.
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions")).toBe(
      true,
    );
  });
});
