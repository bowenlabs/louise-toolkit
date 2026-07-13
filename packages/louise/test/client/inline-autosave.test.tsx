// happy-dom coverage for auto-save on the inline field surface (mountLouise):
// a debounced live save after typing, no manual Save button while auto-save is
// on, edit-during-save is never dropped, a visibilitychange flush, and the
// opt-out path. Plain-text markers only — no ProseKit — so the DOM is stable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountLouise } from "../../src/client/index.js";

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
  // injected, so the next test mounts fresh.
  delete document.documentElement.dataset.louiseMounted;
  document.querySelectorAll(".louise-bar, [data-louise-field]").forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mountLouise — auto-save (inline live fields)", () => {
  it("saves a changed field after the debounce, with no manual Save button", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 200 }));
    const el = addField("settings", "1", "heroHeadline", "old");

    mountLouise({ onOpenDrawer: () => {}, autoSave: { debounceMs: 50 } });

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
    mountLouise({ onOpenDrawer: () => {}, autoSave: { debounceMs: 50 } });

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
    mountLouise({ onOpenDrawer: () => {}, autoSave: { debounceMs: 50 } });

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
    mountLouise({ onOpenDrawer: () => {}, autoSave: { debounceMs: 5000 } });

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
    mountLouise({ onOpenDrawer: () => {}, autoSave: false });

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
