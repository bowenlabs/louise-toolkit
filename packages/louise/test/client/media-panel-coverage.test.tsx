// Behavior coverage for the Media panel in src/client/settings/media-panel.tsx
// (#695): copying a URL, the list's failure state, the delete flow's prompts
// and failures, and the alt and caption editor's save outcomes.

import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawerFooter, MediaPanel, PanelActionsProvider } from "../../src/client/settings/index.js";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <QueryClientProvider client={qc}>
        <PanelActionsProvider>
          <MediaPanel />
          <DrawerFooter />
        </PanelActionsProvider>
      </QueryClientProvider>
    ),
    host,
  );
}

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

const ITEM = {
  key: "web/bread.png",
  url: "https://example.com/web/bread.png",
  size: 2048,
  width: 800,
  height: 600,
  alt: "A loaf of bread",
  caption: null,
};

function stubFetch(
  reply: (c: Call) => Response | Promise<Response> | undefined = () => undefined,
): Call[] {
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
      if (url === "/api/louise/media" && method === "GET") {
        return Promise.resolve(json({ media: [ITEM] }));
      }
      return Promise.resolve(json({ ok: true }));
    }),
  );
  return calls;
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text,
  ) as HTMLButtonElement;
const foot = (id: string) =>
  host.querySelector<HTMLButtonElement>(
    `.louise-drawer-foot [data-action="${id}"]`,
  ) as HTMLButtonElement;
const alertText = () => host.querySelector(".louise-alert")?.textContent;
const deletes = (calls: Call[]) => calls.filter((c) => c.method === "DELETE").map((c) => c.url);

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MediaPanel—copy and load", () => {
  it("copies a file's URL and says so, then says when copying fails", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    stubFetch();
    mount();
    await flush();

    button("Copy URL").click();
    await flush();
    expect(writeText).toHaveBeenCalledWith("https://example.com/web/bread.png");
    expect(button("Copied")).toBeDefined();
    await new Promise((r) => setTimeout(r, 1600));
    expect(button("Copy URL")).toBeDefined();

    writeText.mockImplementation(() => Promise.reject(new Error("denied")));
    button("Copy URL").click();
    await flush();
    expect(alertText()).toBe("Couldn’t copy the URL.");
  });

  it("ignores an empty file choice", async () => {
    const calls = stubFetch();
    mount();
    await flush();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [], configurable: true });
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("shows why the library didn't load, and retries", async () => {
    let fail = true;
    stubFetch((c) =>
      c.method === "GET" && fail ? json({ error: "Media is turned off." }, 403) : undefined,
    );
    mount();
    await flush();
    expect(host.querySelector(".louise-error-text")?.textContent).toBe("Media is turned off.");

    fail = false;
    button("Try again").click();
    await flush();
    expect(host.querySelector(".louise-media-card")).not.toBeNull();
  });
});

describe("MediaPanel—delete", () => {
  it("asks again when a use turns up at delete time, and stops on no", async () => {
    const calls = stubFetch((c) => {
      if (c.url.includes("?references=")) return json({}, 404);
      if (c.method === "DELETE" && !c.url.includes("force=1")) {
        return json({ references: [{ collection: "pages", label: "About" }] }, 409);
      }
      return undefined;
    });
    const confirm = vi.fn((_message: string) => true);
    vi.stubGlobal("confirm", confirm);
    mount();
    await flush();

    confirm.mockReturnValueOnce(true).mockReturnValueOnce(false);
    button("Delete").click();
    await flush();
    expect(confirm.mock.calls.map((c) => c[0])).toEqual([
      "Delete this file from storage? This can’t be undone.",
      "This file is still used by 1 item (pages: About). Deleting it shows a broken image there, and it can’t be undone. Delete anyway?",
    ]);
    expect(deletes(calls)).toEqual(["/api/louise/media?key=web%2Fbread.png"]);
  });

  it("says a forced delete failed, and asks the plain question when the lookup fails", async () => {
    const calls = stubFetch((c) => {
      if (c.url.includes("?references=")) return Promise.reject(new TypeError("offline"));
      if (c.method === "DELETE" && !c.url.includes("force=1")) {
        return new Response("conflict", { status: 409 });
      }
      if (c.method === "DELETE") return json({}, 500);
      return undefined;
    });
    const confirm = vi.fn((_message: string) => true);
    vi.stubGlobal("confirm", confirm);
    mount();
    await flush();

    button("Delete").click();
    await flush();
    expect(confirm.mock.calls[1]?.[0]).toBe(
      "This file is still used by 0 items. Deleting it shows a broken image there, and it can’t be undone. Delete anyway?",
    );
    expect(deletes(calls)).toEqual([
      "/api/louise/media?key=web%2Fbread.png",
      "/api/louise/media?key=web%2Fbread.png&force=1",
    ]);
    expect(alertText()).toBe("Delete failed (500)");
  });
});

describe("MediaPanel—alt and caption editor", () => {
  const openEditor = async (reply?: (c: Call) => Response | Promise<Response> | undefined) => {
    const calls = stubFetch(reply);
    mount();
    await flush();
    button("Edit alt text").click();
    await flush();
    return calls;
  };
  const caption = () =>
    host.querySelector<HTMLInputElement>(
      '.louise-media-edit input[placeholder="Caption (optional)"]',
    ) as HTMLInputElement;
  const typeCaption = (text: string) => {
    caption().value = text;
    caption().dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("closes without a request when nothing changed", async () => {
    const calls = await openEditor();
    foot("save").click();
    await flush();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(host.querySelector(".louise-media-edit")).toBeNull();
  });

  it("saves a caption", async () => {
    const calls = await openEditor();
    typeCaption("Baked by Kai");
    foot("save").click();
    await flush();
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      key: "web/bread.png",
      alt: "A loaf of bread",
      caption: "Baked by Kai",
    });
    expect(host.querySelector(".louise-media-edit")).toBeNull();
  });

  it("shows the server's reason, the status, or the network error when a save fails", async () => {
    let answer: () => Response | Promise<Response> = () =>
      json({ error: "Caption is too long." }, 422);
    await openEditor((c) => (c.method === "PATCH" ? answer() : undefined));
    typeCaption("A very long caption");

    foot("save").click();
    await flush();
    expect(alertText()).toBe("Caption is too long.");

    answer = () => new Response("", { status: 500 });
    foot("save").click();
    await flush();
    expect(alertText()).toBe("Save failed (500)");

    answer = () => Promise.reject(new Error("Network down"));
    foot("save").click();
    await flush();
    expect(alertText()).toBe("Network down");
    expect(host.querySelector(".louise-media-edit")).not.toBeNull();
  });
});
