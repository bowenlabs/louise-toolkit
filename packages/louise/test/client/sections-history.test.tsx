// The version-history drawer (#540): nothing goes live from history, and a draft
// delete waits for an undo. An older published version opens onto the canvas as
// a new draft; a deleted draft leaves the list at once but is only deleted on
// the server once the undo window ends or the drawer closes.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";
import { OPEN_HISTORY_EVENT } from "../../src/client/editor-events.js";

const CATALOG: SectionCatalog = {
  hero: { label: "Hero", fields: { heading: { type: "text" } } },
  featureGrid: { label: "Feature grid", fields: {} },
};
const INITIAL: SectionItem[] = [{ _type: "hero", heading: "Now" }];

const OLD: SectionItem[] = [{ _type: "hero", heading: "Before" }];
const DRAFT: SectionItem[] = [
  { _type: "hero", heading: "Draft" },
  { _type: "featureGrid" },
  { _type: "quoteBlock" },
];
const VERSIONS = [
  { id: 5, status: "draft", createdAt: 5, versionData: { sections: [] } },
  { id: 3, status: "draft", createdAt: 3, versionData: { sections: DRAFT } },
  { id: 2, status: "published", createdAt: 2, versionData: { sections: INITIAL } },
  { id: 1, status: "published", createdAt: 1, versionData: { sections: OLD } },
];

interface Call {
  url: string;
  method: string;
  body: unknown;
  keepalive: boolean;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body, keepalive: init?.keepalive === true });
      const payload =
        method === "GET"
          ? { versions: VERSIONS, publishedVersionId: 2 }
          : method === "POST" && url.endsWith("/versions")
            ? { version: { id: 4 } }
            : { ok: true };
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

function pageHost(): HTMLElement {
  const el = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-node", "0");
  el.appendChild(sec);
  document.body.appendChild(el);
  return el;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0);
};

async function openHistory(): Promise<{ calls: Call[]; reload: ReturnType<typeof vi.fn> }> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const calls = stubFetch();
  const reload = vi.fn();
  vi.spyOn(window.location, "reload").mockImplementation(reload);
  dispose = mountSections(pageHost(), {
    catalog: CATALOG,
    pageId: 1,
    initial: INITIAL,
    autoSave: false,
  });
  await flush();
  window.dispatchEvent(new CustomEvent(OPEN_HISTORY_EVENT));
  await flush();
  return { calls, reload };
}

const drawer = () => document.querySelector<HTMLElement>(".louise-history-drawer");
const row = (id: number) => drawer()?.querySelector<HTMLElement>(`[data-version-id="${id}"]`);
const rowIds = () =>
  [...(drawer()?.querySelectorAll<HTMLElement>("[data-version-id]") ?? [])].map((r) =>
    Number(r.dataset.versionId),
  );
const button = (scope: HTMLElement | null | undefined, text: string) =>
  [...(scope?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text,
  ) as HTMLButtonElement | undefined;
const undoLine = () => drawer()?.querySelector(".louise-undo-line");
const discards = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/discard"));

describe("version history—open as draft", () => {
  it("summarizes what each version holds", async () => {
    await openHistory();
    expect(row(3)?.querySelector(".louise-version-summary")?.textContent).toBe(
      "3 sections · Hero, Feature grid, …",
    );
    expect(row(1)?.querySelector(".louise-version-summary")?.textContent).toBe("1 section · Hero");
  });

  it("opens an older published version as a draft instead of publishing it", async () => {
    const { calls, reload } = await openHistory();
    expect(button(row(2), "Current")?.disabled).toBe(true);
    expect(button(row(1), "Restore")).toBeUndefined();

    button(row(1), "Open as draft")?.click();
    await flush();

    const draft = calls.find((c) => c.method === "POST" && c.url.endsWith("/versions"));
    expect((draft?.body as { sections: SectionItem[] }).sections).toEqual(OLD);
    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
    expect(reload).toHaveBeenCalled();
  });
});

describe("version history—undoing a draft delete", () => {
  it("hides the row, offers an undo, and sends nothing until the window ends", async () => {
    const { calls } = await openHistory();
    button(row(3), "Delete draft")?.click();
    await flush();

    expect(rowIds()).toEqual([5, 2, 1]);
    expect(undoLine()?.getAttribute("role")).toBe("status");
    expect(undoLine()?.textContent).toContain("Draft deleted");
    // Focus moved to Undo rather than falling to the page with the removed row.
    expect(document.activeElement).toBe(button(undoLine() as HTMLElement, "Undo"));
    expect(discards(calls)).toHaveLength(0);

    // Undo holds the window open while it has focus; leaving it restarts it.
    (document.activeElement as HTMLElement).blur();
    await vi.advanceTimersByTimeAsync(8000);
    await flush();
    expect(discards(calls)).toHaveLength(1);
    expect(discards(calls)[0].body).toEqual({ versionId: 3 });
    expect(discards(calls)[0].keepalive).toBe(true);
    expect(undoLine()?.textContent).toBe("");
  });

  it("brings the draft back on Undo and never deletes it", async () => {
    const { calls } = await openHistory();
    button(row(3), "Delete draft")?.click();
    await flush();
    button(undoLine() as HTMLElement, "Undo")?.click();
    await flush();

    expect(rowIds()).toEqual([5, 3, 2, 1]);
    expect(document.activeElement?.closest("[data-version-id]")).toBe(row(3));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(discards(calls)).toHaveLength(0);
  });

  it("sends the delete when the drawer closes inside the window", async () => {
    const { calls } = await openHistory();
    button(row(3), "Delete draft")?.click();
    await flush();
    button(drawer(), "Close")?.click();
    await flush();

    expect(drawer()).toBeNull();
    expect(discards(calls).map((c) => c.body)).toEqual([{ versionId: 3 }]);
  });

  it("sends the first delete when a second draft is deleted", async () => {
    const { calls } = await openHistory();
    expect(row(5)?.querySelector(".louise-version-summary")?.textContent).toBe("No sections");
    button(row(5), "Delete draft")?.click();
    await flush();
    button(row(3), "Delete draft")?.click();
    await flush();

    // One delete waits at a time: the first went out, and Undo now means the second.
    expect(discards(calls).map((c) => c.body)).toEqual([{ versionId: 5 }]);
    button(undoLine() as HTMLElement, "Undo")?.click();
    await flush();
    expect(rowIds()).toContain(3);
  });
});
