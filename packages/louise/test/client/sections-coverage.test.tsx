// Behavior coverage for mountSections in src/client/sections.tsx (#695): the
// bar's save, publish, and conflict paths, the history drawer's edges, the
// leave-the-page flushes, realtime presence, and structural undo.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";
import { louiseNavigation } from "../../src/client/lifecycle.js";
import { OPEN_HISTORY_EVENT } from "../../src/client/editor-events.js";

const CATALOG: SectionCatalog = {
  hero: { label: "Hero", fields: { heading: { type: "text" } } },
  quote: { label: "Quote", fields: { heading: { type: "text" } } },
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

/** The fragment route's default answer: one marked section with a heading. */
const fragment = (item: { heading?: unknown } | undefined) =>
  new Response(
    `<section data-louise-node="0"><h2 data-louise-node="0.heading">${String(item?.heading ?? "")}</h2></section>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );

/** Record every request; `reply` answers first, then the defaults. */
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
        return Promise.resolve(fragment((body as { item?: { heading?: unknown } })?.item));
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

/** Sections rendered as `<section data-louise-node="i"><h2 …heading>`. */
function pageHost(headings: string[]): HTMLElement {
  const host = document.createElement("div");
  headings.forEach((heading, i) => {
    const sec = document.createElement("section");
    sec.setAttribute("data-louise-node", String(i));
    const h = document.createElement("h2");
    h.setAttribute("data-louise-node", `${i}.heading`);
    h.textContent = heading;
    sec.appendChild(h);
    host.appendChild(sec);
  });
  document.body.appendChild(host);
  return host;
}

let reload: ReturnType<typeof vi.fn<() => void>>;

function mount(
  host: HTMLElement,
  items: SectionItem[],
  extra: Partial<Parameters<typeof mountSections>[1]> = {},
): () => void {
  reload = vi.fn<() => void>();
  vi.spyOn(window.location, "reload").mockImplementation(reload);
  return mountSections(host, {
    catalog: CATALOG,
    pageId: 1,
    initial: items,
    autoSave: false,
    ...extra,
  });
}

const heroes = (headings: string[]): SectionItem[] =>
  headings.map((heading) => ({ _type: "hero", heading }));

const button = (text: string, scope: Element | Document = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text,
  );
const click = (el: Element | null | undefined) =>
  el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const over = (node: Node) => node.dispatchEvent(new Event("mouseover", { bubbles: true }));
const type = (el: HTMLElement, text: string) => {
  el.textContent = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const drafts = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && c.url === "/api/louise/pages/1/versions");
const alertText = () => document.querySelector(".louise-sections-status")?.textContent ?? "";
const statusText = () => document.querySelector(".louise-status")?.textContent ?? "";
const undoKey = (target: EventTarget = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.getElementById("louise-chrome-style")?.remove();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountSections—the bar", () => {
  it("moves its controls into an edit bar that's already on the page", async () => {
    stubFetch();
    const bar = document.createElement("div");
    bar.className = "louise-bar";
    document.body.appendChild(bar);
    dispose = mount(pageHost(["Welcome"]), heroes(["Welcome"]));
    await flush();

    const slot = bar.querySelector(".louise-bar-actions");
    expect(slot).not.toBeNull();
    expect(slot?.querySelector(".louise-publish")).not.toBeNull();
    expect(document.querySelector(".louise-sections-barfallback")).toBeNull();
  });

  it("saves a draft from Save draft, then clears the saved flash", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls = stubFetch();
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await vi.advanceTimersByTimeAsync(0);

    const save = document.querySelector<HTMLButtonElement>(".louise-savedraft");
    expect(save?.getAttribute("aria-disabled")).toBe("true");
    click(save);
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts(calls)).toHaveLength(0);

    type(host.querySelector("h2") as HTMLElement, "Hello, Alex");
    expect(save?.getAttribute("aria-disabled")).toBe("false");
    click(save);
    await vi.advanceTimersByTimeAsync(0);

    expect(drafts(calls).at(-1)?.body).toMatchObject({
      sections: [{ _type: "hero", heading: "Hello, Alex" }],
    });
    expect(statusText()).toBe("Draft saved");
    await vi.advanceTimersByTimeAsync(3000);
    expect(statusText()).toBe("");
  });

  it("stops Enter in a single-line field and skips unmarked nodes", async () => {
    stubFetch();
    const host = pageHost(["Welcome"]);
    const empty = document.createElement("p");
    empty.setAttribute("data-louise-node", "");
    host.appendChild(empty);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    host.querySelector("h2")?.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(empty.hasAttribute("contenteditable")).toBe(false);
  });

  it("shows the server's reason for a refused save, and tolerates a non-JSON body", async () => {
    let answer: () => Response = () =>
      json({ error: "Invalid", violations: [{ message: "Heading is too long." }] }, 422);
    const calls = stubFetch((c) =>
      c.method === "POST" && c.url.endsWith("/versions") ? answer() : undefined,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    type(host.querySelector("h2") as HTMLElement, "A heading that runs long");
    click(document.querySelector(".louise-savedraft"));
    await flush();
    expect(alertText()).toBe(
      "Couldn’t save your draft. Your edits are still here. Heading is too long.",
    );

    answer = () => new Response("<html>oops</html>", { status: 500 });
    click(button("Try again"));
    await flush();
    expect(drafts(calls)).toHaveLength(2);
    expect(alertText()).toBe("Couldn’t save your draft. Your edits are still here.");
  });

  it("reloads onto the other editor's sections when the owner chooses Reload", async () => {
    const calls = stubFetch((c) =>
      c.method === "POST" && c.url.endsWith("/versions")
        ? json({ conflicts: [{ field: "sections", rev: "r9" }] }, 409)
        : undefined,
    );
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    type(host.querySelector("h2") as HTMLElement, "Mine");
    click(document.querySelector(".louise-savedraft"));
    await flush();
    expect(document.querySelector(".louise-conflict")).not.toBeNull();

    // A second save while the choice is open sends nothing.
    click(document.querySelector(".louise-savedraft"));
    await flush();
    expect(drafts(calls)).toHaveLength(1);

    click(document.querySelector(".louise-conflict-reload"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("mountSections—publish", () => {
  it("saves pending edits as a draft, publishes that version, and reloads", async () => {
    const calls = stubFetch((c) =>
      c.method === "POST" && c.url.endsWith("/versions") ? json({ version: { id: 9 } }) : undefined,
    );
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    type(host.querySelector("h2") as HTMLElement, "Launch day");
    click(document.querySelector(".louise-publish"));
    await flush();

    const publish = calls.find((c) => c.url === "/api/louise/pages/1/publish");
    expect(publish?.body).toEqual({ versionId: 9 });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("louise:published")).toBe("1");
  });

  it("says why a publish was refused, and retries it", async () => {
    let answer = () => json({ error: "The page is locked." }, 423);
    const calls = stubFetch((c) => (c.url.endsWith("/publish") ? answer() : undefined));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    type(host.querySelector("h2") as HTMLElement, "Launch day");
    click(document.querySelector(".louise-publish"));
    await flush();

    expect(alertText()).toBe("Couldn’t publish. The live page hasn’t changed. The page is locked.");
    expect(reload).not.toHaveBeenCalled();

    answer = () => new Response("Bad gateway", { status: 502 });
    click(button("Try again"));
    await flush();
    expect(calls.filter((c) => c.url.endsWith("/publish"))).toHaveLength(2);
    expect(alertText()).toBe("Couldn’t publish. The live page hasn’t changed.");
  });

  it("doesn't publish when the draft save before it fails", async () => {
    const calls = stubFetch((c) =>
      c.method === "POST" && c.url.endsWith("/versions") ? json({}, 500) : undefined,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    type(host.querySelector("h2") as HTMLElement, "Launch day");
    click(document.querySelector(".louise-publish"));
    await flush();

    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
    expect(alertText()).toBe("Couldn’t publish. The live page hasn’t changed.");
  });

  it("opens the conflict choice when the save before a publish conflicts", async () => {
    const calls = stubFetch((c) =>
      c.method === "POST" && c.url.endsWith("/versions")
        ? json({ conflicts: [{ field: "sections", rev: "r2" }] }, 409)
        : undefined,
    );
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    type(host.querySelector("h2") as HTMLElement, "Launch day");
    click(document.querySelector(".louise-publish"));
    await flush();

    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
    expect(document.querySelector(".louise-conflict")).not.toBeNull();
  });
});

describe("mountSections—leaving the page", () => {
  it("flushes a pending autosave on blur, pagehide, hidden, and a soft navigation", async () => {
    const calls = stubFetch();
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]), { autoSave: { debounceMs: 60_000 } });
    await flush();
    const h2 = host.querySelector("h2") as HTMLElement;

    type(h2, "One");
    h2.dispatchEvent(new Event("blur"));
    await flush();
    expect(drafts(calls)).toHaveLength(1);

    type(h2, "Two");
    window.dispatchEvent(new Event("pagehide"));
    await flush();
    expect(drafts(calls)).toHaveLength(2);

    type(h2, "Three");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(drafts(calls)).toHaveLength(3);

    type(h2, "Four");
    louiseNavigation.beforeSwap();
    await flush();
    expect(
      drafts(calls).map((c) => (c.body as { sections: SectionItem[] }).sections[0].heading),
    ).toEqual(["One", "Two", "Three", "Four"]);
  });

  it("warns before unload while an edit is unsaved", async () => {
    stubFetch();
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]), { autoSave: { debounceMs: 60_000 } });
    await flush();

    type(host.querySelector("h2") as HTMLElement, "Unsaved");
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
  });
});

describe("mountSections—history drawer", () => {
  it("labels a scheduled version and resumes a draft from its Edit button", async () => {
    const calls = stubFetch((c) =>
      c.method === "GET" && c.url.endsWith("/versions")
        ? json({
            versions: [
              {
                id: 7,
                status: "draft",
                state: "scheduled",
                versionData: { sections: [{ _type: "quote", heading: "Soon" }] },
              },
              { id: 6, status: "draft", state: "pending", versionData: null },
            ],
            publishedVersionId: null,
          })
        : undefined,
    );
    dispose = mount(pageHost(["Welcome"]), heroes(["Welcome"]));
    await flush();

    click(button("History"));
    await flush();
    const drawer = document.querySelector<HTMLElement>(".louise-history-drawer");
    const row7 = drawer?.querySelector<HTMLElement>('[data-version-id="7"]');
    const row6 = drawer?.querySelector<HTMLElement>('[data-version-id="6"]');
    expect(row7?.textContent).toContain("Scheduled");
    expect(row7?.querySelector(".louise-version-summary")?.textContent).toBe("1 section · Quote");
    expect(row6?.querySelector(".louise-version-summary")).toBeNull();

    // A draft with no stored sections has nothing to resume.
    click(button("Edit", row6 as HTMLElement));
    await flush();
    expect(drafts(calls)).toHaveLength(0);

    click(button("Edit", row7 as HTMLElement));
    await flush();
    expect(drafts(calls).at(-1)?.body).toMatchObject({
      sections: [{ _type: "quote", heading: "Soon" }],
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("toggles closed from the History button", async () => {
    stubFetch();
    dispose = mount(pageHost(["Welcome"]), heroes(["Welcome"]));
    await flush();

    click(button("History"));
    await flush();
    expect(document.querySelector(".louise-history-drawer")).not.toBeNull();
    click(button("History"));
    await flush();
    expect(document.querySelector(".louise-history-drawer")).toBeNull();
  });

  it("lists nothing when the versions route fails or answers with non-JSON", async () => {
    let fail = true;
    stubFetch((c) =>
      c.method === "GET" && c.url.endsWith("/versions")
        ? fail
          ? Promise.reject(new TypeError("offline"))
          : new Response("not json", { status: 200 })
        : undefined,
    );
    dispose = mount(pageHost(["Welcome"]), heroes(["Welcome"]));
    await flush();

    window.dispatchEvent(new CustomEvent(OPEN_HISTORY_EVENT));
    await flush();
    expect(document.querySelector(".louise-history-drawer")?.textContent).toContain(
      "No versions yet.",
    );

    fail = false;
    click(button("Close"));
    window.dispatchEvent(new CustomEvent(OPEN_HISTORY_EVENT));
    await flush();
    expect(document.querySelector(".louise-history-drawer")?.textContent).toContain(
      "No versions yet.",
    );
  });

  it("reports a draft delete the server refused, and retries it", async () => {
    let answer = () => json({ error: "Already published." }, 409);
    const calls = stubFetch((c) => {
      if (c.method === "GET" && c.url.endsWith("/versions")) {
        return json({
          versions: [{ id: 4, status: "draft", state: "pending", versionData: { sections: [] } }],
          publishedVersionId: null,
        });
      }
      if (c.url.endsWith("/discard")) return answer();
      return undefined;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    dispose = mount(pageHost(["Welcome"]), heroes(["Welcome"]));
    await flush();

    click(button("History"));
    await flush();
    click(button("Delete draft"));
    click(button("Close"));
    await flush();

    expect(alertText()).toBe("Couldn’t delete the draft. Already published.");

    answer = () => new Response("Service unavailable", { status: 503 });
    click(button("Try again"));
    await flush();
    const discards = calls.filter((c) => c.url.endsWith("/discard"));
    expect(discards.map((c) => c.body)).toEqual([{ versionId: 4 }, { versionId: 4 }]);
    expect(alertText()).toBe("Couldn’t delete the draft.");
  });

  it("reports a failed save when opening an older version as a draft", async () => {
    stubFetch((c) => {
      if (c.method === "GET" && c.url.endsWith("/versions")) {
        return json({
          versions: [
            { id: 2, status: "published", versionData: { sections: heroes(["Now"]) } },
            { id: 1, status: "published", versionData: { sections: heroes(["Then"]) } },
          ],
          publishedVersionId: 2,
        });
      }
      if (c.method === "POST" && c.url.endsWith("/versions")) return json({}, 500);
      return undefined;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    dispose = mount(pageHost(["Now"]), heroes(["Now"]));
    await flush();

    click(button("History"));
    await flush();
    const row1 = document.querySelector<HTMLElement>('[data-version-id="1"]');
    click(button("Open as draft", row1 as HTMLElement));
    await flush();

    expect(reload).not.toHaveBeenCalled();
    expect(alertText()).toBe("Couldn’t save your draft. Your edits are still here.");
  });
});

describe("mountSections—realtime presence", () => {
  it("shows the other editors on the page, and clears them when the socket drops", async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: string) {
        sockets.push(this);
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    stubFetch();
    dispose = mount(pageHost(["Welcome"]), heroes(["Welcome"]), { realtime: true });
    await flush();

    const socket = sockets[0];
    expect(socket).toBeDefined();
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        t: "welcome",
        you: { id: "me", name: "Alex Doe" },
        peers: [
          { id: "me", name: "Alex Doe" },
          { id: "k", name: "Kai Smith" },
        ],
        snapshot: {},
        locks: {},
      }),
    });
    await flush();
    const avatars = () => [...document.querySelectorAll(".louise-presence .louise-avatar")];
    expect(avatars().map((a) => a.getAttribute("title"))).toEqual(["Kai Smith is editing"]);

    socket.readyState = 3;
    socket.onclose?.();
    await flush();
    expect(avatars()).toHaveLength(0);
  });
});

describe("mountSections—structural undo", () => {
  it("adds a section from the picker, and Ctrl+Z takes it back out", async () => {
    stubFetch();
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]), { autoSave: { debounceMs: 60_000 } });
    await flush();

    click(button("Add section"));
    await flush();
    click(button("Quote", document.getElementById("louise-add-section-picker") as HTMLElement));
    await flush();
    expect(host.querySelectorAll(":scope > [data-louise-node]")).toHaveLength(2);

    // Blur on the new section's field flushes the autosave it's wired to.
    const added = host.querySelectorAll<HTMLElement>(":scope > [data-louise-node]")[1];
    added.querySelector("h2")?.dispatchEvent(new Event("blur"));
    await flush();

    undoKey();
    await flush();
    expect(host.querySelectorAll(":scope > [data-louise-node]")).toHaveLength(1);
    expect(document.querySelector(".louise-bar-undo")?.textContent).toBe("Undid: Added Quote");
  });

  it("falls back to save-and-reload when a new section can't render", async () => {
    stubFetch((c) =>
      c.url === "/louise-fragment" ? new Response("", { status: 500 }) : undefined,
    );
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    click(button("Add section"));
    await flush();
    click(button("Quote", document.getElementById("louise-add-section-picker") as HTMLElement));
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reports a failed save when a new section can't render or save", async () => {
    stubFetch((c) => {
      if (c.url === "/louise-fragment") return Promise.reject(new TypeError("offline"));
      if (c.method === "POST" && c.url.endsWith("/versions")) return json({}, 503);
      return undefined;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    click(button("Add section"));
    await flush();
    click(button("Quote", document.getElementById("louise-add-section-picker") as HTMLElement));
    await flush();
    expect(reload).not.toHaveBeenCalled();
    expect(alertText()).toBe("Couldn’t save your draft. Your edits are still here.");
  });

  it("clears the undo notice after its window, and holds it while Undo has focus", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubFetch();
    const host = pageHost(["Welcome", "Second"]);
    dispose = mount(host, heroes(["Welcome", "Second"]));
    await vi.advanceTimersByTimeAsync(0);

    over(host.querySelector("section") as Node);
    click(document.querySelector('.louise-chrome-toolbar button[aria-label^="Delete"]'));
    const notice = () => document.querySelector(".louise-bar-undo")?.textContent ?? "";
    expect(notice()).toContain("Deleted Hero");

    const undo = button("Undo", document.querySelector(".louise-bar-undo") as HTMLElement);
    undo?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(9000);
    expect(notice()).toContain("Deleted Hero");

    undo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(9000);
    expect(notice()).toBe("");
  });

  it("ignores a second Ctrl+Z while the first undo is still running", async () => {
    stubFetch();
    const host = pageHost(["One", "Two", "Three"]);
    dispose = mount(host, heroes(["One", "Two", "Three"]));
    await flush();

    const del = () =>
      click(document.querySelector('.louise-chrome-toolbar button[aria-label^="Delete"]'));
    over(host.querySelector("section") as Node);
    del();
    over(host.querySelector("section") as Node);
    del();
    expect(host.querySelectorAll(":scope > section")).toHaveLength(1);

    undoKey();
    undoKey();
    await flush();
    expect(host.querySelectorAll(":scope > section")).toHaveLength(2);

    // A key that isn't Z leaves the stack alone.
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
    );
    undoKey();
    await flush();
    expect(host.querySelectorAll(":scope > section")).toHaveLength(3);
  });

  it("re-renders a deleted section when its old place has left the page", async () => {
    const calls = stubFetch();
    const host = pageHost(["Welcome"]);
    dispose = mount(host, heroes(["Welcome"]));
    await flush();

    over(host.querySelector("section") as Node);
    click(document.querySelector('.louise-chrome-toolbar button[aria-label^="Delete"]'));
    host.remove();

    undoKey();
    await flush();
    expect(calls.filter((c) => c.url === "/louise-fragment").at(-1)?.body).toEqual({
      item: { _type: "hero", heading: "Welcome" },
    });
    expect(host.querySelectorAll("section")).toHaveLength(1);
  });
});
