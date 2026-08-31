// happy-dom coverage for auto-save on the inline field surface (mountLouise):
// a debounced live save after typing, no manual Save button while auto-save is
// on, edit-during-save is never dropped, a visibilitychange flush, the
// view-transition (before-swap / after-swap) lifecycle (#74), and
// the opt-out path. Plain-text markers only — no ProseKit — so the DOM is stable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountLouise } from "../../src/client/index.js";
import { louiseNavigation } from "../../src/client/lifecycle.js";

/** Install a fetch stub; returns the mock so tests can assert calls. */
function stubFetch(
  handler: (url: string, method: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const mock = vi.fn((input: string | URL, init?: RequestInit) =>
    Promise.resolve(
      handler(
        typeof input === "string" ? input : input.toString(),
        (init?.method ?? "GET").toUpperCase(),
        init,
      ),
    ),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function addField(collection: string, key: string, name: string, value: string): HTMLElement {
  const el = document.createElement("h1");
  el.dataset.louiseField = `${collection}:${key}:${name}`;
  el.textContent = value;
  document.body.appendChild(el);
  return el;
}

/** Simulate typing into a plain-text field (set text + fire the input event). */
function type(el: HTMLElement, text: string): void {
  el.textContent = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const bodyOf = (init?: RequestInit) => JSON.parse((init?.body as string) ?? "{}");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // mountLouise is idempotent via this flag — reset it, and remove what it
  // injected, so the next test mounts fresh. after-swap also drops the
  // module-level `activeInline` (the shared leave handlers are wired once and
  // persist across tests), so a stray event can't flush a defunct mount.
  louiseNavigation.afterSwap();
  delete document.documentElement.dataset.louiseMounted;
  document.querySelectorAll(".louise-bar, [data-louise-field]").forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mountLouise — auto-save (inline live fields)", () => {
  it("saves a changed field after the debounce, with no manual Save button", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const el = addField("settings", "1", "heroHeadline", "old");

    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 } });

    // No manual Save button while auto-save drives saves.
    expect(document.querySelector(".louise-save")).toBeNull();

    type(el, "new headline");
    expect(fetchMock).not.toHaveBeenCalled(); // still debouncing
    await vi.advanceTimersByTimeAsync(50);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/louise/save");
    expect(bodyOf(init)).toMatchObject({
      collection: "settings",
      key: "1",
      field: "heroHeadline",
      value: "new headline",
    });
    // keepalive lets the save survive an unload-time flush.
    expect((init as RequestInit).keepalive).toBe(true);
  });

  it("coalesces rapid edits into a single save", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const el = addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 } });

    type(el, "a");
    type(el, "ab");
    type(el, "abc");
    await vi.advanceTimersByTimeAsync(50);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0][1]).value).toBe("abc");
  });

  it("does not drop an edit made while a save is in flight", async () => {
    const values: string[] = [];
    let release = () => {};
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
      values.push(bodyOf(init).value);
      if (values.length === 1) {
        return new Promise<Response>((resolve) => {
          release = () => resolve(new Response(null, { status: 200 }));
        });
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const el = addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 } });

    type(el, "v1");
    await vi.advanceTimersByTimeAsync(50); // save #1 starts, awaits
    expect(values).toEqual(["v1"]);

    type(el, "v2"); // edit while save #1 is in flight
    await vi.advanceTimersByTimeAsync(50);
    expect(values).toHaveLength(1); // no overlapping save

    release(); // save #1 finishes → re-run saves the newer value
    await vi.advanceTimersByTimeAsync(50);
    expect(values).toEqual(["v1", "v2"]);
  });

  it("flushes immediately when the tab is hidden (no debounce wait)", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const el = addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 5000 } });

    type(el, "urgent");
    // Simulate the tab being hidden before the long debounce elapses.
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0][1]).value).toBe("urgent");
  });

  it("opt-out (autoSave:false) renders a Save button and never auto-saves", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const el = addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: false });

    const saveBtn = document.querySelector<HTMLButtonElement>(".louise-save");
    expect(saveBtn).not.toBeNull();

    type(el, "typed");
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled(); // no debounced save

    // A manual click still saves.
    saveBtn?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("mountLouise — auto-save via Astro Action (#138)", () => {
  it("routes a normal debounced live save through the injected Action, not the raw route", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const save = vi.fn(async (_input: unknown) => ({ ok: true }));
    const el = addField("settings", "1", "heroHeadline", "old");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 }, actions: { save } });

    type(el, "new headline");
    await vi.advanceTimersByTimeAsync(50);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      collection: "settings",
      key: "1",
      field: "heroHeadline",
      value: "new headline",
    });
    expect(fetchMock).not.toHaveBeenCalled(); // the Action replaced the raw fetch
  });

  it("falls back to the raw keepalive fetch on unload, even with an Action injected", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const save = vi.fn(async (_input: unknown) => ({ ok: true }));
    const el = addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 5000 }, actions: { save } });

    type(el, "urgent");
    // Tab hidden → the flush must use keepalive (an Action can't), so the save
    // survives the navigation.
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(save).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
  });

  it("routes a versioned draft save through the injected saveDraft Action", async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(JSON.stringify({ version: { id: 9 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const saveDraft = vi.fn(async (_input: unknown) => ({ version: { id: 9 } }));
    const el = addField("pages", "5", "heroHeadline", "old");
    mountLouise({
      onOpenSettings: () => {},
      autoSave: { debounceMs: 50 },
      versionedPageId: 5,
      actions: { saveDraft },
    });

    type(el, "draft text");
    await vi.advanceTimersByTimeAsync(50);

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft.mock.calls[0][0]).toEqual({ id: 5, data: { heroHeadline: "draft text" } });
    // The Action handled the save — no POST to the raw versions route. (A GET to
    // load the draft-state for the Publish button on mount is fine.)
    const posts = fetchMock.mock.calls.filter(
      ([, init]) => ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() === "POST",
    );
    expect(posts).toHaveLength(0);
  });
});

describe("mountLouise — view transitions (#74)", () => {
  it("flushes pending edits on before-swap (soft nav fires nothing else)", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const el = addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 5000 } });

    type(el, "mid-edit");
    // A view-transition nav fires none of pagehide/visibilitychange — only
    // before-swap — so without a flush hung off it the edit is lost.
    louiseNavigation.beforeSwap();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0][1]).value).toBe("mid-edit");
    // keepalive so the POST survives the swap that's about to replace the page.
    expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
  });

  it("uses the raw keepalive fetch on before-swap even with an Action injected", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const save = vi.fn(async (_input: unknown) => ({ ok: true }));
    const el = addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 5000 }, actions: { save } });

    type(el, "urgent");
    louiseNavigation.beforeSwap();
    await vi.advanceTimersByTimeAsync(0);

    // An Action can't keepalive, so the swap flush must fall back to the raw fetch.
    expect(save).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
  });

  it("clears the mount guard on after-swap so the next page re-mounts", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 } });
    expect(document.documentElement.dataset.louiseMounted).toBe("1");

    // <html> survives the swap, so the guard is cleared here rather than by the
    // (replaced) body — otherwise the next page could never re-mount.
    louiseNavigation.afterSwap();
    expect(document.documentElement.dataset.louiseMounted).toBeUndefined();
  });

  it("re-mounts against the NEW page's fields after a swap, without stacking handlers", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    // Page A.
    addField("settings", "1", "heroHeadline", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 } });

    // Soft-nav away: flush, then the swap replaces <body> (bar + fields gone).
    louiseNavigation.beforeSwap();
    louiseNavigation.afterSwap();
    document.querySelectorAll(".louise-bar, [data-louise-field]").forEach((n) => n.remove());

    // Page B (new body, different field) → re-mount, as the page-load
    // bootstrap does. The guard was cleared on after-swap, so this proceeds.
    const b = addField("pages", "9", "title", "");
    mountLouise({ onOpenSettings: () => {}, autoSave: { debounceMs: 50 } });
    // One bar for the new page — the swap removed page A's, and re-mount adds one.
    expect(document.querySelectorAll(".louise-bar")).toHaveLength(1);

    fetchMock.mockClear();
    type(b, "page B title");
    // Exactly one flush on the next before-swap: the leave handlers are wired once
    // (not per mount), so two mount cycles don't double-save.
    louiseNavigation.beforeSwap();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0][1])).toMatchObject({
      collection: "pages",
      key: "9",
      field: "title",
      value: "page B title",
    });
  });
});
