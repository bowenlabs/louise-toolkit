// Behavior coverage for mountLouise in src/client/index.ts (#695): marker
// parsing, the page-lifetime leave handlers and navigation guard, live and
// draft save failures, the conflict's Reload, publish failures, and the
// realtime path (presence, remote echo, soft-locks, and the pre-publish draft).

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountLouise } from "../../src/client/index.js";
import { louiseNavigation } from "../../src/client/lifecycle.js";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

function stubFetch(reply: (c: Call) => Response | Promise<Response> | undefined = () => undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const raw = init?.body;
      const call = { url, method, body: typeof raw === "string" ? JSON.parse(raw) : raw };
      calls.push(call);
      const custom = reply(call);
      if (custom) return Promise.resolve(custom);
      if (method === "GET") return Promise.resolve(json({ versions: [] }));
      return Promise.resolve(json({ ok: true }));
    }),
  );
  return calls;
}

function addField(marker: string, value = "", tag = "h1"): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.louiseField = marker;
  el.textContent = value;
  document.body.appendChild(el);
  return el;
}

const type = (el: HTMLElement, text: string) => {
  el.textContent = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const bar = (selector: string) => document.querySelector<HTMLElement>(`.louise-bar ${selector}`);
const statusText = () => bar(".louise-status")?.textContent ?? "";
const posts = (calls: Call[], suffix: string) =>
  calls.filter((c) => c.method === "POST" && c.url.endsWith(suffix));

let reload: ReturnType<typeof vi.fn<() => void>>;
const mount = (opts: Partial<Parameters<typeof mountLouise>[0]> = {}) => {
  reload = vi.fn<() => void>();
  vi.spyOn(window.location, "reload").mockImplementation(reload);
  mountLouise({ onOpenSettings: () => {}, ...opts });
};

afterEach(() => {
  louiseNavigation.afterSwap();
  delete document.documentElement.dataset.louiseMounted;
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountLouise—markers and the page guard", () => {
  it("skips a malformed field marker and mounts only once per page", () => {
    stubFetch();
    const empty = addField("");
    const partial = addField("settings:1");
    const good = addField("settings:1:siteName", "Example Organization");
    mount({ autoSave: false });
    mount({ autoSave: false });

    expect(empty.hasAttribute("contenteditable")).toBe(false);
    expect(partial.hasAttribute("contenteditable")).toBe(false);
    expect(good.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(document.querySelectorAll(".louise-bar")).toHaveLength(1);
  });

  it("keeps Enter out of a single-line field", () => {
    stubFetch();
    const el = addField("settings:1:siteName", "Example Organization");
    mount({ autoSave: false });
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    el.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });

  it("holds links inside an edited region and every page form, but not the bar's own", () => {
    stubFetch();
    const field = addField("settings:1:cta", "", "div");
    const inner = document.createElement("a");
    inner.href = "https://example.com/shop";
    field.appendChild(inner);
    const nav = document.createElement("a");
    nav.href = "https://example.com/about";
    document.body.appendChild(nav);
    const form = document.createElement("form");
    document.body.appendChild(form);
    mount({ autoSave: false });

    const clickOn = (el: Element) => {
      const e = new MouseEvent("click", { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const submit = (el: Element) => {
      const e = new Event("submit", { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(clickOn(inner)).toBe(true);
    expect(clickOn(nav)).toBe(false);
    expect(submit(form)).toBe(true);

    const barForm = document.createElement("form");
    document.querySelector(".louise-bar")?.appendChild(barForm);
    expect(submit(barForm)).toBe(false);
  });
});

describe("mountLouise—leave handlers", () => {
  it("clears the unloading flag when the tab returns, and warns before unload while dirty", async () => {
    const actionSave = vi.fn(() => Promise.resolve());
    const calls = stubFetch(() => new Promise<Response>(() => {}));
    const el = addField("settings:1:siteName", "Example Organization");
    mount({ autoSave: { debounceMs: 60_000 }, actions: { save: actionSave } });

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    // Back in view, a flush on blur goes through the Action again.
    type(el, "Example Organization East");
    el.dispatchEvent(new Event("blur"));
    await flush();
    expect(actionSave).toHaveBeenCalledTimes(1);

    // A save hanging on the wire keeps the edit dirty, so leaving warns.
    type(el, "Example Organization West");
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    expect(posts(calls, "/api/louise/save").at(-1)?.body).toMatchObject({
      value: "Example Organization West",
    });
  });
});

describe("mountLouise—save failures", () => {
  it("says a live save failed", async () => {
    stubFetch((c) => (c.url === "/api/louise/save" ? json({}, 500) : undefined));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const el = addField("settings:1:siteName", "Example Organization");
    mount({ autoSave: false });

    type(el, "Example Organization West");
    bar(".louise-save")?.click();
    await flush();
    expect(statusText()).toBe("Couldn’t save");
    expect(bar(".louise-save")?.getAttribute("aria-disabled")).toBe("false");
  });

  it("says a draft save failed", async () => {
    stubFetch((c) =>
      c.url.endsWith("/versions") && c.method === "POST" ? json({}, 500) : undefined,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const el = addField("pages:3:title", "About");
    mount({ autoSave: false, versionedPageId: 3 });

    type(el, "About us");
    bar(".louise-savedraft")?.click();
    await flush();
    expect(statusText()).toBe("Couldn’t save");
  });

  it("drops the edits and reloads when the owner picks Reload on a conflict", async () => {
    stubFetch((c) =>
      c.url.endsWith("/versions") && c.method === "POST"
        ? json({ conflicts: [{ field: "title", rev: "r2" }] }, 409)
        : undefined,
    );
    const el = addField("pages:3:title", "About");
    mount({ autoSave: false, versionedPageId: 3 });

    type(el, "About us");
    bar(".louise-savedraft")?.click();
    await flush();
    bar(".louise-conflict-reload")?.click();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(bar(".louise-savedraft")?.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("mountLouise—publish", () => {
  it("offers Publish for a draft found on mount, and says a refused publish failed", async () => {
    const calls = stubFetch((c) => {
      if (c.method === "GET")
        return json({ versions: [{ status: "draft" }], revs: { title: "r1" } });
      if (c.url.endsWith("/publish")) return json({ error: "Locked." }, 423);
      return undefined;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    addField("pages:3:title", "About");
    mount({ autoSave: false, versionedPageId: 3 });
    await flush();

    const publish = bar(".louise-publish");
    expect(publish?.getAttribute("aria-disabled")).toBe("false");
    publish?.click();
    await flush();
    expect(posts(calls, "/publish")).toHaveLength(1);
    expect(statusText()).toBe("Couldn’t publish. The live page hasn’t changed. Locked.");
    expect(reload).not.toHaveBeenCalled();
  });

  it("doesn't publish when the draft save before it fails", async () => {
    const calls = stubFetch((c) =>
      c.url.endsWith("/versions") && c.method === "POST" ? json({}, 500) : undefined,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const el = addField("pages:3:title", "About");
    mount({ autoSave: false, versionedPageId: 3 });

    type(el, "About us");
    bar(".louise-publish")?.click();
    await flush();
    expect(posts(calls, "/publish")).toHaveLength(0);
  });
});

describe("mountLouise—realtime", () => {
  class FakeSocket {
    static all: FakeSocket[] = [];
    readyState = 0;
    sent: Record<string, unknown>[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      FakeSocket.all.push(this);
    }
    send(data: string) {
      this.sent.push(JSON.parse(data) as Record<string, unknown>);
    }
    close() {
      this.readyState = 3;
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    emit(msg: Record<string, unknown>) {
      this.onmessage?.({ data: JSON.stringify({ v: 1, ...msg }) });
    }
  }

  const connect = async (reply?: (c: Call) => Response | undefined) => {
    FakeSocket.all = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    const calls = stubFetch(reply);
    const title = addField("pages:3:title", "About");
    const body = document.createElement("div");
    body.dataset.louiseField = "pages:3:body";
    body.dataset.louiseType = "richtext";
    body.innerHTML = "<p>Hello</p>";
    document.body.appendChild(body);
    mount({ autoSave: { debounceMs: 60_000 }, versionedPageId: 3, realtime: true });
    await flush();
    const socket = FakeSocket.all[0];
    socket.open();
    socket.emit({
      t: "welcome",
      you: { id: "me", name: "Alex Doe" },
      peers: [
        { id: "me", name: "Alex Doe" },
        { id: "q", name: "Quinn Lee" },
      ],
      snapshot: {},
      locks: {},
    });
    await flush();
    return { calls, title, body, socket };
  };

  it("sends edits over the socket and echoes a peer's edit into an unfocused field", async () => {
    const { calls, title, socket } = await connect();

    type(title, "About us");
    expect(statusText()).toBe("Draft saved");
    expect(bar(".louise-publish")?.getAttribute("aria-disabled")).toBe("false");
    expect(posts(calls, "/versions")).toHaveLength(0);

    socket.emit({
      t: "change",
      field: "title",
      value: "About Example Organization",
      rev: 2,
      from: "q",
    });
    expect(title.textContent).toBe("About Example Organization");
    socket.emit({ t: "change", field: "title", value: null, rev: 3, from: "q" });
    expect(title.textContent).toBe("");
    expect(document.querySelector(".louise-presence .louise-avatar")?.getAttribute("title")).toBe(
      "Quinn Lee is editing",
    );
  });

  it("claims the rich-text body on focus and releases it on blur", async () => {
    const { body, socket } = await connect();
    body.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    body.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    const kinds = socket.sent.map((m) => `${String(m.t)}:${String(m.field ?? "")}`);
    expect(kinds).toContain("claim:body");
    expect(kinds).toContain("release:body");
  });

  it("marks a field a peer holds, and clears it when the socket drops", async () => {
    const { body, socket } = await connect();
    socket.emit({ t: "locks", locks: { body: "q" } });
    expect(body.classList.contains("louise-locked")).toBe(true);
    expect(body.querySelector(".louise-lock-note")?.textContent).toBe(
      "Quinn Lee is editing this field",
    );

    socket.readyState = 3;
    socket.onclose?.();
    expect(body.classList.contains("louise-locked")).toBe(false);
    expect(document.querySelectorAll(".louise-presence .louise-avatar")).toHaveLength(0);
  });

  it("snapshots every field into a draft before publishing, leaving out a held one", async () => {
    const { calls, title, socket } = await connect();
    socket.emit({ t: "locks", locks: { body: "q" } });
    type(title, "About us");

    bar(".louise-publish")?.click();
    await flush();
    expect(posts(calls, "/versions")[0]?.body).toEqual({ title: "About us" });
    expect(posts(calls, "/publish")).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stops before publishing when a peer holds a field the snapshot changes", async () => {
    const { calls, title } = await connect((c) =>
      c.url.endsWith("/versions") && c.method === "POST"
        ? json({ locked: ["title"] }, 423)
        : undefined,
    );
    type(title, "About us");
    bar(".louise-publish")?.click();
    await flush();
    expect(statusText()).toBe("Someone else is editing this right now.");
    expect(posts(calls, "/publish")).toHaveLength(0);
  });

  it("stops before publishing when the snapshot draft fails", async () => {
    const { calls, title } = await connect((c) =>
      c.url.endsWith("/versions") && c.method === "POST" ? json({}, 500) : undefined,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    type(title, "About us");
    bar(".louise-publish")?.click();
    await flush();
    expect(statusText()).toBe("Couldn’t save");
    expect(posts(calls, "/publish")).toHaveLength(0);
  });
});
