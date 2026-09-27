// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mountRichText } from "../../src/client/RichText.jsx";

// #605: the text-color swatches are the site's to choose, and the default offers
// brand roles only, not the state colors that read as a message.

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

/** Mount a field, select its text, and open the color popover. */
async function swatches(opts?: Parameters<typeof mountRichText>[3]) {
  const el = document.createElement("div");
  el.innerHTML = "<p>Fresh coffee</p>";
  document.body.appendChild(el);
  const rt = mountRichText(el, () => {}, undefined, opts);
  cleanups.push(() => {
    rt.destroy();
    el.remove();
  });
  await tick();
  const pm = el.querySelector(".ProseMirror") as HTMLElement;
  pm.focus();
  document.getSelection()?.selectAllChildren(pm);
  document.dispatchEvent(new Event("selectionchange"));
  await tick();
  const trigger = el.querySelector<HTMLButtonElement>('[aria-label="Text color"]');
  trigger?.click();
  await tick();
  const labels = [
    ...el.querySelectorAll<HTMLButtonElement>(".louise-swatch:not(.louise-swatch-clear)"),
  ].map((b) => b.getAttribute("aria-label"));
  return { el, trigger, labels };
}

describe("rich-text color swatches", () => {
  it("offers the brand roles by default, not the state colors", async () => {
    const { labels } = await swatches();
    expect(labels).toEqual([
      "Text color Primary",
      "Text color Secondary",
      "Text color Accent",
      "Text color Neutral",
    ]);
  });

  it("offers the site's own list, and skips a token no theme variable could match", async () => {
    const { el, labels } = await swatches({
      colors: [
        { label: "Brand orange", token: "brand-orange" },
        { label: "Broken", token: "red; background: url(x)" },
      ],
    });
    expect(labels).toEqual(["Text color Brand orange"]);
    const swatch = el.querySelector<HTMLButtonElement>(".louise-swatch:not(.louise-swatch-clear)");
    expect(swatch?.style.background).toBe("var(--color-brand-orange)");
  });

  it("hides the color button for an empty list", async () => {
    const { trigger } = await swatches({ colors: [] });
    expect(trigger).toBeNull();
  });
});
