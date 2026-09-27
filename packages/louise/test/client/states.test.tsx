// Loading, empty, and error states (#468): the primitives, and the panels that
// used to show a failed load as an empty list, or a failed check as a healthy
// site.

import { QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaPicker } from "../../src/client/media-picker.jsx";
import { HomePanel } from "../../src/client/settings/dashboard/home-panel.jsx";
import { BUILTIN_CARDS } from "../../src/client/settings/dashboard/cards.jsx";
import {
  createSettingsQueryClient,
  DrawerFooter,
  EmptyState,
  ErrorState,
  InlineError,
  PagesPanel,
  PanelActionsProvider,
  Skeleton,
} from "../../src/client/settings/index.js";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount(ui: () => JSX.Element) {
  const qc = createSettingsQueryClient();
  // One retry is the default; a test of the failure state wants it now.
  qc.setDefaultOptions({ queries: { retry: false } });
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

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the primitives", () => {
  it("Skeleton is a busy status region that says what's loading", () => {
    mount(() => <Skeleton label="Loading your pages" count={4} />);
    const region = host.querySelector(".louise-skeleton")!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.textContent).toBe("Loading your pages");
    expect(region.querySelectorAll(".louise-skeleton-item")).toHaveLength(4);
  });

  it("EmptyState offers its one next step", () => {
    const onClick = vi.fn();
    mount(() => <EmptyState message="No pages yet." action={{ label: "New page", onClick }} />);
    expect(host.textContent).toContain("No pages yet.");
    host.querySelector("button")!.click();
    expect(onClick).toHaveBeenCalled();
  });

  it("ErrorState mounts its alert empty, fills it a tick later, and retries", async () => {
    const onRetry = vi.fn();
    mount(() => <ErrorState message="Couldn’t load your pages." onRetry={onRetry} />);
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("");
    await vi.waitFor(() => expect(alert.textContent).toBe("Couldn’t load your pages."));
    host.querySelector("button")!.click();
    expect(onRetry).toHaveBeenCalled();
    expect(host.querySelector("button")!.textContent).toBe("Try again");
  });

  it("InlineError is in the page, empty, while there's nothing to say", () => {
    mount(() => <InlineError id="title-error" message={null} />);
    const note = host.querySelector("#title-error")!;
    expect(note.getAttribute("aria-live")).toBe("polite");
    expect(note.textContent).toBe("");
  });
});

describe("a failed load isn't an empty one", () => {
  it("Pages says it couldn't load, and Try again loads the list", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fail
          ? jsonResponse({ error: "D1_ERROR" }, 500)
          : jsonResponse({ pages: [{ id: 1, title: "Terms", slug: "terms", status: "draft" }] }),
      ),
    );
    mount(() => <PagesPanel />);
    await vi.waitFor(() => expect(host.textContent).toContain("Couldn’t load your pages."));
    expect(host.textContent).not.toContain("No pages yet.");
    expect(host.textContent).not.toContain("D1_ERROR");

    fail = false;
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Terms"));
  });

  it("the media picker says it couldn't load, and retries", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fail
          ? jsonResponse({}, 500)
          : jsonResponse({ media: [{ key: "web/a.jpg", url: "https://cdn.example.com/a.jpg" }] }),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(() => <MediaPicker onPick={() => {}} />);
    host.querySelector("button")!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Couldn’t load your media."));
    expect(host.textContent).not.toContain("No uploads yet");

    fail = false;
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click();
    await vi.waitFor(() =>
      expect(host.querySelector('button[aria-label="Use web/a.jpg"]')).not.toBeNull(),
    );
  });

  it("the dashboard never calls a site healthy it couldn't check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 500)),
    );
    mount(() => <HomePanel cards={BUILTIN_CARDS} navigate={() => {}} />);
    await vi.waitFor(() => expect(host.textContent).toContain("Couldn’t check your site."));
    expect(host.textContent).not.toContain("Your site is healthy");
  });

  it("the dashboard shows a skeleton, not a verdict, while it checks", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    mount(() => <HomePanel cards={BUILTIN_CARDS} navigate={() => {}} />);
    expect(host.querySelector(".louise-skeleton")?.textContent).toBe("Checking your site");
    expect(host.textContent).not.toContain("Your site is healthy");
  });
});
