// Behavior coverage for the settings field widgets in
// src/client/settings/fields.tsx (#695): the declarative SettingsField per type,
// the link list's reorder and edit, the media picker's states, and the image
// field's upload failures.

import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ImageField,
  LinkListEditor,
  type LinkRow,
  MediaUrlPicker,
  SettingsField,
  type SettingsFieldDef,
} from "../../src/client/settings/fields.jsx";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount(ui: () => JSX.Element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <QueryClientProvider client={qc}>{ui()}</QueryClientProvider>, host);
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

function stubFetch(reply: (url: string, method: string) => Response | Promise<Response>) {
  const mock = vi.fn((input: string | URL, init?: RequestInit) =>
    Promise.resolve(
      reply(typeof input === "string" ? input : input.toString(), init?.method ?? "GET"),
    ),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const byLabel = (label: string) =>
  host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) as HTMLButtonElement;
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement;
const input = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Mount one SettingsField over a signal, returning the latest value. */
function mountField(def: SettingsFieldDef, initial: unknown, error?: string) {
  const [value, setValue] = createSignal<unknown>(initial);
  mount(() => (
    <SettingsField def={def} value={value()} onChange={(v) => setValue(() => v)} error={error} />
  ));
  return value;
}

describe("SettingsField", () => {
  it("renders a text field's hint and links its error for assistive tech", () => {
    const value = mountField(
      { key: "siteName", label: "Site name", hint: "Shown in the tab." },
      "Example Organization",
      "Required.",
    );
    const el = host.querySelector<HTMLInputElement>("#louise-set-siteName") as HTMLInputElement;
    expect(host.querySelector(".louise-settings-hint")?.textContent).toBe("Shown in the tab.");
    expect(el.getAttribute("aria-invalid")).toBe("true");
    expect(el.getAttribute("aria-describedby")).toBe("louise-set-siteName-error");
    expect(host.querySelector("#louise-set-siteName-error")?.textContent).toBe("Required.");

    input(el, "Example Organization West");
    expect(value()).toBe("Example Organization West");
  });

  it("writes a textarea field and shows its hint", () => {
    const value = mountField(
      { key: "tagline", label: "Tagline", type: "textarea", hint: "One or two lines." },
      "",
    );
    expect(host.querySelector(".louise-settings-hint")?.textContent).toBe("One or two lines.");
    input(host.querySelector("textarea") as HTMLTextAreaElement, "Fresh bread\ndaily");
    expect(value()).toBe("Fresh bread\ndaily");
  });

  it("writes a color from either the swatch or the hex input", () => {
    const value = mountField({ key: "brand", label: "Brand", type: "color" }, "");
    const swatch = host.querySelector<HTMLInputElement>('input[type="color"]') as HTMLInputElement;
    expect(swatch.getAttribute("aria-label")).toBe("Brand color");
    input(swatch, "#1481ef");
    expect(value()).toBe("#1481ef");
    input(host.querySelector("#louise-set-brand") as HTMLInputElement, "#0f6ecd");
    expect(value()).toBe("#0f6ecd");
  });

  it("stores a toggle as a boolean and shows its hint and error", () => {
    const value = mountField(
      { key: "announce", label: "Show the banner", type: "toggle", hint: "Top of every page." },
      false,
      "Can't turn on without text.",
    );
    const box = host.querySelector<HTMLInputElement>("#louise-set-announce") as HTMLInputElement;
    expect(host.querySelector(".louise-settings-hint")?.textContent).toBe("Top of every page.");
    expect(host.querySelector(".louise-field-error")?.textContent).toBe(
      "Can't turn on without text.",
    );
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(value()).toBe(true);
  });

  it("renders an image field with its hint and error, and clears the value", () => {
    stubFetch(() => json({ media: [] }));
    const value = mountField(
      { key: "logo", label: "Logo", type: "image", hint: "A square works best." },
      "https://example.com/logo.png",
      "Use an uploaded image.",
    );
    expect(host.querySelector(".louise-settings-hint")?.textContent).toBe("A square works best.");
    expect(host.querySelector(".louise-field-error")?.textContent).toBe("Use an uploaded image.");
    // The picker's button points at the error, and the preview is a sized thumb.
    const pick = button("Choose from media");
    expect(pick.getAttribute("aria-describedby")).toBe(
      host.querySelector(".louise-field-error")?.id,
    );
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/cdn-cgi/image/width=320,fit=cover,format=auto,quality=75/logo.png",
    );

    button("Clear").click();
    expect(value()).toBe("");
  });

  it("renders a links field from stored rows, with its hint", () => {
    const value = mountField(
      { key: "navLinks", label: "Navigation", type: "links", hint: "Up to six." },
      [{ label: "Shop", href: "/shop" }, { label: 3 }],
    );
    expect(host.querySelector(".louise-settings-hint")?.textContent).toBe("Up to six.");
    const inputs = [...host.querySelectorAll<HTMLInputElement>(".louise-list input")];
    expect(inputs.map((i) => i.value)).toEqual(["Shop", "/shop", "3", ""]);

    input(inputs[2], "Contact");
    expect(value()).toEqual([
      { label: "Shop", href: "/shop" },
      { label: "Contact", href: "" },
    ]);
  });

  it("treats a stored non-array as an empty links list", () => {
    mountField({ key: "navLinks", label: "Navigation", type: "links" }, "not a list");
    expect(host.querySelector(".louise-list")?.textContent).toBe("None yet.");
  });
});

describe("LinkListEditor—reorder", () => {
  function mountList(initial: LinkRow[]) {
    const [rows, setRows] = createSignal(initial);
    mount(() => <LinkListEditor rows={rows()} setRows={setRows} />);
    return rows;
  }

  it("moves a row up and down, and names each control after its row", () => {
    const rows = mountList([
      { label: "Home", href: "/" },
      { label: "Shop", href: "/shop" },
      { label: " ", href: "/about" },
    ]);
    expect(byLabel("Move link 1, Home up").disabled).toBe(true);
    expect(byLabel("Move link 3 down").disabled).toBe(true);

    byLabel("Move link 2, Shop up").click();
    expect(rows().map((r) => r.label)).toEqual(["Shop", "Home", " "]);

    byLabel("Move link 1, Shop down").click();
    expect(rows().map((r) => r.label)).toEqual(["Home", "Shop", " "]);
  });
});

describe("MediaUrlPicker", () => {
  it("lists the library and picks an item's URL, closing itself", async () => {
    stubFetch(() =>
      json({
        media: [
          { key: "web/a.png", url: "https://example.com/a.png" },
          { key: "web/b.png", url: "https://example.com/b.png" },
        ],
      }),
    );
    const onPick = vi.fn();
    mount(() => <MediaUrlPicker onPick={onPick} />);

    button("Choose from media").click();
    await flush();
    expect(button("Close media")).toBeDefined();
    const tiles = [...host.querySelectorAll<HTMLButtonElement>(".louise-media-pick")];
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Use web/a.png",
      "Use web/b.png",
    ]);

    tiles[1].click();
    expect(onPick).toHaveBeenCalledWith("https://example.com/b.png");
    expect(host.querySelector(".louise-media-pick-grid")).toBeNull();
  });

  it("says when the library is empty", async () => {
    stubFetch(() => json({ media: [] }));
    mount(() => <MediaUrlPicker onPick={() => {}} />);
    button("Choose from media").click();
    await flush();
    expect(host.querySelector(".louise-empty")?.textContent).toBe(
      "No uploads yet. Add images in the Media panel.",
    );
  });

  it("shows why the library didn't load, and retries", async () => {
    let fail = true;
    const fetchMock = stubFetch(() =>
      fail ? json({ error: "Media is turned off." }, 403) : json({ media: [] }),
    );
    mount(() => <MediaUrlPicker onPick={() => {}} />);
    button("Choose from media").click();
    await flush();
    expect(host.querySelector(".louise-error-text")?.textContent).toBe("Media is turned off.");

    fail = false;
    button("Try again").click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".louise-empty")).not.toBeNull();
  });
});

describe("ImageField—upload failures", () => {
  const upload = (files: File[]) => {
    const file = host.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(file, "files", { value: files, configurable: true });
    file.dispatchEvent(new Event("change"));
  };
  const png = () => new File([new Uint8Array([1])], "a.png", { type: "image/png" });
  const alert = () => host.querySelector("[role='alert']")?.textContent;

  it("ignores an empty choice and shows the server's reason for a refusal", async () => {
    const fetchMock = stubFetch(() => json({ error: "That file is too large." }, 413));
    mount(() => <ImageField label="Hero" value="" upload uploadScope="hero" onChange={() => {}} />);

    upload([]);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    upload([png()]);
    await flush();
    expect(alert()).toBe("That file is too large.");
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("scope")).toBe("hero");
  });

  it("names the status when the refusal isn't JSON, and a network error's message", async () => {
    let answer: () => Response | Promise<Response> = () => new Response("", { status: 502 });
    stubFetch(() => answer());
    mount(() => <ImageField label="Hero" value="" upload onChange={() => {}} />);

    upload([png()]);
    await flush();
    expect(alert()).toBe("Upload failed (502)");

    answer = () => Promise.reject(new Error("Network down"));
    upload([png()]);
    await flush();
    expect(alert()).toBe("Network down");

    answer = () => Promise.reject("offline");
    upload([png()]);
    await flush();
    expect(alert()).toBe("Upload failed");
  });

  it("writes a pasted URL when `allowUrl` is set, and shows its hint", () => {
    const onChange = vi.fn();
    mount(() => (
      <ImageField
        label="Hero"
        hint="Wide images work best."
        value=""
        allowUrl
        onChange={onChange}
      />
    ));
    expect(host.querySelector(".louise-settings-hint")?.textContent).toBe("Wide images work best.");
    input(
      host.querySelector('[aria-label="Hero image URL"]') as HTMLInputElement,
      "https://example.com/hero.jpg",
    );
    expect(onChange).toHaveBeenCalledWith("https://example.com/hero.jpg");
  });
});
