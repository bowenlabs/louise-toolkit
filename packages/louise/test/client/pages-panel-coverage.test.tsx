// Behavior coverage for the Pages panel in src/client/settings/pages-panel.tsx
// (#695): creating a page (blank and from a template), the page form's
// remaining fields, save and delete failures, publish from the form, and the
// AI SEO suggestion's outcomes.

import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawerFooter, PagesPanel, PanelActionsProvider } from "../../src/client/settings/index.js";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount(ui: () => JSX.Element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <QueryClientProvider client={qc}>
        <PanelActionsProvider>
          {ui()}
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

const PAGE = {
  id: 1,
  title: "About",
  slug: "about",
  body: "<p>Example Organization bakes bread.</p>",
  status: "draft",
  seoTitle: "",
  seoDescription: "",
  ogImage: "",
  noindex: false,
  sortOrder: 0,
};

function stubFetch(
  reply: (c: Call) => Response | Promise<Response> | undefined = () => undefined,
  page: Record<string, unknown> = PAGE,
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
      if (url === "/api/louise/pages" && method === "GET")
        return Promise.resolve(json({ pages: [page] }));
      if (url === "/api/louise/pages/1" && method === "GET") return Promise.resolve(json({ page }));
      if (url === "/api/louise/settings") return Promise.resolve(json({ settings: {} }));
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
const change = (id: string, value: string, event = "input") => {
  const el = host.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
};

async function openForm() {
  await flush();
  button("Page settings").click();
  await flush();
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PagesPanel—creating a page", () => {
  it("creates a blank page and goes to its canvas", async () => {
    const calls = stubFetch((c) =>
      c.url === "/api/louise/pages" && c.method === "POST"
        ? json({ page: { ...PAGE, id: 2, slug: "new-page-7" } })
        : undefined,
    );
    const href = vi.spyOn(window.location, "href", "set").mockImplementation(() => {});
    mount(() => <PagesPanel />);
    await flush();

    button("+ New page").click();
    await flush();
    const post = calls.find((c) => c.url === "/api/louise/pages" && c.method === "POST");
    expect(post?.body).toMatchObject({
      title: "New page",
      slug: expect.stringMatching(/^new-page-\d+$/),
    });
    expect(href).toHaveBeenCalledWith("/new-page-7?louise");
  });

  it("creates a page from a template, and logs a refused create", async () => {
    const calls = stubFetch((c) =>
      c.url === "/api/louise/pages" && c.method === "POST"
        ? json({ error: "Slug is taken." }, 409)
        : undefined,
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mount(() => (
      <PagesPanel
        pageTemplates={[{ id: "landing", label: "Landing", title: "Welcome", body: "<p>Hi</p>" }]}
      />
    ));
    await flush();

    expect(host.querySelector(".louise-tpl-row")?.textContent).toContain(
      "Or start from a template:",
    );
    button("Landing").click();
    await flush();
    const post = calls.find((c) => c.url === "/api/louise/pages" && c.method === "POST");
    expect(post?.body).toMatchObject({ title: "Welcome", body: "<p>Hi</p>" });
    expect(error).toHaveBeenCalled();
  });
});

describe("PagesPanel—the page form", () => {
  it("saves status, search-engine visibility, and the SEO fields", async () => {
    const calls = stubFetch();
    mount(() => <PagesPanel />);
    await openForm();

    change("pg-status", "published", "change");
    change("pg-noindex", "noindex", "change");
    change("pg-seo-desc", "Fresh bread every morning.");
    change("pg-seo-og", "https://example.com/share.jpg");
    expect(host.querySelector("#pg-seo-desc-count")?.textContent).toBe("26 of 155 characters");
    foot("save").click();
    await flush();

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toMatchObject({
      status: "published",
      noindex: true,
      seoDescription: "Fresh bread every morning.",
      ogImage: "https://example.com/share.jpg",
    });
  });

  it("shows the server's reason for a refused save", async () => {
    stubFetch((c) =>
      c.method === "PATCH" ? json({ error: "That path is taken." }, 409) : undefined,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(() => <PagesPanel />);
    await openForm();

    change("pg-slug", "home");
    foot("save").click();
    await flush();
    expect(alertText()).toBe("That path is taken.");
  });

  it("asks before deleting, deletes on yes, and reports a refused delete", async () => {
    let refuse = false;
    const calls = stubFetch((c) =>
      c.method === "DELETE" && refuse
        ? json({ error: "Can't delete the home page." }, 403)
        : undefined,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mount(() => <PagesPanel />);
    await openForm();

    foot("delete").click();
    await flush();
    expect(confirm).toHaveBeenCalledWith("Delete “About”? The public page goes away immediately.");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    confirm.mockReturnValue(true);
    refuse = true;
    foot("delete").click();
    await flush();
    expect(alertText()).toBe("Can't delete the home page.");

    refuse = false;
    foot("delete").click();
    await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      "/api/louise/pages/1",
      "/api/louise/pages/1",
    ]);
    expect(host.querySelector("#pg-title")).toBeNull();
  });

  it("reports a publish from the form that failed", async () => {
    stubFetch((c) => (c.url.endsWith("/publish") ? json({}, 500) : undefined), {
      ...PAGE,
      publishedVersionId: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(() => <PagesPanel />);
    await openForm();

    button("Publish").click();
    await flush();
    expect(alertText()).toBe("Couldn’t publish");
    expect(button("Publish").disabled).toBe(false);
  });
});

describe("PagesPanel—AI SEO suggestion", () => {
  const suggest = async (reply: () => Response | Promise<Response>) => {
    const calls = stubFetch((c) => (c.url === "/api/louise/ai/seo" ? reply() : undefined));
    mount(() => <PagesPanel />);
    await openForm();
    button("Suggest").click();
    await flush();
    return calls;
  };

  it("fills the SEO fields from the suggestion, sending the title and body text", async () => {
    const calls = await suggest(() =>
      json({ title: "About Example Organization", description: "Bread, baked daily." }),
    );
    expect(calls.find((c) => c.url === "/api/louise/ai/seo")?.body).toEqual({
      content: "About\n\nExample Organization bakes bread.",
    });
    expect(host.querySelector<HTMLInputElement>("#pg-seo-title")?.value).toBe(
      "About Example Organization",
    );
    expect(host.querySelector<HTMLInputElement>("#pg-seo-desc")?.value).toBe("Bread, baked daily.");
  });

  it("retires the button when the site has no AI binding", async () => {
    await suggest(() => json({}, 503));
    expect(button("Suggest")).toBeUndefined();
  });

  it("says the suggestion failed, on an error status or a network error", async () => {
    await suggest(() => json({}, 502));
    expect(alertText()).toBe("Couldn’t suggest SEO right now. Your fields are as you left them.");
    dispose?.();
    host.remove();

    await suggest(() => Promise.reject(new TypeError("offline")));
    expect(alertText()).toBe("Couldn’t suggest SEO right now. Your fields are as you left them.");
  });

  it("says AI is busy when the server says it's rate-limited", async () => {
    await suggest(() => json({ error: "Suggestion unavailable", reason: "rate-limited" }, 502));
    expect(alertText()).toBe(
      "AI is busy right now. Try again in a minute. Your fields are as you left them.",
    );
  });

  it("sends nothing for a page with no title or body", async () => {
    const calls = stubFetch(undefined, { ...PAGE, title: "", body: null });
    mount(() => <PagesPanel />);
    await openForm();
    button("Suggest").click();
    await flush();
    expect(calls.some((c) => c.url === "/api/louise/ai/seo")).toBe(false);
  });
});
