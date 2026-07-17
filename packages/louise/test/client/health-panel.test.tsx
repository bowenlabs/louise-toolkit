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
    expect(host.textContent).toContain("2 images are missing a description");
    expect(host.textContent).toContain("1 page is missing an SEO title or description");

    button("Review in Media")!.click();
    expect(navigate).toHaveBeenCalledWith({ panel: "media" });
    button("Review in Pages")!.click();
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
    expect(host.textContent).toContain("Every image has a description.");
    expect(host.textContent).toContain("Every page has search info."); // SEO all-clear
    expect(button("Fix with AI")).toBeUndefined();
    expect(button("Review in Media")).toBeUndefined();
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

  it("shows a performance badge from CWV field data", async () => {
    stubHealth({
      brokenLinks: 0,
      missingAlt: 0,
      seoGaps: 0,
      checkedAt: new Date().toISOString(),
      brokenLinkDetails: [],
      cwv: { lcp: 2100, inp: 180, cls: 0.05, rating: "good", sampleSize: 50 },
    });
    mount(() => <HealthPanel navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Performance"));
    expect(host.textContent).toContain("Fast");
    expect(host.textContent).toContain("2.1s"); // LCP formatted
    expect(host.querySelector(".louise-cwv-badge")?.getAttribute("data-rating")).toBe("good");
  });

  it("shows 'not measured yet' when there's no CWV data", async () => {
    stubHealth({
      brokenLinks: 0,
      missingAlt: 0,
      seoGaps: 0,
      checkedAt: new Date().toISOString(),
      brokenLinkDetails: [],
    });
    mount(() => <HealthPanel navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("No broken links found."));
    expect(host.textContent).toContain("Not measured yet");
  });
});

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const healthSummary = (missingAlt: number) => ({
  brokenLinks: 0,
  missingAlt,
  seoGaps: 0,
  checkedAt: new Date().toISOString(),
  brokenLinkDetails: [],
});

describe("HealthPanel — one-click AI alt fix", () => {
  it("generates alt with AI, then refreshes the count on success", async () => {
    let missing = 3;
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/generate-alt") && (init?.method ?? "GET").toUpperCase() === "POST") {
        missing = 0; // the backfill cleared them; the next health read reflects it
        return Promise.resolve(jsonRes({ fixed: 3, results: [] }));
      }
      return Promise.resolve(jsonRes({ summary: healthSummary(missing) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(() => <HealthPanel navigate={() => {}} />);

    await vi.waitFor(() =>
      expect(host.textContent).toContain("3 images are missing a description"),
    );
    button("Fix with AI")!.click();

    // POST to the backfill fired, and the refreshed health read shows all-clear.
    await vi.waitFor(() => expect(host.textContent).toContain("Every image has a description"));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/generate-alt"))).toBe(true);
  });

  it("hides the AI button and explains when AI isn't set up (503)", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes("/generate-alt")) return Promise.resolve(jsonRes({ error: "x" }, 503));
      return Promise.resolve(jsonRes({ summary: healthSummary(2) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(() => <HealthPanel navigate={() => {}} />);

    await vi.waitFor(() => expect(button("Fix with AI")).toBeTruthy());
    button("Fix with AI")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("aren’t set up"));
    // The assist removes itself; the manual "Review in Media" path stays.
    expect(button("Fix with AI")).toBeUndefined();
    expect(button("Review in Media")).toBeTruthy();
  });

  it("generates SEO with AI and refreshes on success", async () => {
    let gaps = 3;
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/generate-seo") && (init?.method ?? "GET").toUpperCase() === "POST") {
        gaps = 0;
        return Promise.resolve(jsonRes({ fixed: 3, results: [] }));
      }
      // missingAlt 0 → the only "Fix with AI" on screen is the SEO one.
      return Promise.resolve(jsonRes({ summary: { ...healthSummary(0), seoGaps: gaps } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(() => <HealthPanel navigate={() => {}} />);

    await vi.waitFor(() =>
      expect(host.textContent).toContain("3 pages are missing an SEO title or description"),
    );
    button("Fix with AI")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Every page has search info"));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/generate-seo"))).toBe(true);
  });
});
