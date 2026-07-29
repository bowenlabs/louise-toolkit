// happy-dom coverage for auto-save on the sections surface (mountSections):
// a debounced draft save after an in-place text edit, no manual Save draft
// button while auto-save is on (Publish stays), and the opt-out path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  // `textarea` is the declaration that a field holds more than one line — the
  // render used to say so with a `data-louise-multiline` stamp (ADR 0010 A2).
  hero: { label: "Hero", fields: { title: { type: "text" }, tagline: { type: "textarea" } } },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Stub fetch and record every call; answers the versions GET/POST. */
function stubFetch(): { calls: Call[]; mock: ReturnType<typeof vi.fn> } {
  const calls: Call[] = [];
  const mock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify({ versions: [], publishedVersionId: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ version: { id: 2 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

/** A bespoke render with one in-place editable text node. */
function host(): HTMLElement {
  const el = document.createElement("div");
  const h1 = document.createElement("h1");
  h1.setAttribute("data-louise-node", "0.title");
  h1.textContent = "Hi";
  el.appendChild(h1);
  document.body.appendChild(el);
  return el;
}

function type(el: HTMLElement, text: string): void {
  el.textContent = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const initial = (): SectionItem[] => [{ _type: "hero", title: "Hi" }];

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.querySelectorAll("div, .louise-sections-dock").forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mountSections — auto-save (sections drafts)", () => {
  it("stages a draft after an in-place edit, with no manual Save draft button", async () => {
    const { calls } = stubFetch();
    const el = host();
    dispose = mountSections(el, {
      catalog: CATALOG,
      pageId: 1,
      initial: initial(),
      autoSave: { debounceMs: 30 },
    });

    // Auto-save on ⇒ Publish stays, Save draft is gone.
    expect(document.querySelector(".louise-savedraft")).toBeNull();
    expect(document.querySelector(".louise-publish")).not.toBeNull();

    const node = el.querySelector<HTMLElement>("[data-louise-node]");
    if (!node) throw new Error("sfield not wired");
    type(node, "Typed heading");
    await vi.advanceTimersByTimeAsync(30);

    const drafts = calls.filter(
      (c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions",
    );
    expect(drafts).toHaveLength(1);
    expect((drafts[0].body as { sections: SectionItem[] }).sections[0]).toMatchObject({
      _type: "hero",
      title: "Typed heading",
    });

    // Never auto-publishes.
    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
  });

  it("flushes a pending draft on astro:before-swap — view-transition nav (#74)", async () => {
    const { calls } = stubFetch();
    const el = host();
    dispose = mountSections(el, {
      catalog: CATALOG,
      pageId: 1,
      initial: initial(),
      autoSave: { debounceMs: 5000 },
    });

    const node = el.querySelector<HTMLElement>("[data-louise-node]");
    if (!node) throw new Error("sfield not wired");
    type(node, "Swept heading");
    // A soft nav fires astro:before-swap (not pagehide) — the dock must flush the
    // pending draft before its DOM is swapped away, or the in-flight edit is lost.
    document.dispatchEvent(new Event("astro:before-swap"));
    await vi.advanceTimersByTimeAsync(0);

    const drafts = calls.filter(
      (c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions",
    );
    expect(drafts).toHaveLength(1);
    expect((drafts[0].body as { sections: SectionItem[] }).sections[0]).toMatchObject({
      _type: "hero",
      title: "Swept heading",
    });
  });

  it("drops its before-swap listener on teardown, so a re-mount can't double-flush", async () => {
    const { calls } = stubFetch();
    const el = host();
    const teardown = mountSections(el, {
      catalog: CATALOG,
      pageId: 1,
      initial: initial(),
      autoSave: { debounceMs: 5000 },
    });
    const node = el.querySelector<HTMLElement>("[data-louise-node]");
    if (!node) throw new Error("sfield not wired");
    type(node, "torn down");
    // The astro:page-load bootstrap tears the old dock down before re-mounting the
    // next page's — its listeners (incl. before-swap) must go with it.
    teardown();
    dispose = undefined;

    calls.length = 0;
    document.dispatchEvent(new Event("astro:before-swap"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("opt-out (autoSave:false) keeps a Save draft button and never auto-saves", async () => {
    const { calls } = stubFetch();
    const el = host();
    dispose = mountSections(el, {
      catalog: CATALOG,
      pageId: 1,
      initial: initial(),
      autoSave: false,
    });

    expect(document.querySelector(".louise-savedraft")).not.toBeNull();

    const node = el.querySelector<HTMLElement>("[data-louise-node]");
    if (!node) throw new Error("sfield not wired");
    type(node, "Typed heading");
    await vi.advanceTimersByTimeAsync(1000);

    expect(calls.some((c) => c.method === "POST")).toBe(false); // no debounced draft
  });
});

describe("mountSections — native spellcheck (#142)", () => {
  it("turns spellcheck on for multiline fields, leaves single-line labels off", () => {
    stubFetch();
    const el = document.createElement("div");
    const single = document.createElement("h1");
    single.setAttribute("data-louise-node", "0.title");
    single.textContent = "Hi";
    const multi = document.createElement("p");
    multi.setAttribute("data-louise-node", "0.tagline");
    multi.textContent = "A longer, prose-y tagline";
    el.appendChild(single);
    el.appendChild(multi);
    document.body.appendChild(el);

    dispose = mountSections(el, { catalog: CATALOG, pageId: 1, initial: initial() });

    // Single-line headline: squiggles are noise → off. Multiline prose: on.
    expect(single.getAttribute("spellcheck")).toBe("false");
    expect(multi.getAttribute("spellcheck")).toBe("true");
  });
});
