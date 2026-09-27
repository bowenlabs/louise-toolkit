// #106 Phase 2—the site-health detail panel. Reads the full persisted summary
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
import { SurfacePanels } from "../../src/client/settings/surface.jsx";

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

  it("lists a crawl's redirects, indexing findings, shared titles, and slowest pages", async () => {
    stubHealth({
      brokenLinks: 0,
      missingAlt: 0,
      seoGaps: 0,
      checkedAt: new Date().toISOString(),
      redirects: 2,
      redirectDetails: [
        {
          url: "https://example.com/old",
          from: "https://example.com/",
          status: 301,
          to: "https://example.com/new",
          hops: 2,
          finalStatus: 200,
        },
      ],
      indexing: 1,
      indexingDetails: [
        {
          url: "https://example.com/about",
          issue: "canonical-off-origin",
          canonical: "https://old.example.net/about",
        },
      ],
      duplicateTitles: 0,
      duplicateTitleDetails: [],
      cwv: {
        rating: "poor",
        lcp: 4200,
        sampleSize: 90,
        slowestPaths: [{ path: "/shop", rating: "poor", lcp: 5100, sampleSize: 30 }],
      },
    });
    mount(() => <HealthPanel navigate={vi.fn()} />);

    await vi.waitFor(() => expect(host.textContent).toContain("Links that redirect"));
    expect(host.textContent).toContain("Moves to https://example.com/new in 2 steps");
    expect(host.textContent).toContain("…and 1 more.");
    expect(host.textContent).toContain(
      "Tells search engines the page lives on another site: https://old.example.net/about",
    );
    expect(host.textContent).toContain("Every page has its own title.");
    expect(host.textContent).toContain("/shop");
    expect(host.textContent).toContain("Slow · Loading: 5.1s");
  });

  it("hides the crawl sections when the scan didn't crawl", async () => {
    stubHealth({ brokenLinks: 0, missingAlt: 0, seoGaps: 0, checkedAt: new Date().toISOString() });
    mount(() => <HealthPanel navigate={vi.fn()} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Broken links"));
    expect(host.textContent).not.toContain("Links that redirect");
    expect(host.textContent).not.toContain("Shared page titles");
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

  it("names pending database updates and who applies them, only when there are some", async () => {
    stubHealth({
      brokenLinks: 0,
      missingAlt: 0,
      seoGaps: 0,
      checkedAt: new Date().toISOString(),
      brokenLinkDetails: [],
      pendingMigrations: ["0004_add_tags.sql", "0005_backfill.sql"],
    });
    mount(() => <HealthPanel navigate={() => {}} />);

    await vi.waitFor(() => expect(host.textContent).toContain("Database updates"));
    expect(host.textContent).toContain("needs 2 database updates that haven’t been applied");
    expect(host.textContent).toContain("Ask your developer to apply them");
    expect(host.textContent).toContain("0004_add_tags.sql");
    expect(host.textContent).toContain("0005_backfill.sql");
  });

  it("leaves the database section out when nothing is pending", async () => {
    stubHealth({
      brokenLinks: 0,
      missingAlt: 0,
      seoGaps: 0,
      checkedAt: new Date().toISOString(),
      brokenLinkDetails: [],
    });
    mount(() => <HealthPanel navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("No broken links found."));
    expect(host.textContent).not.toContain("Database updates");
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

describe("HealthPanel — stale last check", () => {
  const HOUR = 60 * 60 * 1000;
  const checkedHoursAgo = (hours: number) => ({
    brokenLinks: 0,
    missingAlt: 0,
    seoGaps: 0,
    checkedAt: new Date(Date.now() - hours * HOUR).toISOString(),
    brokenLinkDetails: [],
  });

  it("shows a recent check as a plain muted line", async () => {
    stubHealth(checkedHoursAgo(2));
    mount(() => <HealthPanel navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Last checked 2h ago."));
    expect(host.querySelector(".louise-health-stale")).toBeNull();
    expect(host.textContent).not.toContain("Out of date");
  });

  it("marks a check older than 36 hours as out of date, in words as well as color", async () => {
    stubHealth(checkedHoursAgo(72));
    mount(() => <HealthPanel navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Out of date:"));
    const line = host.querySelector(".louise-health-stale");
    expect(line?.getAttribute("data-state")).toBe("stale");
    expect(line?.textContent).toContain("last checked");
    expect(line?.textContent).toContain("might have stopped running");
    expect(line?.textContent).toContain("Ask your developer");
  });

  it("says there's no record when the timestamp can't be read", async () => {
    stubHealth({ ...checkedHoursAgo(0), checkedAt: "not a date" });
    mount(() => <HealthPanel navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Out of date:"));
    expect(host.textContent).toContain("there’s no record of when the last check ran");
  });

  it("takes the threshold as a parameter", async () => {
    stubHealth(checkedHoursAgo(3));
    mount(() => <HealthPanel navigate={() => {}} staleAfterMs={HOUR} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Out of date:"));
    expect(host.textContent).toContain("last checked 3h ago.");
  });

  it("reads the threshold from the dashboard config", async () => {
    stubHealth(checkedHoursAgo(3));
    mount(() => (
      <SurfacePanels
        config={{ dashboard: { healthStaleAfterMs: HOUR } }}
        overlay="health"
        tab={undefined}
        navigate={() => {}}
      />
    ));
    await vi.waitFor(() => expect(host.textContent).toContain("Out of date:"));
  });

  it("keeps a 72-hour-old check fresh under a weekly threshold", async () => {
    stubHealth(checkedHoursAgo(72));
    mount(() => <HealthPanel navigate={() => {}} staleAfterMs={7 * 24 * HOUR} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Last checked"));
    expect(host.querySelector(".louise-health-stale")).toBeNull();
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
  it("suggests descriptions, saves only what the owner accepts, then refreshes (#549)", async () => {
    let missing = 2;
    const patches: Record<string, unknown>[] = [];
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/generate-alt") && method === "POST") {
        return Promise.resolve(
          jsonRes({
            suggestions: [
              { key: "web/door.jpg", alt: "A wooden door" },
              { key: "web/rule.png", alt: "A thin line" },
            ],
          }),
        );
      }
      if (url.endsWith("/api/louise/media") && method === "PATCH") {
        patches.push(JSON.parse(String(init?.body)));
        missing -= 1;
        return Promise.resolve(jsonRes({ ok: true }));
      }
      return Promise.resolve(jsonRes({ summary: healthSummary(missing) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(() => <HealthPanel navigate={() => {}} />);

    await vi.waitFor(() =>
      expect(host.textContent).toContain("2 images are missing a description"),
    );
    button("Suggest with AI")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("door.jpg"));
    // Asking wrote nothing.
    expect(patches).toEqual([]);

    // The owner edits one suggestion, accepts it, and skips the other.
    const field = host.querySelector<HTMLInputElement>('input[id*="door"]')!;
    field.value = "The shop's front door";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    host
      .querySelector<HTMLButtonElement>('button[aria-label="Accept the suggestion for door.jpg"]')!
      .click();
    await vi.waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ key: "web/door.jpg", alt: "The shop's front door" });
    host
      .querySelector<HTMLButtonElement>('button[aria-label="Skip the suggestion for rule.png"]')!
      .click();
    await vi.waitFor(() => expect(host.textContent).toContain("Saved 1 description."));
    expect(patches).toHaveLength(1);
    await vi.waitFor(() => expect(host.textContent).toContain("1 image is missing a description"));
  });

  it("hides the AI button and explains when AI isn't set up (503)", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes("/generate-alt")) return Promise.resolve(jsonRes({ error: "x" }, 503));
      return Promise.resolve(jsonRes({ summary: healthSummary(2) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(() => <HealthPanel navigate={() => {}} />);

    await vi.waitFor(() => expect(button("Suggest with AI")).toBeTruthy());
    button("Suggest with AI")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("aren’t set up"));
    // The assist removes itself; the manual "Review in Media" path stays.
    expect(button("Suggest with AI")).toBeUndefined();
    expect(button("Review in Media")).toBeTruthy();
  });

  it("suggests SEO, and Accept all saves every one through apply (#549)", async () => {
    const applied: Record<string, unknown>[] = [];
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/generate-seo/apply")) {
        applied.push(JSON.parse(String(init?.body)));
        return Promise.resolve(jsonRes({ ok: true, draft: true }));
      }
      if (url.includes("/generate-seo")) {
        return Promise.resolve(
          jsonRes({
            suggestions: [
              {
                id: 4,
                title: "Bakery",
                slug: "bakery",
                seoTitle: "Fresh bread",
                seoDescription: null,
              },
              { id: 5, title: "", slug: "cafe", seoTitle: null, seoDescription: "Coffee all day." },
            ],
          }),
        );
      }
      // missingAlt 0 → the only "Suggest with AI" on screen is the SEO one.
      return Promise.resolve(jsonRes({ summary: { ...healthSummary(0), seoGaps: 2 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    mount(() => <HealthPanel navigate={() => {}} />);

    await vi.waitFor(() => expect(button("Suggest with AI")).toBeTruthy());
    button("Suggest with AI")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Bakery"));
    expect(host.textContent).toContain("/cafe");
    button("Accept all")!.click();
    await vi.waitFor(() => expect(applied).toHaveLength(2));
    expect(applied).toEqual([
      { id: 4, seoTitle: "Fresh bread" },
      { id: 5, seoDescription: "Coffee all day." },
    ]);
    await vi.waitFor(() => expect(host.textContent).toContain("publish those pages"));
  });
});
