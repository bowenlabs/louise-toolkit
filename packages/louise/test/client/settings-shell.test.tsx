// Slice-2 Settings shell — happy-dom Solid component tests. Covers the two-group
// registry split (framework panels on top, site collections as bottom tabs),
// tab switching, and each framework/default panel wiring against the generic
// louise/editor endpoints.

import { QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSettingsQueryClient,
  Settings,
  ImageField,
  InquiriesPanel,
  MediaPanel,
  OPEN_SETTINGS_EVENT,
  PagesPanel,
  SettingsPanel,
} from "../../src/client/settings/index.js";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount(ui: () => JSX.Element) {
  const qc = createSettingsQueryClient();
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <QueryClientProvider client={qc}>{ui()}</QueryClientProvider>, host);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

beforeEach(() => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  document.getElementById("louise-drawer-root")?.remove();
  vi.unstubAllGlobals();
});

const openDrawer = () => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
const frameLabels = () =>
  Array.from(host.querySelectorAll<HTMLElement>(".louise-drawer-head .louise-frame-btn")).map((b) =>
    b.getAttribute("aria-label"),
  );
const tabLabels = () =>
  Array.from(host.querySelectorAll<HTMLElement>(".louise-drawer-tabs .louise-tab")).map((b) =>
    b.textContent?.trim(),
  );
const tabButton = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".louise-drawer-tabs .louise-tab")).find(
    (b) => b.textContent?.trim() === label,
  );
const frameButton = (label: string) =>
  Array.from(
    host.querySelectorAll<HTMLButtonElement>(".louise-drawer-head .louise-frame-btn"),
  ).find((b) => b.getAttribute("aria-label") === label);

describe("Settings shell — two-group registry split", () => {
  it("puts Pages/Media/Settings in the top strip and site collections in the bottom tabs", () => {
    stubFetch(() => jsonResponse({}));
    mount(() => (
      <Settings
        userName="Baylee"
        tabs={[
          { id: "inquiries", label: "Inquiries", panel: () => <div>inq-body</div> },
          { id: "products", label: "Products", panel: () => <div>prod-body</div> },
        ]}
      />
    ));
    openDrawer();

    // Framework panels are fixed in the top strip, in order.
    expect(frameLabels()).toEqual(["Media", "Pages", "Settings"]);
    // Site collections (including Inquiries) are the bottom tabs.
    expect(tabLabels()).toEqual(["Inquiries", "Products"]);
    // The split can't collapse: Inquiries is never a top-strip button, and the
    // framework panels are never bottom tabs.
    expect(frameLabels()).not.toContain("Inquiries");
    expect(tabLabels()).not.toContain("Settings");
    expect(tabLabels()).not.toContain("Pages");
  });

  it("shows the first tab by default and switches on tab click", () => {
    stubFetch(() => jsonResponse({}));
    mount(() => (
      <Settings
        userName="Baylee"
        tabs={[
          { id: "inquiries", label: "Inquiries", panel: () => <div>inq-body</div> },
          { id: "products", label: "Products", panel: () => <div>prod-body</div> },
        ]}
      />
    ));
    openDrawer();

    expect(host.textContent).toContain("inq-body");
    expect(host.textContent).not.toContain("prod-body");

    tabButton("Products")!.click();
    expect(host.textContent).toContain("prod-body");
    expect(host.textContent).not.toContain("inq-body");
  });

  it("opens a framework panel over the tabs when its icon is clicked", async () => {
    stubFetch((url) =>
      url.includes("/api/louise/settings") ? jsonResponse({ settings: {} }) : jsonResponse({}),
    );
    mount(() => (
      <Settings
        userName="Baylee"
        tabs={[{ id: "inquiries", label: "Inquiries", panel: () => <div>inq-body</div> }]}
      />
    ));
    openDrawer();

    frameButton("Settings")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Save settings"));
    // The framework overlay replaces the tab body.
    expect(host.textContent).not.toContain("inq-body");
  });

  it("defaults to the Pages panel when a site registers no tabs", async () => {
    stubFetch(() => jsonResponse({ pages: [] }));
    mount(() => <Settings userName="Baylee" />);
    openDrawer();
    expect(host.querySelector(".louise-drawer-tabs")).toBeNull();
    await vi.waitFor(() => expect(host.textContent).toContain("New page"));
  });

  it("threads settingsBaseGroups through to the framework Settings panel", async () => {
    stubFetch((url) =>
      url.includes("/api/louise/settings") ? jsonResponse({ settings: {} }) : jsonResponse({}),
    );
    mount(() => (
      <Settings
        userName="Baylee"
        tabs={[{ id: "x", label: "X", panel: () => <div>x-body</div> }]}
        settingsBaseGroups={[
          { title: "Site config", fields: [{ key: "tagline", label: "Tagline" }] },
        ]}
      />
    ));
    openDrawer();
    frameButton("Settings")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Site config"));
    // The site's baseGroups replace the framework defaults — no empty base fields.
    expect(host.textContent).not.toContain("Appearance");
    expect(host.textContent).not.toContain("Identity");
  });
});

describe("SettingsPanel — base groups + declarative extension", () => {
  it("renders the framework base groups plus a site extension group, and saves both", async () => {
    const fetchMock = stubFetch((url, method) => {
      if (url.includes("/api/louise/settings") && method === "GET") {
        return jsonResponse({ settings: { siteName: "Coracle", roastNote: "medium" } });
      }
      return jsonResponse({ ok: true });
    });
    mount(() => (
      <SettingsPanel
        extension={[{ title: "Coffee", fields: [{ key: "roastNote", label: "Roast note" }] }]}
      />
    ));

    await vi.waitFor(() => expect(host.textContent).toContain("Save settings"));
    // Framework base groups.
    for (const g of ["Identity", "Appearance", "Navigation", "Contact", "SEO"]) {
      expect(host.textContent).toContain(g);
    }
    // Site extension group + its field, seeded from the loaded settings.
    expect(host.textContent).toContain("Coffee");
    expect(host.textContent).toContain("Roast note");

    const save = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === "Save settings",
    )!;
    save.click();

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => (c[1]?.method ?? "GET").toUpperCase() === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]!.body));
      // Base column key and the site-declared custom key both go in the patch.
      expect(body.siteName).toBe("Coracle");
      expect(body.roastNote).toBe("medium");
    });
  });

  it("baseGroups replaces the default framework groups (no empty base fields)", async () => {
    stubFetch((url, method) =>
      url.includes("/api/louise/settings") && method === "GET"
        ? jsonResponse({ settings: {} })
        : jsonResponse({ ok: true }),
    );
    mount(() => (
      <SettingsPanel
        baseGroups={[
          { title: "Navigation", fields: [{ key: "navLinks", label: "Nav", type: "links" }] },
        ]}
      />
    ));
    await vi.waitFor(() => expect(host.textContent).toContain("Save settings"));
    expect(host.textContent).toContain("Navigation");
    // Default framework groups the site didn't include are gone.
    expect(host.textContent).not.toContain("Appearance");
    expect(host.textContent).not.toContain("Identity");
  });

  it("a custom-render field renders and its value saves to its key", async () => {
    const fetchMock = stubFetch((url, method) =>
      url.includes("/api/louise/settings") && method === "GET"
        ? jsonResponse({ settings: { tagline: "Prints & goods" } })
        : jsonResponse({ ok: true }),
    );
    mount(() => (
      <SettingsPanel
        baseGroups={[]}
        extension={[
          {
            title: "Shop",
            fields: [
              {
                key: "tagline",
                label: "Tagline",
                render: ({ value, onChange }) => (
                  <button
                    type="button"
                    data-testid="custom-field"
                    onClick={() => onChange(`${String(value)}!`)}
                  >
                    custom:{String(value)}
                  </button>
                ),
              },
            ],
          },
        ]}
      />
    ));
    await vi.waitFor(() => expect(host.textContent).toContain("custom:Prints & goods"));

    // The render field drives onChange → the new value lands in the save payload.
    host.querySelector<HTMLButtonElement>('[data-testid="custom-field"]')!.click();
    const save = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === "Save settings",
    )!;
    save.click();
    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => (c[1]?.method ?? "GET").toUpperCase() === "POST",
      );
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body)).tagline).toBe("Prints & goods!");
    });
  });
});

describe("InquiriesPanel — list + delete", () => {
  it("lists submissions and deletes one by id", async () => {
    const fetchMock = stubFetch((url, method) => {
      if (url.endsWith("/api/louise/inquiries") && method === "GET") {
        return jsonResponse({
          inquiries: [{ id: 7, name: "Ada Lovelace", email: "ada@x.co", message: "Hello there" }],
        });
      }
      return jsonResponse({ ok: true });
    });
    mount(() => <InquiriesPanel />);

    await vi.waitFor(() => expect(host.textContent).toContain("Ada Lovelace"));
    expect(host.textContent).toContain("Hello there");

    host.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!.click();
    await vi.waitFor(() => {
      const del = fetchMock.mock.calls.find(
        (c) => (c[1]?.method ?? "GET").toUpperCase() === "DELETE",
      );
      expect(del).toBeTruthy();
      expect(String(del![0])).toContain("id=7");
    });
  });

  it("renders the framework inquiriesColumns (firstName/lastName/regarding) with no custom renderRow", async () => {
    stubFetch((url, method) => {
      if (url.endsWith("/api/louise/inquiries") && method === "GET") {
        return jsonResponse({
          inquiries: [
            {
              id: 3,
              firstName: "Grace",
              lastName: "Hopper",
              email: "grace@navy.mil",
              regarding: "Commission",
              message: "A portrait, please",
            },
          ],
        });
      }
      return jsonResponse({ ok: true });
    });
    mount(() => <InquiriesPanel />);

    // Name composed from firstName + lastName (not the email fallback).
    await vi.waitFor(() => expect(host.textContent).toContain("Grace Hopper"));
    // Subject surfaced in the subline, message in the body.
    expect(host.textContent).toContain("Commission");
    expect(host.textContent).toContain("A portrait, please");
  });
});

describe("PagesPanel — list + built-in pages", () => {
  it("lists CMS pages and any code-defined built-in pages", async () => {
    stubFetch((url, method) => {
      if (url.endsWith("/api/louise/pages") && method === "GET") {
        return jsonResponse({
          pages: [{ id: 1, title: "Terms", slug: "terms", status: "published" }],
        });
      }
      return jsonResponse({});
    });
    mount(() => <PagesPanel builtInPages={[{ key: "home", title: "Home", path: "/" }]} />);

    await vi.waitFor(() => expect(host.textContent).toContain("Terms"));
    expect(host.textContent).toContain("Built-in pages");
    expect(host.textContent).toContain("Home");
  });
});

describe("MediaPanel — list", () => {
  it("lists the media library from the generic { media } response", async () => {
    stubFetch((url, method) => {
      if (url.endsWith("/api/louise/media") && method === "GET") {
        return jsonResponse({
          media: [{ key: "web/photo.jpg", size: 2048, url: "https://cdn/web/photo.jpg" }],
        });
      }
      return jsonResponse({});
    });
    mount(() => <MediaPanel />);

    await vi.waitFor(() => expect(host.textContent).toContain("photo.jpg"));
    expect(host.textContent).toContain("2 KB");
  });
});

describe("ImageField — upload + transform", () => {
  it("applies the transform to the preview thumbnail only", () => {
    // `allowUrl` renders the raw-URL input so we can assert the stored value.
    mount(() => (
      <ImageField
        label="Hero"
        value="https://cdn/x.png"
        transform={(u) => `${u}?w=320`}
        allowUrl
        onChange={() => {}}
      />
    ));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://cdn/x.png?w=320");
    // The stored value (URL input) is untouched by the transform.
    expect(host.querySelector<HTMLInputElement>("input.louise-input")?.value).toBe(
      "https://cdn/x.png",
    );
  });

  it("hides the free-form URL input by default, showing it only with `allowUrl`", () => {
    // Strict by default (#47): images come from upload / the media library, not
    // a pasted external URL.
    mount(() => <ImageField label="Hero" value="" onChange={() => {}} />);
    expect(host.querySelector("input.louise-input")).toBeNull();
    dispose?.();

    mount(() => <ImageField label="Hero" value="" allowUrl onChange={() => {}} />);
    expect(host.querySelector("input.louise-input")).not.toBeNull();
  });

  it("shows the upload control only when `upload` is set", () => {
    mount(() => <ImageField label="Hero" value="" onChange={() => {}} />);
    expect(host.querySelector('input[type="file"]')).toBeNull();
    dispose?.();

    mount(() => <ImageField label="Hero" value="" upload onChange={() => {}} />);
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("uploads the picked file and sets the field to the returned URL", async () => {
    const fetchMock = stubFetch((url, method) => {
      if (url.endsWith("/api/louise/media") && method === "POST") {
        return jsonResponse({ ok: true, key: "web/up.png", url: "https://cdn/web/up.png" });
      }
      return jsonResponse({});
    });
    let picked = "";
    mount(() => <ImageField label="Hero" value="" upload onChange={(u) => (picked = u)} />);

    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([1, 2, 3])], "up.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(picked).toBe("https://cdn/web/up.png"));
    const post = fetchMock.mock.calls.find((c) => (c[1]?.method ?? "GET").toUpperCase() === "POST");
    expect(post).toBeTruthy();
    expect(String(post![0])).toContain("/api/louise/media");
  });
});
