// coracle.coffee#36 — the editor's account/history controls, which span THREE
// independent mounts (the edit bar, the sections surface, the Settings drawer).
// Covers the two things that only break at the seam between them:
//
//   1. History's trigger moved into the Settings top strip while the drawer
//      itself stayed on the sections side (versions are per-page; sections mounts
//      without Settings). The handoff is a window event, and each side has to
//      degrade correctly when the other isn't there.
//   2. The bar's "Done" became a real "Sign out".

import { QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSettingsQueryClient,
  OPEN_SETTINGS_EVENT,
  SETTINGS_READY_EVENT,
  Settings,
} from "../../src/client/settings/index.js";
import type { SectionCatalog, SectionItem } from "../../src/client/sections.jsx";
import { mountSections } from "../../src/client/sections.jsx";
import { mountLouise } from "../../src/client/index.js";

const CATALOG: SectionCatalog = { hero: { label: "Hero", fields: { heading: { type: "text" } } } };
const INITIAL: SectionItem[] = [{ _type: "hero", heading: "Hi" }];

const flush = () => new Promise((r) => setTimeout(r, 0));

interface Call {
  url: string;
  method: string;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
      return Promise.resolve(
        new Response(JSON.stringify({ versions: [], publishedVersionId: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

/** A stand-in for the server-rendered page: one marked section. */
function pageHost(): HTMLElement {
  const el = document.createElement("div");
  const sec = document.createElement("section");
  sec.setAttribute("data-louise-section", "0");
  el.appendChild(sec);
  document.body.appendChild(el);
  return el;
}

let disposers: Array<() => void> = [];
let settingsHost: HTMLElement | undefined;

function mountSettingsShell(ui: () => JSX.Element) {
  const qc = createSettingsQueryClient();
  settingsHost = document.createElement("div");
  // The sections side detects Settings by this id, exactly as mountSettings sets it.
  settingsHost.id = "louise-drawer-root";
  document.body.appendChild(settingsHost);
  disposers.push(
    render(() => <QueryClientProvider client={qc}>{ui()}</QueryClientProvider>, settingsHost),
  );
}

const mountSectionsSurface = (host: HTMLElement) =>
  disposers.push(
    mountSections(host, { catalog: CATALOG, pageId: 1, initial: INITIAL, autoSave: false }),
  );

const openDrawer = () => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
const frameLabels = () =>
  [...(settingsHost?.querySelectorAll(".louise-drawer-head .louise-frame-btn") ?? [])].map((b) =>
    b.getAttribute("aria-label"),
  );
const frameButton = (label: string) =>
  [
    ...(settingsHost?.querySelectorAll<HTMLButtonElement>(
      ".louise-drawer-head .louise-frame-btn",
    ) ?? []),
  ].find((b) => b.getAttribute("aria-label") === label);
const historyDrawer = () => document.querySelector(".louise-history-drawer");
const barHistory = () => document.querySelector(".louise-bar-history");

afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
  settingsHost?.remove();
  settingsHost = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-louise-history");
  // mountLouise returns void and guards on this flag — reset it (and drop the
  // module-level leave handlers' view of the mount) so the next test mounts fresh.
  document.dispatchEvent(new Event("astro:after-swap"));
  delete document.documentElement.dataset.louiseMounted;
  document.getElementById("louise-chrome-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("History trigger — Settings strip drives the sections drawer (#36)", () => {
  it("shows a History icon once a sections surface is mounted, and opening it closes Settings", async () => {
    stubFetch();
    const host = pageHost();
    mountSectionsSurface(host);
    await flush();
    mountSettingsShell(() => <Settings userName="Baylee" />);
    openDrawer();

    expect(frameLabels()).toContain("Version history");
    expect(historyDrawer()).toBeNull();

    frameButton("Version history")?.click();
    await flush();

    // The drawer that opens is the sections one — Settings got out of the way so
    // two modals don't fight over the focus trap.
    expect(historyDrawer()).not.toBeNull();
    expect(settingsHost?.querySelector(".louise-drawer-head")).toBeNull();
  });

  it("hides the History icon when no sections surface is mounted", () => {
    stubFetch();
    mountSettingsShell(() => <Settings userName="Baylee" />);
    openDrawer();

    // Nothing advertised a history drawer, so the icon would be a dead button.
    expect(frameLabels()).not.toContain("Version history");
    expect(frameLabels()).toEqual(["Home", "Media", "Pages", "Settings"]);
  });

  it("keeps a fallback History button on the bar when Settings is never mounted", async () => {
    stubFetch();
    mountSectionsSurface(pageHost());
    await flush();

    expect(barHistory()).not.toBeNull();
    (barHistory() as HTMLButtonElement).click();
    await flush();
    expect(historyDrawer()).not.toBeNull();
  });

  it("drops the fallback button whichever order the two surfaces mount in", async () => {
    stubFetch();

    // Settings first — the sections surface finds #louise-drawer-root on mount.
    mountSettingsShell(() => <Settings userName="Baylee" />);
    mountSectionsSurface(pageHost());
    await flush();
    expect(barHistory()).toBeNull();

    for (const d of disposers) d();
    disposers = [];
    document.body.replaceChildren();

    // Sections first — nothing to detect yet, so it starts with the fallback and
    // gives it up when mountSettings announces itself.
    mountSectionsSurface(pageHost());
    await flush();
    expect(barHistory()).not.toBeNull();

    window.dispatchEvent(new CustomEvent(SETTINGS_READY_EVENT));
    await flush();
    expect(barHistory()).toBeNull();
  });

  it("stops advertising history once the sections surface is disposed", async () => {
    stubFetch();
    mountSectionsSurface(pageHost());
    await flush();
    expect(document.documentElement.hasAttribute("data-louise-history")).toBe(true);

    for (const d of disposers) d();
    disposers = [];
    expect(document.documentElement.hasAttribute("data-louise-history")).toBe(false);
  });
});

describe("Edit bar — Done became Sign out (#36)", () => {
  it("ends the session, then leaves edit mode", async () => {
    const calls = stubFetch();
    const assign = vi.fn();
    vi.spyOn(window.location, "assign").mockImplementation(assign);
    mountLouise({ collections: {} }); // returns void — torn down via the flag in afterEach

    const exit = document.querySelector<HTMLButtonElement>(".louise-exit");
    expect(exit?.tagName).toBe("BUTTON"); // an action, not a link
    expect(exit?.textContent).toBe("Sign out");

    exit?.click();
    await flush();

    expect(calls).toContainEqual({ url: "/api/auth/sign-out", method: "POST" });
    // …and edit mode is dropped either way, so a failed sign-out can't strand the
    // user in an editor they asked to leave.
    expect(assign).toHaveBeenCalledWith(expect.stringContaining("louise=off"));
  });
});
