// happy-dom coverage for the sections dock's draft saves against a changing base
// (#572): the `$base` revision it sends, a buffered save counting as saved, and
// the conflict choice when someone else changed the sections.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";

const CATALOG: SectionCatalog = {
  hero: { label: "Hero", fields: { title: { type: "text" } } },
};

interface Call {
  method: string;
  body: Record<string, unknown> | undefined;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Stub fetch: the versions GET answers `revs`, each POST answers `onPost`. */
function stubFetch(onPost: (n: number) => Response): Call[] {
  const calls: Call[] = [];
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (method === "GET") {
        return Promise.resolve(
          json({ versions: [], publishedVersionId: null, revs: { sections: "r-mount" } }),
        );
      }
      return Promise.resolve(onPost(++posts));
    }),
  );
  return calls;
}

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
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

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

function mount(el: HTMLElement) {
  dispose = mountSections(el, {
    catalog: CATALOG,
    pageId: 1,
    initial: initial(),
    autoSave: { debounceMs: 30 },
  });
}

describe("mountSections — draft saves against a changing base (#572)", () => {
  it("counts a save the KV buffer absorbed as saved, not as an error", async () => {
    stubFetch(() => json({ buffered: true, revs: { sections: "r1" } }));
    const el = host();
    mount(el);
    await vi.advanceTimersByTimeAsync(0);

    type(el.querySelector<HTMLElement>("[data-louise-node]")!, "Typed");
    await vi.advanceTimersByTimeAsync(30);

    expect(document.querySelector('.louise-sections-status[data-status="error"]')).toBeNull();
  });

  it("sends the revision from the versions listing, then the one each save returns", async () => {
    const calls = stubFetch((n) => json({ buffered: true, revs: { sections: `r-save-${n}` } }));
    const el = host();
    mount(el);
    await vi.advanceTimersByTimeAsync(0);
    const node = el.querySelector<HTMLElement>("[data-louise-node]")!;

    type(node, "First");
    await vi.advanceTimersByTimeAsync(30);
    type(node, "Second");
    await vi.advanceTimersByTimeAsync(30);

    const [first, second] = posts(calls);
    expect(first!.body!.$base).toEqual({ sections: "r-mount" });
    expect(second!.body!.$base).toEqual({ sections: "r-save-1" });
  });

  it("offers Keep mine on a conflict, and resends against their revision", async () => {
    const calls = stubFetch((n) =>
      n === 1
        ? json({ conflicts: [{ field: "sections", value: [], rev: "r-theirs" }] }, 409)
        : json({ buffered: true, revs: { sections: "r-mine" } }),
    );
    const el = host();
    mount(el);
    await vi.advanceTimersByTimeAsync(0);

    type(el.querySelector<HTMLElement>("[data-louise-node]")!, "Mine");
    await vi.advanceTimersByTimeAsync(30);

    expect(document.body.textContent).toContain("Someone else changed these sections");
    const keep = document.querySelector<HTMLButtonElement>(".louise-conflict-keep")!;
    expect(document.querySelector(".louise-conflict-reload")).not.toBeNull();

    keep.click();
    await vi.advanceTimersByTimeAsync(0);

    const resent = posts(calls)[1]!;
    expect(resent.body!.$base).toEqual({ sections: "r-theirs" });
    expect(document.querySelector(".louise-conflict-keep")).toBeNull();
  });
});
