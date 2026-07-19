// happy-dom coverage for the discriminated-array type-switcher (#182 Phase 0):
// the ⚙ inspector renders one "add" per variant and a per-item variant switch,
// and both shape each item as (shared itemFields ∪ the variant's fields ∪ the
// key). Array editing moved from the removed dock onto the inspector (#182), so
// each test opens the gear (hover the section → click ⚙) first.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  gallery: {
    label: "Gallery",
    fields: {
      // A discriminated array *field* — named `items`, not `blocks`: `blocks` is
      // reserved for the first-class block layer on `SectionItem` (ADR 0005).
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

/** Stub fetch, recording every call. GET answers the versions load; a structural
 *  change POSTs the draft (then the dock would `location.reload()`, stubbed off). */
function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
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

// A host carrying one on-canvas section element (`data-louise-section`), so the
// chrome can attach its toolbar and the ⚙ can open the inspector for it.
function mount(initial: SectionItem[]): () => void {
  const el = document.createElement("div");
  el.setAttribute("data-louise-sections", "1");
  const sec = document.createElement("div");
  sec.setAttribute("data-louise-section", "0");
  sec.textContent = "Gallery";
  el.appendChild(sec);
  document.body.appendChild(el);
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(el, { catalog: CATALOG, pageId: 1, initial });
}

const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const click = (el: Element | null) => el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const cog = () =>
  [
    ...(document
      .querySelector(".louise-chrome-toolbar:not(.louise-block-toolbar)")
      ?.querySelectorAll("button") ?? []),
  ].find((b) => b.textContent === "⚙") ?? null;
/** Hover the section and click its ⚙ to open the inspector (where the array UI —
 *  per-variant add buttons + per-item switcher — now lives). */
const openInspector = () => {
  over(document.querySelector("[data-louise-section]") as Node);
  click(cog());
};

const draftItems = (calls: Call[]): Record<string, unknown>[] => {
  const post = calls.find((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions");
  return (post?.body as { sections: Array<{ items?: Record<string, unknown>[] }> }).sections[0]
    .items as Record<string, unknown>[];
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

describe("mountSections — discriminated array type-switcher (#182 Phase 0)", () => {
  it("renders one labelled add button per variant", () => {
    stubFetch();
    dispose = mount([{ _type: "gallery", items: [] }]);
    openInspector();
    const adds = [...document.querySelectorAll<HTMLButtonElement>(".louise-variant-add button")];
    expect(adds).toHaveLength(2);
    expect(adds.map((b) => b.textContent?.trim())).toEqual(["Image", "Quote"]);
  });

  it("adding a variant appends an item shaped as base ∪ variant fields + the key", async () => {
    const calls = stubFetch();
    dispose = mount([{ _type: "gallery", items: [] }]);
    openInspector();
    const imageAdd = [
      ...document.querySelectorAll<HTMLButtonElement>(".louise-variant-add button"),
    ].find((b) => b.textContent?.includes("Image"));
    imageAdd?.click();
    await flush();

    expect(draftItems(calls)).toEqual([{ caption: "", url: "", kind: "image" }]);
    // The new item now carries the variant switcher, set to its variant.
    expect(
      (document.querySelector(".louise-variant-switch") as unknown as HTMLSelectElement | null)
        ?.value,
    ).toBe("image");
  });

  it("switching a variant keeps shared fields and swaps in the new variant's blanks", async () => {
    const calls = stubFetch();
    dispose = mount([
      { _type: "gallery", items: [{ kind: "image", caption: "keep", url: "/media/x" }] },
    ]);
    openInspector();
    const sw = document.querySelector(
      ".louise-variant-switch",
    ) as unknown as HTMLSelectElement | null;
    if (!sw) throw new Error("no variant switcher rendered");
    expect(sw.value).toBe("image");
    sw.value = "quote";
    sw.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    // caption (shared) survives; url (image-only) is dropped; quote fields added.
    expect(draftItems(calls)[0]).toEqual({ caption: "keep", text: "", author: "", kind: "quote" });
  });
});
