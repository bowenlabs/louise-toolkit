// The edit bar's Publish (#597): the one filled action, reachable and explained
// while there's nothing to publish, and confirmed after the reload a publish
// ends in. Plus the realtime soft-lock, whose holder a screen reader now hears.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountLouise } from "../../src/client/index.js";
import { louiseNavigation } from "../../src/client/lifecycle.js";
import { markPublished } from "../../src/client/published-flag.js";
import { mountSections } from "../../src/client/sections.jsx";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch() {
  const mock = vi.fn((input: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") return Promise.resolve(jsonResponse({ versions: [] }));
    return Promise.resolve(jsonResponse({ buffered: true, revs: {} }));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function addField(name: string, value: string, type?: string): HTMLElement {
  const el = document.createElement("div");
  el.dataset.louiseField = `pages:5:${name}`;
  if (type) el.dataset.louiseType = type;
  el.textContent = value;
  document.body.appendChild(el);
  return el;
}

const publishButton = () =>
  document.querySelector<HTMLButtonElement>(".louise-bar .louise-publish")!;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
});

afterEach(() => {
  louiseNavigation.afterSwap();
  delete document.documentElement.dataset.louiseMounted;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("the edit bar's Publish", () => {
  it("stays in the tab order while there's nothing to publish, and says why", async () => {
    const fetchMock = stubFetch();
    const el = addField("heroHeadline", "old");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 }, versionedPageId: 5 });
    await flush();

    const publish = publishButton();
    expect(publish.disabled).toBe(false);
    expect(publish.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(publish.getAttribute("aria-describedby")!)!;
    expect(reason.textContent).toBe("Nothing to publish yet");
    expect(reason.hidden).toBe(false);

    publish.click();
    await flush();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/publish"))).toBe(false);

    el.textContent = "new";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    expect(publish.getAttribute("aria-disabled")).toBe("false");
    expect(reason.hidden).toBe(true);
  });

  it("remembers the publish across the reload, and says the page is live after it", async () => {
    stubFetch();
    const el = addField("heroHeadline", "old");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 }, versionedPageId: 5 });
    await flush();
    el.textContent = "new";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    publishButton().click();
    await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    expect(sessionStorage.getItem("louise:published")).toBe("5");

    // The reload: mount again on the same page.
    louiseNavigation.afterSwap();
    delete document.documentElement.dataset.louiseMounted;
    document.body.replaceChildren();
    addField("heroHeadline", "new");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 }, versionedPageId: 5 });
    await vi.waitFor(() =>
      expect(document.querySelector(".louise-bar .louise-status")?.textContent).toBe(
        "Published. Your page is live.",
      ),
    );
    expect(sessionStorage.getItem("louise:published")).toBeNull();
  });

  it("says a failed publish didn't publish, with the server's reason (#704)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const publishReply = vi.fn<() => Promise<Response>>();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") return Promise.resolve(jsonResponse({ versions: [] }));
        if (String(input).endsWith("/publish")) return publishReply();
        return Promise.resolve(jsonResponse({ buffered: true, revs: {} }));
      }),
    );
    const el = addField("heroHeadline", "old");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 }, versionedPageId: 5 });
    await flush();
    el.textContent = "new";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const status = () => document.querySelector<HTMLElement>(".louise-bar .louise-status")!;

    publishReply.mockResolvedValueOnce(jsonResponse({ error: "Title is required." }, 422));
    publishButton().click();
    await vi.waitFor(() =>
      expect(status().textContent).toBe(
        "Couldn’t publish. The live page hasn’t changed. Title is required.",
      ),
    );
    expect(status().dataset.status).toBe("error");

    publishReply.mockRejectedValueOnce(new TypeError("offline"));
    publishButton().click();
    await vi.waitFor(() =>
      expect(status().textContent).toBe("Couldn’t publish. The live page hasn’t changed."),
    );
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("louise:published")).toBeNull();
  });

  it("ignores a flag left for another page", async () => {
    stubFetch();
    markPublished(9);
    addField("heroHeadline", "old");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 }, versionedPageId: 5 });
    await flush();
    await flush();
    expect(document.querySelector(".louise-bar .louise-status")?.textContent).toBe("");
    expect(sessionStorage.getItem("louise:published")).toBe("9");
  });
});

describe("the sections bar's Publish", () => {
  function mountDock() {
    const host = document.createElement("div");
    host.setAttribute("data-louise-sections", "1");
    document.body.appendChild(host);
    return mountSections(host, {
      catalog: { promo: { label: "Promo", fields: { heading: { type: "text" } } } },
      pageId: 5,
      initial: [],
      autoSave: { debounceMs: 0 },
    });
  }

  it("explains an unavailable Publish, and says the page is live after a publish", async () => {
    stubFetch();
    markPublished(5);
    const dispose = mountDock();
    await flush();
    await flush();

    const publish = document.querySelector<HTMLButtonElement>(".louise-publish")!;
    expect(publish.disabled).toBe(false);
    expect(publish.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(publish.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Nothing to publish yet",
    );
    const status = document.querySelector('[role="status"].louise-status')!;
    expect(status.textContent).toBe("Published. Your page is live.");
    dispose();
  });
});

describe("a field a peer holds", () => {
  /** The socket the realtime client opens, driven by hand. */
  class FakeSocket {
    static last: FakeSocket | undefined;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      FakeSocket.last = this;
    }
    send() {}
    close() {
      this.readyState = 3;
    }
    emit(msg: unknown) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
  }

  it("names the holder in text the editable points at, and marks it read-only", async () => {
    stubFetch();
    vi.stubGlobal("WebSocket", FakeSocket);
    const el = addField("body", "", "richtext");
    mountLouise({ onOpenSettings: () => {}, versionedPageId: 5, realtime: true });
    await flush();

    const socket = FakeSocket.last!;
    socket.readyState = 1;
    socket.onopen?.();
    socket.emit({
      v: 1,
      t: "welcome",
      you: { id: "u1", name: "Kai" },
      peers: [
        { id: "u1", name: "Kai" },
        { id: "u2", name: "Alex" },
      ],
      snapshot: {},
      locks: { body: "u2" },
    });

    const note = el.querySelector(".louise-lock-note")!;
    expect(note.textContent).toBe("Alex is editing this field");
    const surface = el.querySelector<HTMLElement>('[contenteditable="true"]')!;
    expect(surface.getAttribute("aria-readonly")).toBe("true");
    expect(surface.getAttribute("aria-describedby")).toBe(note.id);
    expect(el.hasAttribute("aria-disabled")).toBe(false);

    socket.emit({ v: 1, t: "locks", locks: {} });
    expect(el.querySelector(".louise-lock-note")).toBeNull();
    expect(surface.hasAttribute("aria-readonly")).toBe(false);
  });
});
