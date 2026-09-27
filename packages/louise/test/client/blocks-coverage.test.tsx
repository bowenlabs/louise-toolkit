// The page builder's blocks (#16) serialize to classed, `pb-`-prefixed HTML that
// the site renders through the sanitizer, and parse back when a page is edited
// again. This covers each block's insert command, the markup it serializes to,
// the round trip back into the editor, the grid row's layout controls, the
// gallery's column chips, the button's settings, the "+ Block" menu, and the
// slash menu, and checks every block's markup survives `sanitizeRichHtml` (#508).

import type { Node as PMNode } from "@prosekit/pm/model";
import { TextSelection, type Command } from "@prosekit/pm/state";
import { defineBasicExtension } from "prosekit/basic";
import { createEditor, htmlFromNode, union, type Editor } from "prosekit/core";
import { ProseKit } from "prosekit/solid";
import { onMount } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCKS,
  BlockInserter,
  BlockInserterButton,
  defineBlock,
  defineBlocksExtension,
  insertButtonCommand,
  insertRowCommand,
} from "../../src/client/blocks.jsx";
import { sanitizeRichHtml } from "../../src/core/security/sanitize.js";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  // happy-dom has neither the Web Animations API nor the Popover API, and the
  // slash menu's positioner uses both.
  for (const [name, value] of [
    ["getAnimations", () => []],
    ["showPopover", () => {}],
    ["hidePopover", () => {}],
  ] as const) {
    if (!(name in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, name, { value, configurable: true });
    }
  }
  // The button's link field lists the site's pages from the editor API.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ pages: [] }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** An editor with the basic nodes plus every builder block, hosted the way
 *  `RichText` hosts it, so the Solid node views and both inserters render. */
async function mount(content: string = "<p>Body</p>") {
  const editor = createEditor({
    extension: union(defineBasicExtension(), defineBlocksExtension()),
    defaultContent: content,
  });
  const el = document.createElement("div");
  document.body.appendChild(el);
  // oxlint-disable-next-line no-unassigned-vars -- assigned by Solid's `ref` binding below
  let host!: HTMLDivElement;
  const dispose = render(
    () => (
      <ProseKit editor={editor}>
        {(() => {
          onMount(() => editor.mount(host));
          return null;
        })()}
        <div ref={host} />
        <BlockInserter />
        <BlockInserterButton />
      </ProseKit>
    ),
    el,
  );
  cleanups.push(() => {
    editor.unmount();
    dispose();
    el.remove();
  });
  await tick();
  return {
    editor,
    el,
    html: () => htmlFromNode(editor.view.state.doc),
    doc: () => editor.view.state.doc,
  };
}

type Mounted = Awaited<ReturnType<typeof mount>>;

/** Put the cursor at the end of the first text block. */
function cursorInFirstParagraph(editor: Editor) {
  const { state } = editor.view;
  let at = 1;
  state.doc.descendants((node, pos) => {
    if (at === 1 && node.isTextblock) at = pos + 1 + node.content.size;
    return at === 1;
  });
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

/** The first node of `type` and its position. */
function find(doc: PMNode, type: string): { node: PMNode; pos: number } | undefined {
  let found: { node: PMNode; pos: number } | undefined;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === type) found = { node, pos };
    return !found;
  });
  return found;
}

/** Parse HTML into a fresh builder editor and serialize it again. */
async function roundTrip(html: string): Promise<string> {
  const again = await mount(html);
  return again.html();
}

function exec(m: Mounted, cmd: Command): boolean {
  return m.editor.exec(cmd);
}

const entry = (label: string) => {
  const b = BLOCKS.find((x) => x.label === label);
  if (!b) throw new Error(`no block labelled ${label}`);
  return b;
};

describe("builder blocks—insert, serialize, sanitize, parse back", () => {
  const cases: [label: string, node: string, marker: string][] = [
    ["Hero", "heroBlock", '<section data-block="hero" class="pb-hero">'],
    ["Full-bleed", "bleedBlock", '<figure data-block="bleed" class="pb-bleed">'],
    ["Pull quote", "quoteBlock", '<blockquote data-block="quote" class="pb-quote">'],
    ["Call to action", "ctaBlock", '<section data-block="cta" class="pb-cta">'],
    ["Gallery", "galleryBlock", '<section data-block="grid" class="pb-grid" data-cols="3">'],
    ["Divider", "dividerBlock", '<hr data-block="divider" class="pb-hr" data-size="md">'],
    [
      "Button",
      "buttonBlock",
      '<div data-block="button" class="pb-button"><a href="#">Button</a></div>',
    ],
    [
      "Columns",
      "rowBlock",
      // happy-dom closes the declaration with a semicolon; the sanitizer allows it.
      '<div data-block="row" class="pb-row" style="grid-template-columns: 1fr 1fr;">',
    ],
  ];

  it.each(cases)("inserts %s as %s", async (label, node, marker) => {
    const m = await mount();
    cursorInFirstParagraph(m.editor);
    expect(exec(m, entry(label).command)).toBe(true);
    expect(find(m.doc(), node)).toBeDefined();

    const html = m.html();
    expect(html).toContain(marker);
    // The sanitizer keeps the builder's markup: identity, `pb-` class, and the
    // variant attrs all survive, so the site renders what the editor saved.
    expect(sanitizeRichHtml(html)).toContain(marker);

    // Feeding the stored markup back in rebuilds the same block.
    const again = await mount(html);
    expect(find(again.doc(), node)).toBeDefined();
    expect(again.html()).toBe(html);
  });

  it("registers every inserter entry with a label and keywords", () => {
    expect(BLOCKS.map((b) => b.label)).toEqual([
      "Hero",
      "Columns",
      "Gallery",
      "Button",
      "Full-bleed",
      "Pull quote",
      "Call to action",
      "Divider",
    ]);
    for (const b of BLOCKS) expect(b.keywords.length).toBeGreaterThan(0);
  });

  it("serializes a column as a `pb-col` div inside the row", async () => {
    const m = await mount();
    cursorInFirstParagraph(m.editor);
    exec(m, insertRowCommand("6fr 4fr", 2));
    const html = m.html();
    expect(html).toContain('style="grid-template-columns: 6fr 4fr;"');
    expect(html.match(/<div data-block="col" class="pb-col">/g)).toHaveLength(2);
    expect(sanitizeRichHtml(html)).toContain("grid-template-columns: 6fr 4fr");
  });

  it("parses a stored gallery's column count", async () => {
    const html = await roundTrip(
      '<section data-block="grid" class="pb-grid" data-cols="4"><p>A</p></section>',
    );
    expect(html).toContain('data-cols="4"');
  });

  it("defaults a stored gallery with no column count to three", async () => {
    const m = await mount('<section data-block="grid" class="pb-grid"><p>A</p></section>');
    expect(find(m.doc(), "galleryBlock")?.node.attrs.cols).toBe("3");
  });

  it("parses a stored button's label and link", async () => {
    const m = await mount(
      '<div data-block="button" class="pb-button"><a href="https://example.com/menu">See the menu</a></div>',
    );
    const btn = find(m.doc(), "buttonBlock");
    expect(btn?.node.attrs).toEqual({ label: "See the menu", href: "https://example.com/menu" });
    expect(m.html()).toContain('<a href="https://example.com/menu">See the menu</a>');
  });

  it("falls back to the default label and link for a button with no anchor", async () => {
    const m = await mount('<div data-block="button" class="pb-button"></div>');
    expect(find(m.doc(), "buttonBlock")?.node.attrs).toEqual({ label: "Button", href: "#" });
  });

  it("parses a stored divider's size", async () => {
    const m = await mount('<hr data-block="divider" class="pb-hr" data-size="lg">');
    expect(find(m.doc(), "dividerBlock")?.node.attrs.size).toBe("lg");
  });

  it("defaults a divider with no size to medium", async () => {
    const m = await mount('<hr data-block="divider" class="pb-hr">');
    expect(find(m.doc(), "dividerBlock")?.node.attrs.size).toBe("md");
  });

  it("defaults a stored row with no track list to two equal columns", async () => {
    const m = await mount(
      '<div data-block="row" class="pb-row"><div data-block="col" class="pb-col"><p>A</p></div></div>',
    );
    expect(find(m.doc(), "rowBlock")?.node.attrs.cols).toBe("1fr 1fr");
  });

  it("still parses the legacy two-column block", async () => {
    const legacy =
      '<section data-block="cols" class="pb-cols"><div class="pb-col"><p>Left</p></div><div class="pb-col"><p>Right</p></div></section>';
    const m = await mount(legacy);
    expect(find(m.doc(), "colsBlock")).toBeDefined();
    const html = m.html();
    expect(html).toContain(legacy);
    expect(sanitizeRichHtml(html)).toContain(legacy);
  });

  it("parses a pull quote ahead of a plain blockquote", async () => {
    const m = await mount(
      '<blockquote data-block="quote" class="pb-quote"><p>Worth the trip.</p></blockquote><blockquote><p>Plain</p></blockquote>',
    );
    expect(find(m.doc(), "quoteBlock")).toBeDefined();
    expect(find(m.doc(), "blockquote")).toBeDefined();
  });

  it("keeps a whole page intact through the sanitizer", async () => {
    const m = await mount();
    for (const b of BLOCKS) {
      cursorInFirstParagraph(m.editor);
      exec(m, b.command);
    }
    const html = m.html();
    expect(sanitizeRichHtml(html)).toBe(html);
  });
});

describe("insert commands", () => {
  it("report they can't run without the block nodes in the schema", async () => {
    const editor = createEditor({ extension: defineBasicExtension() });
    const state = editor.state;
    expect(insertRowCommand()(state)).toBe(false);
    expect(insertButtonCommand()(state)).toBe(false);
  });

  it("answer a dry run without changing the document", async () => {
    const m = await mount();
    const before = m.html();
    expect(insertRowCommand()(m.editor.view.state)).toBe(true);
    expect(insertButtonCommand()(m.editor.view.state)).toBe(true);
    expect(m.html()).toBe(before);
  });

  it("inserts a row with the requested number of columns", async () => {
    const m = await mount();
    cursorInFirstParagraph(m.editor);
    exec(m, insertRowCommand("1fr 1fr 1fr", 3));
    expect(find(m.doc(), "rowBlock")?.node.childCount).toBe(3);
  });
});

describe("defineBlock", () => {
  it("omits a data attr whose value is empty, and renders leaf blocks with no hole", async () => {
    const editor = createEditor({
      extension: union(
        defineBasicExtension(),
        defineBlock({
          name: "badgeBlock",
          block: "badge",
          tag: "hr",
          class: "pb-badge",
          atom: true,
          attrs: { size: { default: "", attr: "data-size" } },
        }),
      ),
      defaultContent: '<hr data-block="badge" class="pb-badge">',
    });
    const html = htmlFromNode(editor.state.doc);
    expect(html).toContain('<hr data-block="badge" class="pb-badge">');
    expect(html).not.toContain("data-size");
  });
});

/** Click a button by its accessible label or text. */
function button(root: HTMLElement, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.getAttribute("aria-label") === name ||
      b.getAttribute("title") === name ||
      b.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

describe("the grid row's controls", () => {
  const rowHtml = (cols: string, n: number) =>
    `<div data-block="row" class="pb-row" style="grid-template-columns: ${cols}">${Array.from(
      { length: n },
      (_, i) => `<div data-block="col" class="pb-col"><p>Col ${i + 1}</p></div>`,
    ).join("")}</div>`;
  const cols = (m: Mounted) => find(m.doc(), "rowBlock")?.node.attrs.cols as string;
  const count = (m: Mounted) => find(m.doc(), "rowBlock")?.node.childCount;
  const chrome = (m: Mounted) => m.el.querySelector('[data-block-chrome="row"]') as HTMLElement;

  it("renders a toolbar with the presets and the active layout marked", async () => {
    const m = await mount(rowHtml("6fr 4fr", 2));
    const bar = chrome(m);
    expect(bar).not.toBeNull();
    expect(button(bar, "Two—wide left").classList.contains("is-active")).toBe(true);
    expect(button(bar, "Two equal").classList.contains("is-active")).toBe(false);
    // Width steppers show each column's weight.
    const weights = [...bar.querySelectorAll(".louise-col-w")].map((s) => s.textContent);
    expect(weights).toEqual(["6", "4"]);
    // The editing chrome lays the columns out with the row's own track list.
    const grid = bar.querySelector(".pb-row") as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("6fr 4fr");
  });

  it("applies a preset, growing the row and keeping existing column content", async () => {
    const m = await mount(rowHtml("1fr 1fr", 2));
    button(chrome(m), "Three equal").click();
    await tick();
    expect(cols(m)).toBe("1fr 1fr 1fr");
    expect(count(m)).toBe(3);
    const html = m.html();
    expect(html).toContain("Col 1");
    expect(html).toContain("Col 2");
  });

  it("applies a preset that shrinks the row, dropping trailing columns", async () => {
    const m = await mount(rowHtml("1fr 1fr 1fr", 3));
    button(chrome(m), "One column").click();
    await tick();
    expect(cols(m)).toBe("1fr");
    expect(count(m)).toBe(1);
    expect(m.html()).not.toContain("Col 2");
  });

  it("widens and narrows a column within 1 to 11", async () => {
    const m = await mount(rowHtml("10fr 1fr", 2));
    button(chrome(m), "Widen column 1").click();
    await tick();
    expect(cols(m)).toBe("11fr 1fr");
    button(chrome(m), "Widen column 1").click();
    await tick();
    expect(cols(m)).toBe("11fr 1fr");
    button(chrome(m), "Narrow column 2").click();
    await tick();
    expect(cols(m)).toBe("11fr 1fr");
    button(chrome(m), "Narrow column 1").click();
    await tick();
    expect(cols(m)).toBe("10fr 1fr");
  });

  it("adds and removes a column, rebalancing to even widths", async () => {
    const m = await mount(rowHtml("6fr 4fr", 2));
    button(chrome(m), "Add column").click();
    await tick();
    expect(cols(m)).toBe("1fr 1fr 1fr");
    expect(count(m)).toBe(3);
    button(chrome(m), "Remove column").click();
    await tick();
    expect(cols(m)).toBe("1fr 1fr");
    expect(count(m)).toBe(2);
  });

  it("disables remove at one column and add at six", async () => {
    const one = await mount(rowHtml("1fr", 1));
    expect(button(chrome(one), "Remove column").disabled).toBe(true);
    const six = await mount(rowHtml("1fr 1fr 1fr 1fr 1fr 1fr", 6));
    expect(button(chrome(six), "Add column").disabled).toBe(true);
  });

  it("adds a two-column row below", async () => {
    const m = await mount(rowHtml("6fr 4fr", 2));
    button(chrome(m), "Add row").click();
    await tick();
    const rows: PMNode[] = [];
    m.doc().descendants((node) => {
      if (node.type.name === "rowBlock") rows.push(node);
    });
    expect(rows.map((r) => r.attrs.cols)).toEqual(["6fr 4fr", "1fr 1fr"]);
    expect(rows[1].childCount).toBe(2);
  });

  it("reads a percent track list as weights", async () => {
    const m = await mount(rowHtml("60% 40%", 2));
    const weights = [...chrome(m).querySelectorAll(".louise-col-w")].map((s) => s.textContent);
    expect(weights).toEqual(["60", "40"]);
    expect(button(chrome(m), "Two—wide left").classList.contains("is-active")).toBe(false);
  });

  it("treats a track with no unit as weight one", async () => {
    const m = await mount(rowHtml("auto 2fr", 2));
    const weights = [...chrome(m).querySelectorAll(".louise-col-w")].map((s) => s.textContent);
    expect(weights).toEqual(["1", "2"]);
  });
});

describe("the gallery's controls", () => {
  it("switches the column count from its chips", async () => {
    const m = await mount(
      '<section data-block="grid" class="pb-grid" data-cols="3"><p>A</p></section>',
    );
    const chrome = m.el.querySelector('[data-block-chrome="gallery"]') as HTMLElement;
    expect(chrome).not.toBeNull();
    expect(button(chrome, "3 cols").classList.contains("is-active")).toBe(true);
    button(chrome, "2 cols").click();
    await tick();
    expect(find(m.doc(), "galleryBlock")?.node.attrs.cols).toBe("2");
    expect(m.html()).toContain('data-cols="2"');
    expect(chrome.querySelector(".pb-grid")?.getAttribute("data-cols")).toBe("2");
  });
});

describe("the divider's control", () => {
  it("toggles between tighter and roomier spacing", async () => {
    const m = await mount('<p>A</p><hr data-block="divider" class="pb-hr" data-size="md">');
    const chrome = () => m.el.querySelector('[data-block-chrome="divider"]') as HTMLElement;
    expect(button(chrome(), "Toggle spacing").textContent).toBe("Roomier");
    button(chrome(), "Toggle spacing").click();
    await tick();
    expect(find(m.doc(), "dividerBlock")?.node.attrs.size).toBe("lg");
    expect(m.html()).toContain('data-size="lg"');
    expect(button(chrome(), "Toggle spacing").textContent).toBe("Tighter");
    button(chrome(), "Toggle spacing").click();
    await tick();
    expect(find(m.doc(), "dividerBlock")?.node.attrs.size).toBe("md");
  });
});

describe("the button's settings", () => {
  it("renders the label and link, and saves an edited label on change", async () => {
    const m = await mount(
      '<p>A</p><div data-block="button" class="pb-button"><a href="https://example.com/">Visit</a></div>',
    );
    const chrome = m.el.querySelector('[data-block-chrome="button"]') as HTMLElement;
    const link = chrome.querySelector(".pb-button-link") as HTMLAnchorElement;
    expect(link.textContent).toBe("Visit");
    expect(link.getAttribute("href")).toBe("https://example.com/");

    // Following the preview link would navigate away from the editor.
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);

    const input = chrome.querySelector('[aria-label="Button label"]') as HTMLInputElement;
    input.value = "Book a table";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(link.textContent).toBe("Book a table");
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(find(m.doc(), "buttonBlock")?.node.attrs).toEqual({
      label: "Book a table",
      href: "https://example.com/",
    });
  });

  it("saves an edited link, keeping the label", async () => {
    const m = await mount(
      '<p>A</p><div data-block="button" class="pb-button"><a href="#">Visit</a></div>',
    );
    const chrome = m.el.querySelector('[data-block-chrome="button"]') as HTMLElement;
    const url = chrome.querySelector('[aria-label="Link URL"]') as HTMLInputElement;
    url.value = "https://example.com/reserve";
    url.dispatchEvent(new Event("input", { bubbles: true }));
    url.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(find(m.doc(), "buttonBlock")?.node.attrs).toEqual({
      label: "Visit",
      href: "https://example.com/reserve",
    });
    const html = m.html();
    expect(html).toContain('<a href="https://example.com/reserve">Visit</a>');
    expect(sanitizeRichHtml(html)).toContain('<a href="https://example.com/reserve">Visit</a>');
  });

  it("shows the default label when the label is cleared", async () => {
    const m = await mount(
      '<p>A</p><div data-block="button" class="pb-button"><a href="#">Visit</a></div>',
    );
    const chrome = m.el.querySelector('[data-block-chrome="button"]') as HTMLElement;
    const input = chrome.querySelector('[aria-label="Button label"]') as HTMLInputElement;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(chrome.querySelector(".pb-button-link")?.textContent).toBe("Button");
  });
});

describe("the + Block menu", () => {
  const trigger = (m: Mounted) =>
    m.el.querySelector<HTMLButtonElement>('.louise-block-add > button[aria-haspopup="true"]')!;
  const menu = (m: Mounted) => m.el.querySelector<HTMLElement>("#louise-block-add-menu");

  it("opens a labelled group of every block and closes on a second press", async () => {
    const m = await mount();
    expect(trigger(m).getAttribute("aria-expanded")).toBe("false");
    expect(menu(m)).toBeNull();
    trigger(m).click();
    await tick();
    expect(trigger(m).getAttribute("aria-expanded")).toBe("true");
    const group = menu(m);
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.getAttribute("aria-label")).toBe("Insert a block");
    expect([...group!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(
      BLOCKS.map((b) => b.label),
    );
    trigger(m).click();
    await tick();
    expect(menu(m)).toBeNull();
  });

  it("inserts the chosen block and closes", async () => {
    const m = await mount();
    cursorInFirstParagraph(m.editor);
    trigger(m).click();
    await tick();
    button(menu(m)!, "Hero").click();
    await tick();
    expect(find(m.doc(), "heroBlock")).toBeDefined();
    expect(menu(m)).toBeNull();
    expect(trigger(m).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape", async () => {
    const m = await mount();
    trigger(m).click();
    await tick();
    menu(m)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(menu(m)).toBeNull();
  });
});

describe("the slash menu", () => {
  it("offers every block when the editor types a slash, and inserts the chosen one", async () => {
    const m = await mount("<p></p>");
    const items = () => [
      ...m.el.querySelectorAll<HTMLElement>(".louise-slash-menu .louise-slash-item"),
    ];
    expect(items().map((i) => i.textContent)).toEqual(BLOCKS.map((b) => b.label));

    // Type "/" so the autocomplete matches, then pick an entry.
    m.editor.view.focus();
    cursorInFirstParagraph(m.editor);
    const { state } = m.editor.view;
    m.editor.view.dispatch(state.tr.insertText("/"));
    await tick();
    const divider = items().find((i) => i.textContent === "Divider")!;
    divider.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    divider.click();
    await tick();
    expect(find(m.doc(), "dividerBlock")).toBeDefined();
  });
});
