// Behavior coverage for the inspector popover in src/client/sections.tsx (#695):
// the non-inline field widgets (text, textarea, image, toggle, fetched select),
// array membership, block targets, the block picker, block undo, and the
// shared-value and source-settings panels' failure paths.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockCatalog } from "../../src/core/content/sections.js";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  card: {
    label: "Card",
    fields: {
      heading: { type: "text" },
      subtitle: { type: "text", inline: false, label: "Subtitle" },
      body: { type: "textarea", inline: false, label: "Body" },
      photo: { type: "image", label: "Photo" },
      tone: {
        type: "select",
        inline: false,
        label: "Tone",
        options: () => Promise.reject(new Error("Couldn’t reach the catalog")),
      },
      words: {
        type: "array",
        inline: false,
        itemLabel: "Word",
        itemFields: { word: { type: "text" } },
      },
      points: { type: "array", itemFields: { text: { type: "text" } } },
      tiles: {
        type: "array",
        label: "Tiles",
        itemFields: { caption: { type: "text" } },
        discriminator: {
          key: "kind",
          variants: { photo: { src: { type: "text" } }, note: { body: { type: "text" } } },
          variantsAdmin: { photo: { label: "Photo tile", icon: "ph ph-image" } },
        },
      },
    },
  },
  grid: {
    label: "Grid",
    fields: {},
    layouts: { wide: { label: "Wide" }, boxed: { label: "Boxed" } },
    blocks: { allow: ["feature", "quote"] },
  },
  plain: { label: "Plain", fields: { heading: { type: "text" } } },
};

const BLOCKS: BlockCatalog = {
  feature: {
    label: "Feature",
    fields: {
      name: { type: "text" },
      newTab: { type: "toggle", label: "Open in a new tab" },
    },
    settings: { align: { type: "text", inline: false, label: "Align" } },
  },
  quote: { label: "Quote", fields: {} },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

type Reply = Response | Promise<Response> | undefined;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Render a posted item the way a site's partial would: the section, a heading,
 *  and one marked card per block. */
function fragment(item: SectionItem | undefined): Response {
  const blocks = Array.isArray(item?.blocks) ? (item.blocks as SectionItem[]) : [];
  const cards = blocks
    .map(
      (b, j) =>
        `<article data-louise-node="0.blocks.${j}"><h3 data-louise-node="0.blocks.${j}.name">${String(b.name ?? "")}</h3></article>`,
    )
    .join("");
  return new Response(
    `<section data-louise-node="0"><h2 data-louise-node="0.heading">${String(item?.heading ?? "")}</h2>${cards}</section>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

function stubFetch(reply: (c: Call) => Reply = () => undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const raw = init?.body;
      const body = typeof raw === "string" ? JSON.parse(raw) : raw;
      const call = { url, method, body };
      calls.push(call);
      const custom = reply(call);
      if (custom) return Promise.resolve(custom);
      if (url === "/louise-fragment") {
        return Promise.resolve(fragment((body as { item?: SectionItem })?.item));
      }
      if (url === "/api/louise/settings") return Promise.resolve(json({ settings: {} }));
      if (method === "GET")
        return Promise.resolve(json({ versions: [], publishedVersionId: null }));
      if (url.endsWith("/versions")) return Promise.resolve(json({ version: { id: 2 } }));
      return Promise.resolve(json({ ok: true }));
    }),
  );
  return calls;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Mount `item` over the markup `fragment` would render for it. */
function mountItem(
  item: SectionItem,
  extra: Partial<Parameters<typeof mountSections>[1]> = {},
): HTMLElement {
  const host = document.createElement("div");
  // The same markup the fragment route renders for it.
  const blocks = Array.isArray(item.blocks) ? (item.blocks as SectionItem[]) : [];
  host.innerHTML = `<section data-louise-node="0"><h2 data-louise-node="0.heading">${String(item.heading ?? "")}</h2>${blocks
    .map(
      (b, j) =>
        `<article data-louise-node="0.blocks.${j}"><h3 data-louise-node="0.blocks.${j}.name">${String(b.name ?? "")}</h3></article>`,
    )
    .join("")}</section>`;
  document.body.appendChild(host);
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  dispose = mountSections(host, {
    catalog: CATALOG,
    blocks: BLOCKS,
    pageId: 1,
    initial: [item],
    autoSave: { debounceMs: 60_000 },
    ...extra,
  });
  return host;
}

const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const click = (el: Element | null | undefined) =>
  el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
/** The chrome's buttons, in order: up, down, delete, add below, add first, wrench. */
const toolbarButton = (i: number) =>
  document.querySelectorAll<HTMLButtonElement>(".louise-chrome-toolbar button")[i];
const openInspectorOn = async (el: Element) => {
  over(el);
  click(toolbarButton(5));
  await flush();
};
const inspector = () => document.querySelector<HTMLElement>(".louise-inspector");
const button = (text: string, scope: Element | Document = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.textContent?.trim() === text || b.getAttribute("aria-label") === text || b.title === text,
  );
const field = (label: string) =>
  [...(inspector()?.querySelectorAll<HTMLElement>(".louise-field") ?? [])].find((f) =>
    f.querySelector(".louise-field-label")?.textContent?.startsWith(label),
  );
const fragments = (calls: Call[]) =>
  calls
    .filter((c) => c.url === "/louise-fragment")
    .map((c) => (c.body as { item: SectionItem }).item);
const undoKey = () =>
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
  );
const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const chooseFile = (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
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

const CARD: SectionItem = {
  _type: "card",
  heading: "Welcome",
  subtitle: "",
  body: "",
  photo: "",
  tone: "",
  words: [{ word: "fast" }],
  points: [{ text: "One" }],
  tiles: [{ kind: "photo", caption: "", src: "" }],
};

describe("inspector—scalar and image fields", () => {
  it("writes a text and a textarea field, then re-renders on change", async () => {
    const calls = stubFetch();
    const host = mountItem(CARD);
    await flush();
    await openInspectorOn(host.querySelector("section") as Element);

    setValue(
      field("Subtitle")?.querySelector("input") as HTMLInputElement,
      "For Example Organization",
    );
    await flush();
    setValue(field("Body")?.querySelector("textarea") as HTMLTextAreaElement, "Two\nlines");
    await flush();

    expect(fragments(calls).at(-1)).toMatchObject({
      subtitle: "For Example Organization",
      body: "Two\nlines",
    });
  });

  it("says when a fetched select's choices failed to load", async () => {
    stubFetch();
    const host = mountItem(CARD);
    await flush();
    await openInspectorOn(host.querySelector("section") as Element);

    const tone = field("Tone");
    expect(tone?.querySelector("[role='alert']")?.textContent).toBe("Couldn’t reach the catalog");
  });

  it("uploads an image to the media route and stores its URL", async () => {
    const calls = stubFetch((c) =>
      c.url === "/api/louise/media" && c.method === "POST"
        ? json({ url: "/media/photo.webp" })
        : undefined,
    );
    const host = mountItem(CARD);
    await flush();
    await openInspectorOn(host.querySelector("section") as Element);

    const photo = field("Photo") as HTMLElement;
    expect(photo.textContent).toContain("Upload");
    chooseFile(photo.querySelector("input[type=file]") as HTMLInputElement, [
      new File(["x"], "photo.png", { type: "image/png" }),
    ]);
    await flush();

    const upload = calls.find((c) => c.url === "/api/louise/media" && c.method === "POST");
    expect((upload?.body as FormData).get("scope")).toBe("web");
    expect(fragments(calls).at(-1)?.photo).toBe("/media/photo.webp");
    expect(field("Photo")?.querySelector("img")).not.toBeNull();
    expect(field("Photo")?.textContent).toContain("Replace");

    click(button("Clear", field("Photo") as HTMLElement));
    await flush();
    expect(fragments(calls).at(-1)?.photo).toBe("");
  });

  it("shows why an upload failed, and ignores an empty file choice", async () => {
    let answer: () => Response | Promise<Response> = () => json({ error: "Too large" }, 413);
    const calls = stubFetch((c) => (c.url === "/api/louise/media" ? answer() : undefined));
    const host = mountItem(CARD);
    await flush();
    await openInspectorOn(host.querySelector("section") as Element);
    const input = () => field("Photo")?.querySelector("input[type=file]") as HTMLInputElement;
    const error = () => field("Photo")?.querySelector(".louise-sections-img-error")?.textContent;

    chooseFile(input(), []);
    await flush();
    expect(calls.some((c) => c.url === "/api/louise/media")).toBe(false);

    chooseFile(input(), [new File(["x"], "big.png", { type: "image/png" })]);
    await flush();
    expect(error()).toBe("Too large");

    answer = () => new Response("nope", { status: 500 });
    chooseFile(input(), [new File(["x"], "a.png", { type: "image/png" })]);
    await flush();
    expect(error()).toBe("Upload failed (500)");

    answer = () => Promise.reject(new Error("Network down"));
    chooseFile(input(), [new File(["x"], "a.png", { type: "image/png" })]);
    await flush();
    expect(error()).toBe("Network down");
  });
});

describe("inspector—array membership", () => {
  it("edits, adds, and removes items of an array typed in the inspector", async () => {
    const calls = stubFetch();
    const host = mountItem(CARD);
    await flush();
    await openInspectorOn(host.querySelector("section") as Element);

    const words = () =>
      [...(inspector()?.querySelectorAll<HTMLElement>(".louise-arr") ?? [])].find(
        (a) => a.querySelector(".louise-field-label")?.textContent === "Words",
      ) as HTMLElement;
    setValue(words().querySelector("input") as HTMLInputElement, "quick");
    await flush();
    expect(fragments(calls).at(-1)?.words).toEqual([{ word: "quick" }]);

    click(button("Word", words()));
    await flush();
    expect(fragments(calls).at(-1)?.words).toEqual([{ word: "quick" }, { word: "" }]);

    click(button("Remove", words()));
    await flush();
    expect(fragments(calls).at(-1)?.words).toEqual([{ word: "" }]);

    // Undo puts the removed item back and re-renders the section.
    undoKey();
    await flush();
    expect(fragments(calls).at(-1)?.words).toEqual([{ word: "quick" }, { word: "" }]);
  });

  it("numbers on-page array items and offers each variant with its icon", async () => {
    stubFetch();
    const host = mountItem(CARD);
    await flush();
    await openInspectorOn(host.querySelector("section") as Element);

    const arrays = [...(inspector()?.querySelectorAll<HTMLElement>(".louise-arr") ?? [])];
    const points = arrays.find((a) => a.textContent?.startsWith("Points"));
    expect(points?.querySelector(".louise-arr-row span")?.textContent).toBe("Item 1");
    const tiles = arrays.find((a) => a.textContent?.startsWith("Tiles"));
    const adds = [...(tiles?.querySelectorAll(".louise-variant-add button") ?? [])];
    expect(adds.map((b) => b.textContent?.trim())).toEqual(["Photo tile", "Note"]);
    expect(adds[0].querySelector("i.ph.ph-image")).not.toBeNull();
  });
});

describe("inspector—blocks", () => {
  const GRID: SectionItem = {
    _type: "grid",
    blocks: [
      { _type: "feature", name: "Alpha" },
      { _type: "quote", name: "Beta" },
    ],
  };

  it("writes a block's setting and toggle onto that block", async () => {
    const calls = stubFetch();
    const host = mountItem(GRID);
    await flush();
    await openInspectorOn(host.querySelector("article") as Element);

    expect(inspector()?.querySelector(".louise-inspector-title")?.textContent).toBe("Feature");
    setValue(field("Align")?.querySelector("input") as HTMLInputElement, "center");
    await flush();
    const toggle = field("Open in a new tab")?.querySelector("input") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect((fragments(calls).at(-1)?.blocks as SectionItem[])[0]).toEqual({
      _type: "feature",
      name: "Alpha",
      newTab: true,
      _settings: { align: "center" },
    });
  });

  it("says a block with nothing to set has nothing to configure", async () => {
    stubFetch();
    const host = mountItem(GRID);
    await flush();
    await openInspectorOn(host.querySelectorAll("article")[1]);

    expect(inspector()?.querySelector(".louise-inspector-empty")?.textContent).toBe(
      "Nothing to configure here yet.",
    );
  });

  it("scopes a block field's wrench to that one field", async () => {
    stubFetch();
    const host = document.createElement("div");
    host.innerHTML =
      '<section data-louise-node="0"><article data-louise-node="0.blocks.0"><span data-louise-node="0.blocks.0.newTab">new tab</span></article></section>';
    document.body.appendChild(host);
    vi.spyOn(window.location, "reload").mockImplementation(() => {});
    dispose = mountSections(host, {
      catalog: CATALOG,
      blocks: BLOCKS,
      pageId: 1,
      initial: [GRID],
      autoSave: false,
    });
    await flush();
    await openInspectorOn(host.querySelector("span") as Element);

    expect(inspector()?.querySelector(".louise-inspector-title")?.textContent).toBe(
      "Open in a new tab",
    );
    expect(inspector()?.querySelectorAll(".louise-field")).toHaveLength(1);
  });

  it("closes the block picker on Escape", async () => {
    stubFetch();
    const host = mountItem(GRID);
    await flush();
    over(host.querySelector("article") as Element);
    click(toolbarButton(3));
    await flush();

    const picker = document.querySelector<HTMLElement>('[aria-label="Add a block"]');
    expect(picker).not.toBeNull();
    picker?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(document.querySelector('[aria-label="Add a block"]')).toBeNull();
  });

  it("does nothing for the first-child add on a section that takes no blocks", async () => {
    const calls = stubFetch();
    const host = mountItem({ _type: "plain", heading: "Hi" });
    await flush();
    over(host.querySelector("section") as Element);
    click(toolbarButton(4));
    await flush();

    expect(document.querySelector('[aria-label="Add a block"]')).toBeNull();
    expect(fragments(calls)).toHaveLength(0);
  });

  it("moves a block and undoes the move", async () => {
    stubFetch();
    const host = mountItem(GRID);
    await flush();
    const names = () => [...host.querySelectorAll("article h3")].map((h) => h.textContent);

    over(host.querySelector("article") as Element);
    click(toolbarButton(1));
    expect(names()).toEqual(["Beta", "Alpha"]);

    undoKey();
    await flush();
    expect(names()).toEqual(["Alpha", "Beta"]);
  });

  it("re-renders the section to undo a block delete after the section re-rendered", async () => {
    const calls = stubFetch();
    const host = mountItem(GRID);
    await flush();

    over(host.querySelectorAll("article")[1]);
    click(toolbarButton(2));
    expect(host.querySelectorAll("article")).toHaveLength(1);

    // A layout change swaps the section's element for a fresh render.
    await openInspectorOn(host.querySelector("section") as Element);
    click(button("Boxed", inspector() as HTMLElement));
    await flush();
    click(button("Close", inspector() as HTMLElement));

    undoKey();
    await flush();
    expect((fragments(calls).at(-1)?.blocks as SectionItem[]).map((b) => b.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(host.querySelectorAll("article")).toHaveLength(2);

    // A field in the re-rendered section flushes autosave when it loses focus.
    const before = calls.filter((c) => c.url.endsWith("/versions") && c.method === "POST").length;
    host.querySelector("h3")?.dispatchEvent(new Event("blur"));
    await flush();
    expect(calls.filter((c) => c.url.endsWith("/versions") && c.method === "POST").length).toBe(
      before + 1,
    );
  });

  it("reports a failed save when a re-render can't reach the fragment route", async () => {
    stubFetch((c) => {
      if (c.url === "/louise-fragment") return Promise.reject(new TypeError("offline"));
      if (c.method === "POST" && c.url.endsWith("/versions")) return json({}, 500);
      return undefined;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = mountItem(GRID);
    await flush();
    await openInspectorOn(host.querySelector("section") as Element);
    click(button("Wide", inspector() as HTMLElement));
    await flush();

    expect(document.querySelector(".louise-sections-status")?.textContent).toBe(
      "Couldn’t save your draft. Your edits are still here.",
    );
  });
});

describe("inspector—shared values", () => {
  const sharedPage = () => {
    const host = document.createElement("div");
    host.innerHTML = '<section data-louise-node="0"></section>';
    document.body.appendChild(host);
    const marker = document.createElement("span");
    marker.setAttribute("data-louise-node", "settings.theme");
    marker.textContent = "light";
    document.body.appendChild(marker);
    return { host, marker };
  };

  it("warns without a count, reports a failed load, and leaves a non-text value's markers alone", async () => {
    const calls = stubFetch((c) =>
      c.url === "/api/louise/settings" && c.method === "GET" ? json({}, 500) : undefined,
    );
    const { host, marker } = sharedPage();
    dispose = mountSections(host, {
      catalog: CATALOG,
      pageId: 1,
      initial: [{ _type: "plain", heading: "" }],
      autoSave: false,
      shared: {
        theme: {
          type: "select",
          label: "Theme",
          options: [
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ],
        },
      },
    });
    await flush();
    await openInspectorOn(marker);

    expect(inspector()?.querySelector(".louise-shared-band")?.textContent).toBe(
      "Saves immediately, everywhere.",
    );
    expect(inspector()?.querySelector("[role='alert']")?.textContent).toBe(
      "Couldn’t load the current value",
    );
    expect(calls.some((c) => c.url === "/api/louise/pages")).toBe(false);

    const select = inspector()?.querySelector("select") as HTMLSelectElement;
    select.value = "dark";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ theme: "dark" });
    expect(marker.textContent).toBe("light");
  });

  it("skips a page whose stored sections aren't valid JSON in the used-in count", async () => {
    stubFetch((c) => {
      if (c.url === "/api/louise/settings") return json({ settings: { theme: "light" } });
      if (c.url === "/api/louise/pages") {
        return json({ pages: [{ sections: "{not json" }, { sections: null }] });
      }
      return undefined;
    });
    const { host, marker } = sharedPage();
    dispose = mountSections(host, {
      catalog: { ...CATALOG, plain: { ...CATALOG.plain, consumes: ["theme"] } },
      pageId: 1,
      initial: [{ _type: "plain", heading: "" }],
      autoSave: false,
      shared: { theme: { type: "text", label: "Theme", surfaces: ["the header"] } },
    });
    await flush();
    await openInspectorOn(marker);

    expect(inspector()?.querySelector(".louise-shared-band")?.textContent).toBe(
      "Used in the header. Saves immediately, everywhere.",
    );
  });
});

describe("inspector—source settings", () => {
  const SOURCE: SectionCatalog = {
    mirror: {
      label: "Mirror",
      fields: {},
      source: {
        kind: "external",
        label: "Catalog",
        settingsKey: "shop",
        settings: {
          hidden: {
            type: "select",
            inline: false,
            multiple: true,
            label: "Hidden items",
            options: [
              { value: "i1", label: "Item 1" },
              { value: "i2", label: "Item 2" },
            ],
          },
          featured: {
            type: "select",
            inline: false,
            multiple: true,
            label: "Featured",
            options: () => Promise.reject(new Error("Catalog is offline")),
          },
        },
      },
    },
  };

  it("reports a failed load, then saves a checked item immediately", async () => {
    const calls = stubFetch((c) =>
      c.url === "/api/louise/settings" && c.method === "GET"
        ? Promise.reject(new TypeError("offline"))
        : undefined,
    );
    const host = document.createElement("div");
    host.innerHTML = '<section data-louise-node="0"></section>';
    document.body.appendChild(host);
    vi.spyOn(window.location, "reload").mockImplementation(() => {});
    dispose = mountSections(host, {
      catalog: SOURCE,
      pageId: 1,
      initial: [{ _type: "mirror" }],
      autoSave: false,
    });
    await flush();
    await openInspectorOn(host.querySelector("section") as Element);

    const alerts = () =>
      [...(inspector()?.querySelectorAll("[role='alert']") ?? [])].map((a) => a.textContent);
    expect(alerts()).toContain("Couldn’t load the source settings");
    expect(alerts()).toContain("Catalog is offline");

    const hidden = inspector()?.querySelector<HTMLInputElement>(
      '[aria-label="Hidden items"] input',
    ) as HTMLInputElement;
    hidden.checked = true;
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ shop: { hidden: ["i1"] } });

    hidden.checked = false;
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({
      shop: { hidden: [] },
    });
  });
});
