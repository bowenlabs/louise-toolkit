// #106 Phase 2 — the site-health detail panel. Reads the full persisted summary
// from /api/louise/health, lists broken links, shows alt/SEO gap counts with a
// jump to the surface that fixes each, and handles the not-yet-scanned state.

import { QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSettingsQueryClient,
  type DashboardApi,
  HealthPanel,
} from "../../src/client/settings/index.js";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount(ui: () => JSX.Element) {
  const qc = createSettingsQueryClient();
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <QueryClientProvider client={qc}>{ui()}</QueryClientProvider>, host);
}

function stubHealth(summary: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ summary }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});

const button = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === label,
  );

describe("HealthPanel", () => {
  it("lists broken links and jumps to the fix surface for alt / SEO gaps", async () => {
    const navigate = vi.fn<DashboardApi["open"]>();
    stubHealth({
      brokenLinks: 1,
      missingAlt: 2,
      seoGaps: 1,
      checkedAt: new Date().toISOString(),
      brokenLinkDetails: [{ url: "https://x/gone", from: "/", status: 404 }],
    });
    mount(() => <HealthPanel navigate={navigate} />);

    await vi.waitFor(() => expect(host.textContent).toContain("https://x/gone"));
    expect(host.textContent).toContain("Returned 404");
    expect(host.textContent).toContain("2 images missing a description");
    expect(host.textContent).toContain("1 page missing SEO title or description");

    button("Fix in Media")!.click();
    expect(navigate).toHaveBeenCalledWith({ panel: "media" });
    button("Fix in Pages")!.click();
    expect(navigate).toHaveBeenCalledWith({ panel: "pages" });
    button("← Home")!.click();
    expect(navigate).toHaveBeenCalledWith({ panel: "home" });
  });

  it("shows all-clear rows and no broken links when the site is healthy", async () => {
    stubHealth({
      brokenLinks: 0,
      missingAlt: 0,
      seoGaps: 0,
      checkedAt: new Date().toISOString(),
      brokenLinkDetails: [],
    });
    mount(() => <HealthPanel navigate={() => {}} />);

    await vi.waitFor(() => expect(host.textContent).toContain("No broken links found."));
    expect(host.textContent).toContain("All good.");
    expect(button("Fix in Media")).toBeUndefined();
  });

  it("renders a not-checked-yet state when no scan has run", async () => {
    stubHealth(null);
    mount(() => <HealthPanel navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("No health check yet"));
  });

  it("caps the broken-link list and notes the remainder", async () => {
    stubHealth({
      brokenLinks: 12,
      missingAlt: 0,
      seoGaps: 0,
      checkedAt: new Date().toISOString(),
      brokenLinkDetails: [
        { url: "https://x/a", from: "/", status: 404 },
        { url: "https://x/b", from: "/", status: "error" },
      ],
    });
    mount(() => <HealthPanel navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("https://x/a"));
    // Count is 12 but only 2 details shipped → "…and 10 more."
    expect(host.textContent).toContain("and 10 more");
    expect(host.textContent).toContain("Didn’t respond");
  });
});
