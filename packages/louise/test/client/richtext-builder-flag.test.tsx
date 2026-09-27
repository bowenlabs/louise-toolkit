// The page builder's flag is named for what it turns on (#537): `builder` and
// `data-louise-builder`. It was `blocks` and `data-louise-blocks`, which read as
// a section's blocks, a different thing; the old names keep working.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountLouise } from "../../src/client/index.js";
import { louiseNavigation } from "../../src/client/lifecycle.js";
import { mountRichText } from "../../src/client/RichText.jsx";

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The page builder's visible inserter, present only with the builder on. */
const builderOn = (root: { querySelector(s: string): unknown } = document) =>
  root.querySelector(".louise-block-add") !== null;

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
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ versions: [] }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
});

afterEach(() => {
  louiseNavigation.afterSwap();
  delete document.documentElement.dataset.louiseMounted;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("mountRichText—the builder option", () => {
  const host = () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>Body</p>";
    document.body.appendChild(el);
    return el;
  };

  it("turns the page builder on with `builder`", () => {
    const el = host();
    mountRichText(el, () => {}, undefined, { builder: true });
    expect(builderOn(el)).toBe(true);
  });

  it("still reads the deprecated `blocks`", () => {
    const el = host();
    mountRichText(el, () => {}, undefined, { blocks: true });
    expect(builderOn(el)).toBe(true);
  });

  it("leaves it off by default", () => {
    const el = host();
    mountRichText(el, () => {});
    expect(builderOn(el)).toBe(false);
  });
});

describe("mountLouise—the builder attribute", () => {
  const field = (attr?: string) => {
    const el = document.createElement("div");
    el.dataset.louiseField = "pages:5:body";
    el.dataset.louiseType = "richtext";
    if (attr) el.setAttribute(attr, "1");
    el.innerHTML = "<p>Body</p>";
    document.body.appendChild(el);
    return el;
  };

  it.each([
    ["data-louise-builder", true],
    ["data-louise-blocks", true],
    [undefined, false],
  ])("with %s, the builder is %s", async (attr, expected) => {
    const el = field(attr);
    mountLouise({ onOpenSettings: () => {}, autoSave: false });
    await flush();
    expect(builderOn(el)).toBe(expected);
  });
});
