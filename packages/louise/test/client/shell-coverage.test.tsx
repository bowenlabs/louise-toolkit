// Behavior coverage for the Settings shell in src/client/settings/shell.tsx
// (#695): mountSettings's root, its ready signal, its idempotence, its teardown
// before a soft navigation, and each way the drawer closes.

import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_SETTINGS_EVENT, SETTINGS_READY_EVENT } from "../../src/client/settings/index.js";
import { mountSettings } from "../../src/client/settings/shell.jsx";
import { louiseNavigation } from "../../src/client/lifecycle.js";

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const drawer = () => document.querySelector<HTMLElement>(".louise-drawer");
const open = async () => {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
  await flush();
};

afterEach(() => {
  louiseNavigation.beforeSwap();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountSettings", () => {
  it("mounts one drawer root, says it's ready, and opens on the settings event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ pages: [] }))),
    );
    const ready = vi.fn();
    window.addEventListener(SETTINGS_READY_EVENT, ready);
    mountSettings({ userName: "Alex Doe", home: false });
    mountSettings({ userName: "Kai Smith", home: false });
    window.removeEventListener(SETTINGS_READY_EVENT, ready);

    const roots = document.querySelectorAll("#louise-drawer-root");
    expect(roots).toHaveLength(1);
    expect(roots[0]?.getAttribute("lang")).toBe("en");
    expect(ready).toHaveBeenCalledTimes(1);

    await open();
    expect(drawer()?.getAttribute("aria-label")).toBe("Settings");
    expect(drawer()?.querySelector(".louise-who-name")?.textContent).toBe("Alex Doe");
  });

  it("closes from the scrim, the Close button, and Escape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ pages: [] }))),
    );
    mountSettings({ userName: "Alex Doe", home: false });

    await open();
    (document.querySelector(".louise-drawer-scrim") as HTMLElement).click();
    await flush();
    expect(drawer()).toBeNull();

    await open();
    (drawer()?.querySelector('[aria-label="Close"]') as HTMLButtonElement).click();
    await flush();
    expect(drawer()).toBeNull();

    await open();
    drawer()?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await flush();
    expect(drawer()).toBeNull();
  });

  it("tears the drawer down before a soft navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ pages: [] }))),
    );
    mountSettings({ userName: "Alex Doe", home: false });

    louiseNavigation.beforeSwap();
    expect(document.getElementById("louise-drawer-root")).toBeNull();
    await open();
    expect(drawer()).toBeNull();

    // The next page mounts a fresh one.
    mountSettings({ userName: "Quinn Lee", home: false });
    await open();
    expect(drawer()?.querySelector(".louise-who-name")?.textContent).toBe("Quinn Lee");
  });
});
