// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountRichText } from "../../src/client/RichText.jsx";

// The sparkle menu's failure path (#466, #550). A rewrite that fails must leave
// the selection alone, and must say so: before this, every failure closed the
// menu without a word, so a selection past the route's length cap looked like a
// button that did nothing.

const ORIGINAL = "A rather wordy passage.";
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  vi.unstubAllGlobals();
});

/** Mount a field, select its paragraph, and open the sparkle menu. */
async function openRewriteMenu() {
  const el = document.createElement("div");
  el.innerHTML = `<p>${ORIGINAL}</p>`;
  document.body.appendChild(el);
  const rt = mountRichText(el, () => {});
  cleanups.push(() => {
    rt.destroy();
    el.remove();
  });
  await tick();

  const pm = el.querySelector(".ProseMirror") as HTMLElement;
  pm.focus();
  document.getSelection()?.selectAllChildren(pm.querySelector("p") as HTMLElement);
  document.dispatchEvent(new Event("selectionchange"));
  await tick();

  const trigger = el.querySelector<HTMLButtonElement>('[aria-label="Rewrite with AI"]');
  expect(trigger?.disabled).toBe(false);
  trigger?.click();
  await tick();
  return { el, rt };
}

/** Click a mode in the open menu and let the request settle. */
async function pick(el: HTMLElement, label: string) {
  const item = [...el.querySelectorAll<HTMLButtonElement>(".louise-tb-ai-item")].find(
    (b) => b.textContent === label,
  );
  expect(item).toBeDefined();
  item?.click();
  await tick(60);
}

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("RichText AI rewrite—failures", () => {
  it("shows the server's message for a selection past the cap, and keeps the text", async () => {
    const message = "Select a shorter passage. Rewrite works on up to 1,536 characters at a time.";
    vi.stubGlobal("fetch", respond(413, { error: message }));
    const { el, rt } = await openRewriteMenu();

    await pick(el, "Tighten");

    expect(el.querySelector('.louise-tb-ai-menu [role="alert"]')?.textContent).toBe(message);
    expect(rt.getHTML()).toContain(ORIGINAL);
  });

  it("shows a plain message for a model failure, not the log-facing error", async () => {
    vi.stubGlobal("fetch", respond(502, { error: "Rewrite unavailable" }));
    const { el, rt } = await openRewriteMenu();

    await pick(el, "Rephrase");

    const alert = el.querySelector('.louise-tb-ai-menu [role="alert"]')?.textContent ?? "";
    expect(alert).toContain("Your text is unchanged");
    expect(alert).not.toContain("Rewrite unavailable");
    expect(rt.getHTML()).toContain(ORIGINAL);
  });

  it("swaps in a successful rewrite and closes the menu", async () => {
    vi.stubGlobal("fetch", respond(200, { text: "A tight passage." }));
    const { el, rt } = await openRewriteMenu();

    await pick(el, "Tighten");

    expect(rt.getHTML()).toContain("A tight passage.");
    expect(el.querySelector(".louise-tb-ai-menu")).toBeNull();
  });
});
