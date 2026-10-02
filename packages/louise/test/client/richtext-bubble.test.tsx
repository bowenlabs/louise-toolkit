// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mountRichText } from "../../src/client/RichText.jsx";

// #761: the format bubble is ProseKit's three-element inline popover, so it
// floats over a selection and hides without one, and a field edited on the
// canvas keeps its host element's type.

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function mount(opts?: Parameters<typeof mountRichText>[3]) {
  const el = document.createElement("h1");
  el.innerHTML = "<p>Fresh coffee</p>";
  document.body.appendChild(el);
  const rt = mountRichText(el, () => {}, undefined, opts);
  cleanups.push(() => {
    rt.destroy();
    el.remove();
  });
  return el;
}

describe("the format bubble", () => {
  it("renders the root, positioner, and popup, with the toolbar in the popup", async () => {
    const el = mount();
    await tick();
    const popup = el.querySelector(
      "prosekit-inline-popover-root > prosekit-inline-popover-positioner.louise-format-bubble > prosekit-inline-popover-popup.louise-format-popup",
    );
    expect(popup).not.toBeNull();
    expect(popup?.querySelector('[role="toolbar"]')).not.toBeNull();
    // The root carries no class now: a site rule for the bubble must land on
    // the element that's positioned.
    expect(el.querySelector("prosekit-inline-popover-root")?.className).toBe("");
  });

  it("is hidden until the editor has a selection", async () => {
    const el = mount();
    await tick();
    const popup = el.querySelector<HTMLElement>("prosekit-inline-popover-popup");
    expect(popup?.style.display).toBe("none");

    const pm = el.querySelector(".ProseMirror") as HTMLElement;
    pm.focus();
    document.getSelection()?.selectAllChildren(pm);
    document.dispatchEvent(new Event("selectionchange"));
    await tick();
    expect(popup?.style.display).toBe("");
  });
});

describe("the editing surface", () => {
  it("inherits the host's type on the canvas, which is mountRichText's default", async () => {
    const el = mount();
    await tick();
    const pm = el.querySelector(".ProseMirror");
    expect(pm?.classList.contains("louise-canvas-surface")).toBe(true);
    expect(pm?.classList.contains("louise-prose-surface")).toBe(false);
  });

  it("marks an inline field, whose one paragraph is the editor's", async () => {
    const el = mount({ inline: true });
    await tick();
    expect(el.querySelector(".ProseMirror")?.classList.contains("is-inline")).toBe(true);
    const prose = mount();
    await tick();
    expect(prose.querySelector(".ProseMirror")?.classList.contains("is-inline")).toBe(false);
  });

  it("takes the panel's sizing when asked", async () => {
    const el = mount({ surface: "panel" });
    await tick();
    expect(el.querySelector(".ProseMirror")?.classList.contains("louise-prose-surface")).toBe(true);
  });
});
