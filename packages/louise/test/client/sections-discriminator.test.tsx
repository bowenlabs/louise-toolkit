// happy-dom coverage for the discriminated-array type-switcher (#182 Phase 0):
// the dock renders one "add" per variant and a per-item variant switch, and both
// shape each item as (shared itemFields ∪ the variant's fields ∪ the key).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  gallery: {
    label: "Gallery",
    fields: {
      blocks: {
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

function mount(initial: SectionItem[]): () => void {
  const el = document.createElement("div");
  document.body.appendChild(el);
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  return mountSections(el, { catalog: CATALOG, pageId: 1, initial });
}

const draftBlocks = (calls: Call[]): Record<string, unknown>[] => {
  const post = calls.find((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions");
  return (post?.body as { sections: Array<{ blocks?: Record<string, unknown>[] }> }).sections[0]
    .blocks as Record<string, unknown>[];
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.querySelectorAll("div, .louise-sections-dock").forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountSections — discriminated array type-switcher (#182 Phase 0)", () => {
  it("renders one labelled add button per variant", () => {
    stubFetch();
    dispose = mount([{ _type: "gallery", blocks: [] }]);
    const adds = [...document.querySelectorAll<HTMLButtonElement>(".louise-variant-add button")];
    expect(adds).toHaveLength(2);
    expect(adds.map((b) => b.textContent?.trim())).toEqual(["Image", "Quote"]);
  });

  it("adding a variant appends an item shaped as base ∪ variant fields + the key", async () => {
    const calls = stubFetch();
    dispose = mount([{ _type: "gallery", blocks: [] }]);
    const imageAdd = [
      ...document.querySelectorAll<HTMLButtonElement>(".louise-variant-add button"),
    ].find((b) => b.textContent?.includes("Image"));
    imageAdd?.click();
    await flush();

    expect(draftBlocks(calls)).toEqual([{ caption: "", url: "", kind: "image" }]);
    // The new item now carries the variant switcher, set to its variant.
    expect(
      (document.querySelector(".louise-variant-switch") as unknown as HTMLSelectElement | null)
        ?.value,
    ).toBe("image");
  });

  it("switching a variant keeps shared fields and swaps in the new variant's blanks", async () => {
    const calls = stubFetch();
    dispose = mount([
      { _type: "gallery", blocks: [{ kind: "image", caption: "keep", url: "/media/x" }] },
    ]);
    const sw = document.querySelector(
      ".louise-variant-switch",
    ) as unknown as HTMLSelectElement | null;
    if (!sw) throw new Error("no variant switcher rendered");
    expect(sw.value).toBe("image");
    sw.value = "quote";
    sw.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    // caption (shared) survives; url (image-only) is dropped; quote fields added.
    expect(draftBlocks(calls)[0]).toEqual({ caption: "keep", text: "", author: "", kind: "quote" });
  });
});
