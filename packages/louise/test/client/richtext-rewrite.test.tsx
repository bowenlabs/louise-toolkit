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

/** Mount a field, select all of it, and open the sparkle menu. */
async function openRewriteMenu(html = `<p>${ORIGINAL}</p>`) {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  const rt = mountRichText(el, () => {});
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
  vi.fn(
    async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );

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
    expect(alert).toBe("Couldn’t rewrite this right now. Your text hasn’t changed.");
    expect(alert).not.toContain("Rewrite unavailable");
    expect(rt.getHTML()).toContain(ORIGINAL);
  });

  it.each([
    ["rate-limited", "AI is busy right now. Try again in a minute. Your text hasn’t changed."],
    ["truncated", "That’s too much to rewrite at once. Select less, and try again."],
    ["model-retired", "Couldn’t rewrite this right now. Your text hasn’t changed."],
  ])("says what an editor can do when the server's reason is %s", async (reason, message) => {
    vi.stubGlobal("fetch", respond(502, { error: "Rewrite unavailable", reason }));
    const { el, rt } = await openRewriteMenu();

    await pick(el, "Tighten");

    expect(el.querySelector('.louise-tb-ai-menu [role="alert"]')?.textContent).toBe(message);
    expect(rt.getHTML()).toContain(ORIGINAL);
  });

  it("says AI isn't set up on a 503, then retires the control once the menu closes", async () => {
    vi.stubGlobal("fetch", respond(503, { error: "AI unavailable" }));
    const { el } = await openRewriteMenu();

    await pick(el, "Tighten");
    expect(el.querySelector('.louise-tb-ai-menu [role="alert"]')?.textContent).toBe(
      "AI rewrite isn’t set up for this site.",
    );
    el.querySelector<HTMLButtonElement>('[aria-label="Rewrite with AI"]')!.click();
    await tick();
    expect(el.querySelector('[aria-label="Rewrite with AI"]')).toBeNull();
  });
});

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".louise-tb-ai-menu button")].find(
    (b) => b.textContent === text,
  );

describe("RichText AI rewrite—the preview (#544)", () => {
  it("shows the rewrite under the original and changes nothing until Replace", async () => {
    vi.stubGlobal("fetch", respond(200, { text: "A tight passage." }));
    const { el, rt } = await openRewriteMenu();

    await pick(el, "Tighten");
    const preview = el.querySelector(".louise-tb-ai-preview")!;
    expect(preview.textContent).toContain(ORIGINAL);
    expect(preview.textContent).toContain("A tight passage.");
    expect(rt.getHTML()).toContain(ORIGINAL);

    button(el, "Replace")!.click();
    await tick();
    expect(rt.getHTML()).toContain("A tight passage.");
    expect(el.querySelector(".louise-tb-ai-menu")).toBeNull();
  });

  it("leaves the text alone on Discard", async () => {
    vi.stubGlobal("fetch", respond(200, { text: "A tight passage." }));
    const { el, rt } = await openRewriteMenu();

    await pick(el, "Tighten");
    button(el, "Discard")!.click();
    await tick();
    expect(rt.getHTML()).toContain(ORIGINAL);
    expect(el.querySelector(".louise-tb-ai-preview")).toBeNull();
  });
});

describe("RichText AI rewrite—keeping structure (#551)", () => {
  it("sends each block as its own paragraph and puts each answer back in its block", async () => {
    const fetchMock = respond(200, { text: "First, tighter.\n\nSecond, tighter." });
    vi.stubGlobal("fetch", fetchMock);
    const { el, rt } = await openRewriteMenu(
      "<h2>First heading here</h2><p>Second paragraph here</p>",
    );

    await pick(el, "Tighten");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const sent = JSON.parse(String(init.body)) as { text: string };
    expect(sent.text).toBe("First heading here\n\nSecond paragraph here");

    button(el, "Replace")!.click();
    await tick();
    expect(rt.getHTML()).toContain("<h2>First, tighter.</h2>");
    expect(rt.getHTML()).toContain("<p>Second, tighter.</p>");
  });

  it("won't replace when the answer's paragraphs don't line up, and says why", async () => {
    vi.stubGlobal("fetch", respond(200, { text: "Everything merged into one." }));
    const { el, rt } = await openRewriteMenu("<p>One paragraph</p><p>Another paragraph</p>");

    await pick(el, "Tighten");
    expect(el.querySelector(".louise-tb-ai-preview")?.textContent).toContain(
      "The rewrite didn’t keep your paragraphs.",
    );
    expect(button(el, "Replace")!.disabled).toBe(true);
    expect(rt.getHTML()).toContain("Another paragraph");
  });

  it("won't rewrite a selection holding a link, and says why", async () => {
    const fetchMock = respond(200, { text: "Unused." });
    vi.stubGlobal("fetch", fetchMock);
    const { el } = await openRewriteMenu(
      '<p>Read <a href="https://example.com">the guide</a> first.</p>',
    );

    expect(el.querySelector('.louise-tb-ai-menu [role="alert"]')?.textContent).toBe(
      "Rewrite can’t keep links yet. Select text without a link.",
    );
    expect(button(el, "Tighten")!.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notes that bold and italics won't carry over", async () => {
    vi.stubGlobal("fetch", respond(200, { text: "A tight passage." }));
    const { el } = await openRewriteMenu("<p>A <strong>rather</strong> wordy passage.</p>");

    await pick(el, "Tighten");
    expect(el.querySelector(".louise-tb-ai-preview")?.textContent).toContain(
      "formatting in the selection won’t carry over",
    );
  });
});
